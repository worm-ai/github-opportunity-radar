import type { OpportunityDraft, ResearchProfile } from "@radar/analysis";
import type { AnalysisRun, OpportunityRecord, ScanRun } from "@radar/storage";
import { explainAnalysisOutcome } from "@radar/contracts/analysis-outcome";
import { measurementValue, trialTimeSummary } from "@radar/contracts/validation";
import { buildResearchLeads } from "./research-leads.js";
import type { ResearchNoteView } from "@radar/contracts/research";
import type { TechnicalExperiment } from "./experiments.js";

// Repository content and model output are data, including in exported Markdown.
export function reportText(value: unknown): string {
  return String(value ?? "待补充").replace(/\r?\n/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_{}\[\]()#+!|])/g, "\\$1");
}

function researchQuestionText(value: string): string {
  return /\?{2,}|�/.test(value)
    ? "原研究问题包含不可恢复字符，未作为可读证据显示；请以指定 Issue、技术实测和来源引用为准。"
    : reportText(value);
}

export function sourceLink(value: string | null): string {
  if (!value) return "无来源 URL";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? `[原始来源](${url.href.replace(/\(/g, "%28").replace(/\)/g, "%29")})` : "无有效 HTTPS 来源";
  } catch { return "无有效来源"; }
}

function profileLines(profile?: ResearchProfile | null): string[] {
  return profile ? ["研究画像（当时的筛选背景，不是需求证据）：", `- 目标用户：${reportText(profile.targetUser || "未指定")}`, `- 反复工作：${reportText(profile.recurringWork || "未指定")}`, `- 技术与交付约束：${reportText(profile.constraints || "未指定")}`, ""] : [];
}

function opportunityLines(item: OpportunityDraft): string[] {
  return [
    `### ${reportText(item.title)}`, "",
    ...profileLines(item.researchProfile),
    `- 目标用户：${reportText(item.targetUser)}`,
    `- 待完成工作：${reportText(item.jobToBeDone)}`,
    `- 组合项目：${reportText(item.projectNames.join(" + "))}`, "",
    ...(item.researchFocus ? [`- 定向研究问题（待证伪，不是需求证据）：${researchQuestionText(item.researchFocus.question)}`, ""] : []),
    ...(item.researchFocus?.originIssue ? [`- 指定问题起点：项目 ID ${reportText(item.researchFocus.originIssue.projectId)} #${item.researchFocus.originIssue.issueNumber}（单条公开讨论，非客户或付费证明）`, ""] : []),
    reportText(item.hypothesis), "",
    "#### 最初提案的实验建议", "", reportText(item.firstExperiment ?? item.validationSteps[0]), "",
    "#### 组件分工", "",
    ...(item.components ?? []).map((component) => `- ${reportText(item.projectNames[item.projectIds.indexOf(component.projectId)])}：${reportText(component.role)}；输入：${reportText(component.input)}；输出：${reportText(component.output)}`), "",
    `- 对接计划：${reportText(item.integrationPlan)}`,
    `- 现有替代：${reportText(item.alternatives ?? "待调研")}`,
    `- 为什么现在：${reportText(item.whyNow ?? "待验证")}`, "",
    "#### 技术证据", "",
    ...item.supportingEvidence.map((evidence) => `- ${reportText(evidence.quote)} — ${sourceLink(evidence.url)}；采集于 ${reportText(evidence.observedAt)}${evidence.sourcePath ? `；文件 ${reportText(evidence.sourcePath)}；Blob ${reportText(evidence.sourceSha)}` : ""}`), "",
    "#### 问题线索", "",
    ...(item.problemEvidence?.length ? item.problemEvidence.map((evidence) => `- ${reportText(evidence.quote)} — ${sourceLink(evidence.url)}；采集于 ${reportText(evidence.observedAt)}`) : ["- 没有直接 Issue 问题引用，此方向仅有技术能力证据。"]), "",
    "#### 反证与缺口", "",
    ...item.counterEvidence.map((evidence) => `- ${reportText(evidence.quote)}`), "",
    "#### 验证步骤与标准", "",
    ...item.validationSteps.map((step, index) => `${index + 1}. ${reportText(step)}`), "",
    `- 成功指标：${reportText(item.successMetric)}`,
    `- 停止指标：${reportText(item.failureMetric)}`, "",
  ];
}

export function researchReport(input: { scan: ScanRun | null; analysis: AnalysisRun | null; drafts: OpportunityDraft[]; projectCount: number; issueCount: number }): string {
  const { scan, analysis, drafts } = input;
  const outcome = analysis ? explainAnalysisOutcome(analysis) : null;
  const usage = analysis?.usage;
  const usageLabel = analysis?.reusedFrom ? `复用分析 ${reportText(analysis.reusedFrom)}；本次未调用模型，不重复计入历史用量` : usage ? `${usage.complete ? "输入/输出 token" : "已知 token 小计（完整用量未确认）"}：${usage.promptTokens}/${usage.completionTokens}` : "未收到 token 用量回执，实际消耗未知";
  const lines = ["# 机会捕手 · 研究简报", "",
    `导出时间：${new Date().toISOString()}`, "",
    `- 最近扫描：${scan?.finishedAt ?? scan?.startedAt ?? "尚无"}（${scan?.status ?? "尚无"}）`,
    `- 最近分析：${analysis?.finishedAt ?? analysis?.startedAt ?? "尚无"}（${analysis?.status ?? "尚无"}）`,
    `- 分析编号：${analysis?.id ?? "尚无"}`,
    ...profileLines(analysis?.researchProfile),
    ...(analysis?.focus ? [`- 研究方式：指定组件定向深读`, `- 研究问题（待证伪，不是需求证据）：${researchQuestionText(analysis.focus.question)}`, `- 选定项目 ID：${reportText(analysis.focus.projectIds.join(", "))}`] : []),
    ...(analysis?.focus?.originIssue ? [`- 指定问题起点：项目 ID ${reportText(analysis.focus.originIssue.projectId)} #${analysis.focus.originIssue.issueNumber}（单条公开讨论，非客户或付费证明）`] : []),
    `- 模型：${reportText(analysis?.model ?? "未配置")}；规则：${reportText(analysis?.promptVersion ?? "尚无")}`,
    ...(analysis?.modelsUsed?.length ? [`- 实际使用的模型：${reportText(analysis.modelsUsed.join("、"))}`] : []),
    `- 模型用量：${usageLabel}`,
    `- 分析范围：${analysis?.analyzedProjects.length ?? 0} 个项目；保留 ${analysis?.opportunities ?? 0} / 淘汰 ${analysis?.rejected ?? 0}`,
    ...(outcome ? [`- 结果解释：${outcome.label}；${outcome.detail}`] : []),
    ...(analysis?.selection ? [`- 目录浏览：${analysis.selection.catalogProjects} 个项目；${analysis.selection.groups.length} 组深读线索（选择理由属于模型推断）`] : []),
    `- 工作区累计：${input.projectCount} 个项目 / ${input.issueCount} 条公开 Issue 样本`, "",
    "> 所有机会都是待验证假设。公开 Issue 不能证明付费需求，模型审查不能替代人工核验。", "",
    ...(analysis ? ["> 提案与反方分次调用模型；角色分离和免费模型切换均不代表独立验证。通过审查仅表示本轮未被否决，仍需核查接口和需求。", ""] : []),
    "## 本次分析保留的方向", "",
  ];
  if (analysis?.error) lines.push(`分析失败：${reportText(analysis.error)}`, "");
  if (!drafts.length) lines.push("本次尚无保留方向。历史收藏可在机会工作台查看。", "");
  for (const draft of drafts) lines.push(...opportunityLines(draft));
  if (analysis?.selection) {
    lines.push("## 目录筛选（模型推断）", "");
    for (const warning of analysis.selection.warnings ?? []) lines.push(`- 筛选提示：${reportText(warning)}`);
    for (const group of analysis.selection.groups) lines.push(`- ${reportText(group.researchQuestion)}：${reportText(group.projectNames.join(" + "))}；${reportText(group.reason)}`);
    for (const skipped of analysis.selection.skipped) lines.push(`- 未选：${reportText(skipped.projectName)}；${reportText(skipped.reason)}`);
    lines.push("");
  }
  lines.push("## 深读范围", "", ...(analysis?.analyzedProjects ?? []).map((project) => `- ${reportText(project.fullName)} — ${sourceLink(project.url)}`), "", "## 候选淘汰记录", "");
  const analyzedById = new Map((analysis?.analyzedProjects ?? []).map((project) => [project.id, project]));
  for (const decision of analysis?.decisions.filter((item) => item.stage !== "accepted") ?? []) {
    lines.push(`- ${reportText(decision.title)}（${decision.stage}）：${reportText(decision.reason)}`);
    for (const id of decision.projectIds ?? []) {
      const project = analyzedById.get(id);
      if (project) lines.push(`  - 相关项目：${reportText(project.fullName)} — ${sourceLink(typeof project.url === "string" ? project.url : null)}`);
    }
  }
  const leads = analysis ? buildResearchLeads([analysis]) : [];
  if (leads.length) {
    lines.push("", "## 待核查的研究线索", "", "未进入机会列表；以下检查由现有快照派生，不表示已补证或已执行实验。", "");
    for (const lead of leads) lines.push(`### ${reportText(lead.title)}（${lead.status}）`, "", `- 原运行：${reportText(lead.runId)}；候选 ${lead.candidateIndex + 1}`, `- 原因：${reportText(lead.reason)}`, ...lead.nextSteps.map((step) => `- 下一步检查：${reportText(step)}`), ...(lead.proposedExperiment ? [`- 原提案的实验建议（模型生成，未执行）：${reportText(lead.proposedExperiment)}`] : []), "");
  }
  lines.push("", "## 候选与审查快照", "", "以下为模型输出，不是事实或人工验证；原文核验不保证语义判断正确。", "");
  if (!analysis?.candidateAudits) lines.push("本次历史结果没有完整候选快照，不能逐字段复核原始提案；复用缓存不会补造历史内容。", "");
  for (const audit of analysis?.candidateAudits ?? []) {
    lines.push(`### 候选 ${audit.index + 1}（${audit.evidenceStatus}）`, "", "#### 完整提案（模型输出）", "", ...JSON.stringify(audit.proposal, null, 2).split("\n").map((line) => `    ${line}`), "");
    if (audit.evidenceFailures?.length) {
      lines.push("#### 原文核验缺口", "", ...audit.evidenceFailures.map((failure) => `- ${reportText(failure.code)}：${reportText(failure.message)}`), "", "这些缺口可转成补证研究任务；系统不会把它们升级成机会。", "");
    }
    lines.push("#### 完整审查（模型判断）", "");
    if (audit.review) lines.push(...JSON.stringify(audit.review, null, 2).split("\n").map((line) => `    ${line}`), "");
    else lines.push("无有效审查快照；不能推断审查检查通过。", "");
  }
  lines.push("", "## 最近扫描的发现渠道", "");
  for (const track of scan?.tracks ?? []) lines.push(`- ${reportText(track.label)}：发现 ${track.found ?? 0}；查询：${reportText(track.query)}${track.error ? `；失败：${reportText(track.error)}` : ""}`);
  for (const warning of scan?.warnings ?? []) lines.push(`- 采集警告：${reportText(warning)}`);
  return `${lines.join("\n")}\n`;
}

export function opportunityReport(item: OpportunityRecord, context: { researchNotes?: ResearchNoteView[]; experiments?: TechnicalExperiment[] } = {}): string {
  const notes = (context.researchNotes ?? []).filter((note) => !note.supersededBy && note.projectIds.length === item.projectIds.length && note.projectIds.every((id) => item.projectIds.includes(id))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const experiments = (context.experiments ?? []).filter((record) => record.projectIds.some((id) => item.projectIds.includes(id)));
  const updates = ["## 后续研究与实测", "", "先核对后续判断是否适用于当前问题，再决定是否执行原提案。研究判断和技术实测均不是市场验证。", ""];
  for (const note of notes) {
    updates.push(`### 同一项目组合的研究判断：${reportText(note.title)}`, "", `- 判断：${{ continue: "继续研究", watch: "等待变化", stop: "停止这条方向" }[note.decision]}；${note.author === "assistant" ? "代理研究，待人工复核" : "用户判断"}；${reportText(note.createdAt)}`, `- 研究问题：${reportText(note.question)}`, ...(note.originIssue ? [`- 问题起点：项目 ${reportText(note.originIssue.projectId)} #${note.originIssue.issueNumber}`] : []), `- 结论：${reportText(note.conclusion)}`, `- 下一步与重新审视条件：${reportText(note.nextAction)}`, ...(note.evidenceStates.some((state) => state !== "same") ? ["- 引用来源已变化或暂不可用，继续行动前请重新核对原文。"] : []), `- 判断编号：${reportText(note.id)}`, "");
    for (const evidence of note.evidence) updates.push(`- 引用：${reportText(evidence.quote)} — ${sourceLink(evidence.url)}；采集于 ${reportText(evidence.observedAt)}；${reportText(evidence.notice)}`);
    updates.push("");
  }
  for (const record of experiments) updates.push(`### 相关技术实测：${reportText(record.title)}`, "", `- 实测编号：${reportText(record.id)}；${reportText(record.executedAt)}`, `- 相关项目：${reportText(record.projectIds.join(", "))}（按共同项目关联，可能针对其他问题）`, `- 结论：${reportText(record.conclusion)}`, `- 下一步：${reportText(record.nextAction)}`, ...record.limitations.map((limit) => `- 边界：${reportText(limit)}`), ...record.artifacts.map((artifact) => `- 归档产物：${reportText(artifact.name)}；SHA-256 ${reportText(artifact.sha256)}`), "");
  if (!notes.length && !experiments.length) updates.push("当前没有随报告提供同组合研究判断或相关实测；这不证明实验尚未执行。", "");
  const lines = ["# 机会验证研究记录", "", ...(item.status === "candidate" && item.supersededAt ? [`> 历史候选：${reportText(item.supersededAt)} 被后续同范围分析移出当前列表。该操作不表示假设已被证伪；继续前应复核来源与研究判断。`, ""] : []), ...(/^(deepseek|opencode|codex|local-cli)-/.test(item.combinationKey) ? ["> 提案与反方分次调用模型；角色分离和模型切换均不代表独立验证。通过审查仅表示本轮未被否决，仍需核查接口和需求。", ""] : []), ...updates, "## 原始机会提案", "", ...opportunityLines(item), `- 当前状态：${item.status}`,
    `- 市场证据：${item.marketStatus === "evidence_recorded" ? "已记录外部验证，不代表市场成立" : "尚未验证"}`];
  for (const record of item.validationRecords) {
    lines.push(`- 验证方法：${record.method}；结果：${record.outcome}；记录于 ${record.recordedAt}`, `- 观察记录：${reportText(record.note)}`);
    if (record.trialMeasurement) {
      const measurement = record.trialMeasurement;
      lines.push(`- 同一任务对照：${reportText(measurement.taskDescription)}；基线方法：${reportText(measurement.baselineMethod)}；使用后方法：${reportText(measurement.assistedMethod)}；可比：${measurement.comparable ? "是" : "否"}；前后均完成：${measurement.bothCompleted ? "是" : "否"}；计时：${measurement.timing}；样本：${measurement.tasksCompared}；基线分钟：${measurementValue(measurement.baselineMinutes)}；使用后分钟：${measurementValue(measurement.assistedMinutes)}；误留：${measurementValue(measurement.falseKeeps)}；漏选：${measurementValue(measurement.missedCandidates)}`);
      lines.push(`- 耗时对照：${trialTimeSummary(measurement)}`);
    }
  }
  const progress = item.validationProgress ?? [];
  if (progress.length) {
    lines.push("", "## 验证步骤执行记录", "", "> 步骤执行记录不证明市场需求或付费意愿。");
    for (const entry of progress) lines.push(`- 步骤 ${entry.index + 1} · ${entry.status === "completed" ? "已完成" : "跳过"} · ${reportText(entry.updatedAt)}${item.validationSteps[entry.index] !== entry.step ? " · 原步骤已变化，请重新核对" : ""}`, `  - ${reportText(entry.step)}`, `  - 记录：${reportText(entry.note)}`);
  }
  return `${lines.join("\n")}\n`;
}
