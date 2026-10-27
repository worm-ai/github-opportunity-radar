export type PublicIssue = {
  // Absent on legacy automatic samples: do not infer completeness from excerpt length.
  id: number; number: number; title: string; bodyExcerpt: string; bodyTruncated?: boolean; url: string;
  state: "open" | "closed"; createdAt: string; updatedAt: string;
  comments: number; reactions: number; authorAssociation: string; authorLogin?: string | null;
};

// A later display/model budget can truncate an already bounded source again.
export function boundedIssueBody(source: { bodyExcerpt: string; bodyTruncated?: boolean | null }, limit: number) {
  return { bodyExcerpt: source.bodyExcerpt.slice(0, limit), bodyTruncated: source.bodyTruncated === true || source.bodyExcerpt.length > limit ? true : source.bodyTruncated ?? null };
}

export function issueBodyDescription(source: Pick<PublicIssue, "bodyExcerpt" | "bodyTruncated">) {
  if (source.bodyTruncated === true) return `正文已截断，仅保留前 ${source.bodyExcerpt.length.toLocaleString("en-US")} 字符；请核对原始讨论。`;
  if (source.bodyTruncated === false) return "采集时正文未截断；当前内容仍需核对原始讨论。";
  return "旧档案未记录正文截断状态，请核对原始讨论的完整内容。";
}
export type MonitoredIssue = {
  id: string; number: number; title: string;
  status: "pending" | "baseline" | "unchanged" | "changed" | "partial" | "failed";
  lastCheckedAt: string | null; lastSuccessAt: string | null; error: string | null;
  fingerprint: string | null; previousState: "open" | "closed" | null; previousComments: number | null;
  changeId: string | null; changedAt: string | null; unreadChange: boolean; changeDescription: string | null;
};
export type IssueContext = {
  // Explicit selection is separate from the automatic recent-Issue sample.
  selectedForResearch?: boolean;
  newestSampleUpdatedAt?: string;
  issue: PublicIssue & { stateReason: string | null; closedAt: string | null; bodyTruncated: boolean };
  comments: Array<{ id: number; url: string; bodyExcerpt: string; bodyTruncated: boolean; authorLogin: string | null; authorAssociation: string; isBot: boolean; createdAt: string; updatedAt: string }>;
  // Absent on legacy snapshots, which only sampled the first page.
  commentSampling?: "all" | "first" | "first-and-latest";
  commentsComplete: boolean;
  commentsError: string | null;
  commentsObservedAt: string | null;
  // Only references in the bounded body/comment sample; not the repository's complete implementation history.
  referencedPullRequests?: {
    checkedNumbers: number[]; omitted: number; notFoundNumbers: number[];
    errors: Array<{ number: number; message: string }>;
    items: Array<{ number: number; title: string; bodyExcerpt: string; bodyTruncated: boolean; url: string;
      state: "open" | "closed"; draft: boolean; merged: boolean; mergedAt: string | null;
      mergeCommitSha: string | null; updatedAt: string }>;
  };
  observedAt: string;
};

export function pullRequestSourceText(pull: NonNullable<IssueContext["referencedPullRequests"]>["items"][number]) {
  return `${pull.title}\nstate: ${pull.state}\ndraft: ${pull.draft}\nmerged: ${pull.merged}\nmerged_at: ${pull.mergedAt ?? "null"}\nmerge_commit_sha: ${pull.mergeCommitSha ?? "null"}\n${pull.bodyExcerpt}`;
}

export function issueCommentSamplingDescription(context: Pick<IssueContext, "commentSampling" | "commentsComplete">) {
  if (context.commentSampling === "first-and-latest") return "开头与末尾采样（最多最早 5 + 最新 5 条，中间可能遗漏）";
  if (context.commentSampling === "all" || context.commentsComplete) return "单页评论读取";
  return "最早评论采样（后续回复可能遗漏）";
}

export function issueContextOutdated(context: IssueContext, sampleUpdatedAt: string) {
  return Math.max(Date.parse(sampleUpdatedAt), Date.parse(context.newestSampleUpdatedAt ?? context.issue.updatedAt)) > Date.parse(context.issue.updatedAt);
}

// Recent samples rotate independently of saved, checked discussions.
export function collectedResearchIssues<T extends { number: number }>(project: { issues?: T[]; issueContexts?: Record<string, IssueContext> }): Array<T | IssueContext["issue"]> {
  const issues = new Map<number, T | IssueContext["issue"]>((project.issues ?? []).map((issue) => [issue.number, issue]));
  for (const context of Object.values(project.issueContexts ?? {}).sort((a, b) => a.issue.number - b.issue.number)) {
    if (!issues.has(context.issue.number) && !issueContextOutdated(context, context.issue.updatedAt)) issues.set(context.issue.number, context.issue);
  }
  return [...issues.values()];
}
