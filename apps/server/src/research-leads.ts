import type { AnalysisRun } from "@radar/storage";

export type ResearchLead = {
  id: string; runId: string; candidateIndex: number; observedAt: string;
  title: string; status: "schema_failed" | "evidence_gap" | "rejected" | "review_incomplete";
  projects: AnalysisRun["analyzedProjects"];
  reason: string; gaps: Array<{ code: string; message: string }>;
  nextSteps: string[]; proposedExperiment: string | null;
  resume: { projectIds: string[]; question: string; originIssue?: { projectId: string; issueNumber: number } } | null;
};

const checkActions: Record<string, string> = {
  distinctRoles: "先比较现有单项目方案；若已足够解决问题，停止组合。",
  evidenceSupportsRoles: "到项目档案核查各组件接口原文，确认所声称的能力存在。",
  plausibleIntegration: "核查输入输出契约，再决定是否值得做最小兼容实验。",
  specificTestableProblem: "重新明确用户工作、实际障碍及可推翻该方向的结果。",
  claimsStayHypothetical: "去除未经核实的市场、兼容性和许可证断言。",
  problemSignalsRelevant: "重读问题正文和当前评论，确认方案实际干预同一失败环节。",
  profileFit: "明确候选工作与画像中的目标用户或重复工作如何对应，并核对交付约束；若无法说明，停止将其当作画像适配机会。",
};
const stringField = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const readableField = (value: unknown, limit: number) => {
  const text = stringField(value, limit);
  const questionMarks = (text.match(/\?/g) ?? []).length;
  return text.includes("\uFFFD") || (questionMarks >= 3 && questionMarks / Math.max(text.length, 1) >= 0.15) ? "" : text;
};

/** A read-only view of paid snapshots. It never promotes candidates or invents historical diagnostics. */
export function buildResearchLeads(runs: AnalysisRun[], limit = 12): ResearchLead[] {
  const leads: ResearchLead[] = [], seen = new Set<string>();
  for (const run of runs.slice(0, 10)) {
    if (run.status === "running" || run.reusedFrom) continue;
    const known = new Map(run.analyzedProjects.map((project) => [project.id, project]));
    for (const audit of (run.candidateAudits ?? []).slice(0, 5)) {
      const review = audit.review;
      const failedChecks = review ? Object.entries(review.checks).filter(([check, value]) => check === "profileFit"
        ? run.researchProfile && value !== undefined && value !== "aligned" && value !== "plausible"
        : value === false).map(([check]) => check) : [];
      const raw = audit.proposal && typeof audit.proposal === "object" && !Array.isArray(audit.proposal) ? audit.proposal as Record<string, unknown> : {};
      const ids = Array.isArray(raw.projectIds) ? raw.projectIds.filter((id): id is string => typeof id === "string") : [];
      const projects = [...new Set(ids)].flatMap((id) => known.get(id) ?? []);
      const title = readableField(raw.title, 200) || `候选 ${audit.index + 1}（标题需核对原始记录）`;
      const key = JSON.stringify([[...ids].sort(), title, run.focus?.question ?? null, run.focus?.originIssue ?? null]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (run.status === "succeeded" && audit.evidenceStatus === "passed" && review?.verdict === "keep" && !failedChecks.length) continue;
      const status: ResearchLead["status"] = audit.evidenceStatus === "schema_failed" ? "schema_failed"
        : audit.evidenceStatus === "evidence_failed" ? "evidence_gap"
        : review && (review.verdict === "reject" || failedChecks.length) ? "rejected" : "review_incomplete";
      const decision = run.decisions.find((item) => item.title === title && item.stage !== "accepted");
      const gaps = (audit.evidenceFailures ?? []).map(({ code, message }) => ({ code, message }));
      const reason = status === "review_incomplete" ? `本次运行未完成有效审查或结果保存。${run.error ?? "请查看原始运行记录。"}`
        : decision?.reason ?? (status === "rejected" ? review!.reason : "历史快照未保存具体缺口；须回到原文复核，不能推断缺口已经补齐。");
      const nextSteps = status === "rejected" ? failedChecks.map((check) => checkActions[check]).filter((action): action is string => Boolean(action))
        : status === "review_incomplete" ? ["先核查运行错误；未完成审查不表示技术方向已被否决。", "重新提交会调用模型；应先确认材料或故障已有变化。"]
        : [status === "schema_failed" ? "检查完整提案中的字段问题，再重新明确研究问题。" : "按下列缺口核查项目文档、Issue 正文或评论，勿把缺失引文当能力证据。"];
      if (status === "rejected" && !nextSteps.length) nextSteps.push("根据反方理由核查现有替代与关键假设；允许停止这条方向。");
      const safeIds = Array.isArray(raw.projectIds) && raw.projectIds.length === ids.length && ids.length >= 2 && ids.length <= 3 && new Set(ids).size === ids.length && ids.every((id) => known.has(id));
      const focusMatches = !run.focus || (run.focus.projectIds.length === ids.length && run.focus.projectIds.every((id) => ids.includes(id)));
      const job = audit.evidenceStatus === "passed" ? readableField(raw.jobToBeDone, 650) : "";
      const focusQuestion = readableField(run.focus?.question, 1200);
      const question = focusMatches ? focusQuestion || (!run.focus && job ? `重新核查这一待证伪假设：${job}。先检查反方理由、现有替代和关键接口，不将原提案作为事实。` : "") : "";
      leads.push({ id: `${run.id}:${audit.index}`, runId: run.id, candidateIndex: audit.index, observedAt: run.startedAt,
        title, status, projects, reason, gaps, nextSteps, proposedExperiment: audit.evidenceStatus === "passed" ? stringField(raw.firstExperiment, 2000) || null : null,
        resume: safeIds && question.trim().length >= 12 && status !== "schema_failed" ? { projectIds: ids, question: question.slice(0, 1200), ...(run.focus?.originIssue ? { originIssue: run.focus.originIssue } : {}) } : null,
      });
      if (leads.length >= Math.max(1, Math.min(limit, 12))) return leads;
    }
  }
  return leads;
}
