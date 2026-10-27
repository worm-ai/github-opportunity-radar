import type { IssueContext, PublicIssue } from "./issues.js";
import { collectedResearchIssues, issueContextOutdated, issueCommentSamplingDescription, pullRequestSourceText } from "./issues.js";
import type { RepositoryDocumentation } from "./documentation.js";
import type { TrialMeasurement } from "./validation.js";

export type ResearchSourceRef = { projectId: string } & (
  { kind: "description" | "readme" } | { kind: "issue"; issueNumber: number } |
  { kind: "comment"; issueNumber: number; commentId: number } | { kind: "documentation"; documentPath: string } |
  { kind: "pull_request"; issueNumber: number; pullRequestNumber: number } |
  { kind: "demand_source"; runId: string; sourceId: string } |
  { kind: "experiment"; experimentId: string }
);
export type ResearchSourceProject = {
  id: string; fullName: string; url: string; description: string | null; readmeExcerpt: string | null; observedAt: string;
  issues?: Array<Pick<PublicIssue, "number" | "title" | "bodyExcerpt" | "bodyTruncated" | "url" | "updatedAt">>;
  issuesFetchedAt?: string | null; issueContexts?: Record<string, IssueContext>; documentation?: RepositoryDocumentation | null;
};
export type ResearchSource = { key: string; ref: ResearchSourceRef; label: string; text: string; url: string; observedAt: string; notice: string; revision: string };
export const researchSourceKey = (ref: ResearchSourceRef) => {
  if (ref.kind === "demand_source") return `${ref.projectId}:demand_source:${ref.runId}:${ref.sourceId}`;
  if (ref.kind === "experiment") return `${ref.projectId}:experiment:${ref.experimentId}`;
  return `${ref.projectId}:${ref.kind}:${"issueNumber" in ref ? ref.issueNumber : ""}:${"commentId" in ref ? ref.commentId : ""}:${"documentPath" in ref ? ref.documentPath : ""}${"pullRequestNumber" in ref ? `:${ref.pullRequestNumber}` : ""}`;
};

// Browser-safe source catalog. An explicit failed/outdated refresh must never expose old comments as fresh evidence.
export function researchSources(projects: ResearchSourceProject[]): ResearchSource[] {
  const sources: ResearchSource[] = [];
  const add = (ref: ResearchSourceRef, source: Omit<ResearchSource, "ref" | "key">) => { if (source.text.trim()) sources.push({ ...source, ref, key: researchSourceKey(ref) }); };
  for (const project of projects) {
    for (const kind of ["description", "readme"] as const) add({ projectId: project.id, kind }, {
      label: `${project.fullName} · ${kind === "readme" ? "README" : "项目描述"}`, text: (kind === "readme" ? project.readmeExcerpt : project.description) ?? "",
      url: `${project.url}${kind === "readme" ? "#readme" : ""}`, observedAt: project.observedAt,
      notice: "项目自述；时间为档案观察时间，部分采集失败时可能保留旧摘录。", revision: "",
    });
    for (const issue of collectedResearchIssues(project)) {
      const stored = project.issueContexts?.[String(issue.number)];
      const context = stored && !issueContextOutdated(stored, issue.updatedAt) ? stored : null;
      const current = context?.issue ?? issue;
      const samplingNotice = context?.commentSampling ? `${issueCommentSamplingDescription(context)}；` : "";
      const discussionRevision = context ? JSON.stringify([context.issue.updatedAt, context.issue.state, context.issue.stateReason, context.issue.comments, context.commentsComplete, context.commentsError, context.comments.map((comment) => [comment.id, comment.updatedAt, comment.bodyExcerpt]), ...(context.commentSampling ? [context.commentSampling] : []), ...(context.referencedPullRequests ? [context.referencedPullRequests] : [])]) : current.updatedAt;
      const truncationNotice = current.bodyTruncated === true ? "正文截断" : current.bodyTruncated === false ? "正文未截断" : "正文截断状态未知（旧档案）";
      const notice = context ? `讨论核查时${context.issue.state}；作者 ${context.issue.authorLogin ?? "未知"} / ${context.issue.authorAssociation}；${context.commentsError ? "评论读取失败" : context.commentsComplete ? "评论条数与分页核对完整" : "评论不完整"}；${samplingNotice}${truncationNotice}。` : `Issue 样本片段，未取得有效的当前讨论核查；${truncationNotice}。`;
      add({ projectId: project.id, kind: "issue", issueNumber: issue.number }, { label: `${project.fullName} #${issue.number} · 问题原文`, text: `${current.title}\n${current.bodyExcerpt}`, url: current.url, observedAt: context?.observedAt ?? project.issuesFetchedAt ?? project.observedAt, notice, revision: discussionRevision });
      if (context && !context.commentsError) for (const comment of context.comments) add({ projectId: project.id, kind: "comment", issueNumber: issue.number, commentId: comment.id }, {
        label: `${project.fullName} #${issue.number} · @${comment.authorLogin ?? "未知"}${comment.isBot ? " [Bot]" : ""} · 评论 ${comment.id}`,
        text: comment.bodyExcerpt, url: comment.url, observedAt: context.commentsObservedAt ?? context.observedAt,
        notice: `公开评论，${comment.authorAssociation}${comment.isBot ? " / Bot" : ""}；${context.commentsComplete ? "条数与分页核对完整" : "仅有界评论"}；${samplingNotice}正文${comment.bodyTruncated ? "截断" : "未截断"}；作者陈述未实测。`, revision: JSON.stringify([discussionRevision, comment.updatedAt, comment.authorLogin, comment.authorAssociation, comment.isBot]),
      });
      for (const pull of context?.referencedPullRequests?.items ?? []) add({ projectId: project.id, kind: "pull_request", issueNumber: issue.number, pullRequestNumber: pull.number }, {
        label: `${project.fullName} PR #${pull.number} · ${pull.merged ? "已合并" : pull.state === "closed" ? "关闭未合并" : pull.draft ? "草稿" : "开放未合并"}`,
        text: pullRequestSourceText(pull), url: pull.url, observedAt: context!.observedAt,
        notice: "GitHub API 状态字段与 PR 作者自述；仅核查讨论样本中的同仓库提及，不证明修复覆盖、已发布、运行可用或市场需求。",
        revision: JSON.stringify(pull),
      });
    }
    for (const document of project.documentation?.documents ?? []) if (!document.stale) add({ projectId: project.id, kind: "documentation", documentPath: document.path }, {
      label: `${project.fullName} · ${document.path}`, text: document.excerpt, url: document.url, observedAt: document.observedAt,
      notice: document.commitSha ? `文档摘录；版本 ${document.ref ?? document.commitSha}；固定提交 ${document.commitSha}；Blob ${document.sha}；未验证安装运行、发行状态或接口兼容性。` : `文档摘录；Blob ${document.sha}；链接指向可变 HEAD，未做运行验证。`, revision: document.sha,
    });
  }
  return sources;
}

export type ResearchNoteInput = {
  requestId: string; author: "user" | "assistant"; title: string; question: string; projectIds: string[]; originIssue?: { projectId: string; issueNumber: number }; originDemandId?: string;
  decision: "continue" | "watch" | "stop"; conclusion: string; nextAction: string;
  /** Optional task-level comparison. It is evidence about this use, never a market conclusion. */
  valueMeasurement?: TrialMeasurement;
  evidence: Array<{ ref: ResearchSourceRef; quote: string }>; supersedesId?: string;
};
export type ResearchEvidenceSnapshot = { ref: ResearchSourceRef; label: string; quote: string; url: string; observedAt: string; notice: string; fingerprint: string };
export type ResearchNote = Omit<ResearchNoteInput, "requestId" | "evidence" | "supersedesId"> & {
  id: string; createdAt: string; projectNames: string[]; supersedesId: string | null;
  evidence: ResearchEvidenceSnapshot[];
};
export type ResearchNoteView = ResearchNote & { supersededBy: string | null; evidenceStates: Array<"same" | "changed" | "unavailable"> };
