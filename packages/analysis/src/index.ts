import { createHash } from "node:crypto";
import type { RepositoryDocumentation, IssueContext } from "@radar/contracts";
import type { ResearchFocus, ResearchProfile } from "./research.js";

export { researchDemand, validateDemandEvaluationResume, validateDemandGapResume, validateDemandSelectionResume, demandInputSchema, demandPlanSchema, demandSources, DEMAND_VERSION, DEMAND_BUDGET } from "./demand.js";
export type { DemandPlan, DemandPath, DemandPreview, DemandSource, DemandSearch, DemandSnapshot, DemandDependencies } from "./demand.js";
export { researchDemandSources, sourceStudyInputSchema, validateSourceStudyParent, validateSourceStudyResume, SOURCE_STUDY_BUDGET } from "./demand-source.js";
export type { SourceStudyInput, DemandSourceStudy } from "./demand-source.js";
export { DeepSeekTransport } from "./transport.js";
export type { CompletionTransport } from "./transport.js";

export { ModelAnalysisProvider, DeepSeekAnalysisProvider, analysisInputHash, analysisCatalog } from "./provider.js";
export { OpenCodeAnalysisProvider, OpenCodeTransport, findOpenCodeBinary, DEFAULT_OPENCODE_MODEL, MAX_FREE_MODEL_ATTEMPTS } from "./opencode.js";
export { CodexTransport, LocalCliTransport, findCodexBinary, configuredCodexModel } from "./codex.js";
export { EvidenceOnlyTransport, EvidenceFallbackTransport } from "./rules.js";
export type { ModelAnalysisResult, ModelUsage, AnalysisSelection, CandidateAudit } from "./provider.js";
export { researchFocusSchema, canonicalResearchFocus, researchOriginAvailable, researchProfileSchema, canonicalResearchProfile } from "./research.js";
export type { ResearchFocus, ResearchProfile } from "./research.js";

export type AnalyzableProject = {
  id: string;
  fullName: string;
  description: string | null;
  language: string | null;
  license: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  createdAt: string;
  pushedAt: string | null;
  url: string;
  readmeExcerpt: string | null;
  releaseTag?: string | null;
  observedAt: string;
  discoveryChannels?: string[];
  issuesFetchedAt?: string | null;
  issues?: Array<{ id: number; number: number; title: string; bodyExcerpt: string; bodyTruncated?: boolean; url: string; updatedAt: string; authorAssociation?: string; authorLogin?: string | null }>;
  documentation?: RepositoryDocumentation | null;
  issueContexts?: Record<string, IssueContext>;
};

export type Evidence = { url: string | null; quote: string; observedAt: string; relation: "supports" | "refutes"; sourcePath?: string; sourceSha?: string };
export type OpportunityDraft = {
  researchFocus?: ResearchFocus | null;
  researchProfile?: ResearchProfile | null;
  id: string;
  combinationKey: string;
  title: string;
  targetUser: string;
  jobToBeDone: string;
  hypothesis: string;
  projectIds: string[];
  projectNames: string[];
  score: number;
  supportingEvidence: Evidence[];
  counterEvidence: Evidence[];
  validationSteps: string[];
  successMetric: string;
  failureMetric: string;
  components?: Array<{ projectId: string; role: string; input: string; output: string }>;
  integrationPlan?: string;
  alternatives?: string;
  whyNow?: string;
  firstExperiment?: string;
  problemEvidence?: Evidence[];
};

const capabilityRules: Array<{ id: string; label: string; pattern: RegExp }> = [
  { id: "agent", label: "Agent runtime", pattern: /\b(agent framework|agent runtime|agent sdk|agent orchestration|autonomous agents?|ai agents?|llm agents?)\b/i },
  { id: "memory", label: "Memory and retrieval", pattern: /\b(agent memory|long[- ]term memory|vector (?:database|store|search|retrieval)|retrieval[- ]augmented generation|rag pipeline)\b/i },
  { id: "browser", label: "Browser automation", pattern: /\b(browser automation|browser control|web browser automation|playwright|puppeteer)\b/i },
  { id: "evaluation", label: "Evaluation and tracing", pattern: /\b(agent evaluation|llm evaluation|evaluation framework|eval framework|tracing for (?:agents?|llms?))\b/i },
  { id: "workflow", label: "Workflow automation", pattern: /\b(workflow engine|workflow orchestration|workflow automation|automation workflows|durable execution)\b/i },
  { id: "data-extraction", label: "Web data extraction", pattern: /\b(web scraping|web crawler|data extraction|crawler framework|browser scraping)\b/i },
];

const combinations = [
  { pair: ["agent", "memory"], title: "为 AI Agent 提供可移植的长期记忆层", audience: "构建知识型 AI Agent 的独立开发者", job: "让 Agent 在不同模型与应用间安全复用用户知识", experiment: "访问 5 个正在构建知识型 Agent 的开发者，演示跨会话记忆原型并记录是否愿意接入" },
  { pair: ["agent", "browser"], title: "把网页操作封装成可验证的 Agent 工具", audience: "需要自动化网页工作的软件小团队", job: "让 Agent 在常见网页任务中可靠执行并返回可检查结果", experiment: "为 3 个重复网页流程做只读原型，请 5 位目标用户实际操作并比较人工耗时" },
  { pair: ["agent", "evaluation"], title: "为 Agent 工作流提供轻量回归测试", audience: "需要保持 Agent 输出稳定的开发团队", job: "在提示词或模型变化后发现质量回退", experiment: "为 3 个公开 Agent 项目配置回归集，访谈维护者并观察他们是否持续运行" },
  { pair: ["agent", "workflow"], title: "让 Agent 能力接入现有自动化流程", audience: "已经使用自动化工具的小型产品团队", job: "将 Agent 步骤嵌入现有流程并保留可重试状态", experiment: "访谈 5 个使用自动化流程的团队，验证他们是否愿意把一个真实步骤交给原型" },
  { pair: ["browser", "data-extraction"], title: "为运营团队组合可复用的网页采集工作流", audience: "需要定期整理公开网页信息的运营团队", job: "从公开网页采集结构化信息并快速复核来源", experiment: "选一个公开数据整理任务，完成 20 条样本并让 3 位用户复核准确率与节省时间" },
];

function capabilityMatch(project: Pick<AnalyzableProject, "description" | "readmeExcerpt">, capabilityId: string) {
  const rule = capabilityRules.find((candidate) => candidate.id === capabilityId);
  if (!rule) return null;
  const description = project.description ?? "";
  const descriptionMatch = rule.pattern.exec(description);
  if (descriptionMatch) {
    return { source: "description" as const, quote: description.slice(Math.max(0, descriptionMatch.index - 70), descriptionMatch.index + descriptionMatch[0].length + 110).trim() };
  }
  const readme = (project.readmeExcerpt ?? "").slice(0, 2400);
  const readmeMatch = rule.pattern.exec(readme);
  if (readmeMatch) {
    return { source: "readme" as const, quote: readme.slice(Math.max(0, readmeMatch.index - 70), readmeMatch.index + readmeMatch[0].length + 110).trim() };
  }
  return null;
}

export function extractCapabilities(project: Pick<AnalyzableProject, "fullName" | "description" | "readmeExcerpt">) {
  return capabilityRules.filter((rule) => capabilityMatch(project, rule.id)).map((rule) => rule.label);
}

export function scoreProject(project: AnalyzableProject) {
  const reasons: string[] = [];
  let score = 20;
  if (project.readmeExcerpt && project.readmeExcerpt.length > 300) { score += 15; reasons.push("README 提供了可检查的技术描述"); }
  if (project.license) { score += 10; reasons.push("仓库声明了许可证标识，仍需人工检查原文"); }
  if (project.pushedAt && Date.now() - Date.parse(project.pushedAt) < 90 * 86400000) { score += 15; reasons.push("近 90 天有更新"); }
  if (project.stars >= 100) { score += 3; reasons.push("有公开关注度，仅作为弱信号"); }
  if (project.stars >= 1000) score += 2;
  if (project.openIssues > 0) { score += 5; reasons.push("公开维护记录可供进一步检查"); }
  if (extractCapabilities(project).length > 0) { score += 15; reasons.push("检测到可复用的技术能力线索"); }
  if (!project.description) { score -= 5; reasons.push("项目缺少描述"); }
  if (!project.license) reasons.push("许可证未知，不推断可商业使用");
  return { score: Math.max(0, Math.min(score, 100)), reasons };
}

export function generateOpportunityDrafts(projects: AnalyzableProject[], limit = 5, currentSearchProjectIds?: Set<string>): OpportunityDraft[] {
  const drafts: OpportunityDraft[] = [];
  for (const combination of combinations) {
    if (drafts.length >= limit) break;
    const matches: Array<{ first: AnalyzableProject; second: AnalyzableProject; firstEvidence: NonNullable<ReturnType<typeof capabilityMatch>>; secondEvidence: NonNullable<ReturnType<typeof capabilityMatch>>; score: number }> = [];
    for (let left = 0; left < projects.length; left++) {
      const first = projects[left];
      if (!first) continue;
      for (let right = left + 1; right < projects.length; right++) {
        const second = projects[right];
        if (!second) continue;
        if (currentSearchProjectIds && !currentSearchProjectIds.has(first.id) && !currentSearchProjectIds.has(second.id)) continue;
        const forward = [capabilityMatch(first, combination.pair[0]!), capabilityMatch(second, combination.pair[1]!)];
        const reverse = [capabilityMatch(first, combination.pair[1]!), capabilityMatch(second, combination.pair[0]!)];
        const evidence = forward[0] && forward[1] ? forward : reverse[0] && reverse[1] ? reverse : null;
        if (!evidence || !evidence[0] || !evidence[1]) continue;
        const evidenceScore = [evidence[0], evidence[1]].reduce((total, item) => total + (item.source === "description" ? 8 : 4), 0);
        const releaseScore = Number(Boolean(first.releaseTag)) * 3 + Number(Boolean(second.releaseTag)) * 3;
        matches.push({ first, second, firstEvidence: evidence[0], secondEvidence: evidence[1], score: 40 + evidenceScore + releaseScore });
      }
    }
    matches.sort((a, b) => b.score - a.score || Date.parse(b.first.pushedAt ?? "") - Date.parse(a.first.pushedAt ?? ""));
    const best = matches[0];
    if (!best) continue;

    const orderedIds = [best.first.id, best.second.id].sort();
    const key = `v2:${combination.pair.join("+")}:${orderedIds.join(":")}`;
    const id = createHash("sha256").update(key).digest("hex").slice(0, 32);
    const supportingEvidence = [
      { project: best.first, evidence: best.firstEvidence },
      { project: best.second, evidence: best.secondEvidence },
    ].map(({ project, evidence }) => ({ url: project.url, quote: `${evidence.source === "description" ? "项目描述" : "README 摘录"}：${evidence.quote}`, observedAt: project.observedAt, relation: "supports" as const }));

    drafts.push({
      id,
      combinationKey: key,
      title: combination.title,
      targetUser: combination.audience,
      jobToBeDone: combination.job,
      hypothesis: `假设 ${best.first.fullName} 与 ${best.second.fullName} 的明确能力线索可支持“${combination.job}”。GitHub 证据只说明技术能力，用户问题与付费意愿尚未验证。`,
      projectIds: [best.first.id, best.second.id],
      projectNames: [best.first.fullName, best.second.fullName],
      score: Math.min(best.score, 65),
      supportingEvidence,
      counterEvidence: [{ url: null, quote: "尚无访谈、试用或付费承诺；这组技术信号不能证明真实需求。", observedAt: new Date().toISOString(), relation: "refutes" }],
      validationSteps: [combination.experiment, "检查已有替代方案，记录用户正在使用的工具与切换成本", "在写代码前要求至少一位目标用户承诺试用或安排下一次评估"],
      successMetric: "至少 3 位目标用户确认问题真实存在，且 2 位愿意试用原型",
      failureMetric: "目标用户已有足够好用的替代方案，或没有人愿意安排试用",
    });
  }
  return drafts;
}
