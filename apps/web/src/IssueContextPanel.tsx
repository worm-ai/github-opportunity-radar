import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Project } from "./api";
import { issueBodyDescription, issueCommentSamplingDescription } from "@radar/contracts/issues";
import { IssueMonitoring } from "./Monitoring";

const date = (value: string) => new Date(value).toLocaleString("zh-CN");
export function IssueContextPanel({ project, number }: { project: Project; number: number }) {
  const queryClient = useQueryClient();
  const integration = useQuery({ queryKey: ["integrations"], queryFn: api.integrations, refetchInterval: 3000 });
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const refresh = useMutation({ mutationFn: () => api.refreshIssue(project.id, number), onSuccess: () => { void queryClient.invalidateQueries(); } });
  const context = project.issueContexts?.[String(number)];
  const sample = project.issues.find((issue) => issue.number === number);
  const outdated = context && Math.max(Date.parse(sample?.updatedAt ?? context.issue.updatedAt), Date.parse(context.newestSampleUpdatedAt ?? context.issue.updatedAt)) > Date.parse(context.issue.updatedAt);
  const blocked = refresh.isPending || integration.data?.analysis.running || integration.data?.evidence.running || dashboard.data?.lastScan?.status === "running" || (integration.data?.runtime === "iii" && integration.data.engineState !== "connected");
  return <section className="issue-context" aria-label={`讨论核查 #${number}`}>
    <div className="issue-context-head"><b>讨论核查</b><button className="button-secondary" type="button" disabled={blocked} onClick={() => refresh.mutate()}>{refresh.isPending ? "正在核查讨论" : "核查状态与评论"}</button></div>
    <IssueMonitoring id={project.id} number={number} />
    {!context && <p className="context-note">尚未核查当前状态和评论。点击读取正文与最多 10 条评论；长讨论保留最早 5 + 最新 5 条，中间可能遗漏。同时核查样本中最多三个同仓库提及的 PR。不调用模型，也不提交研究。</p>}
    {refresh.isError && <p className="form-error" role="alert">{refresh.error.message}。已有快照保留。</p>}
    {context && <>
      <p className="context-note">采集 {date(context.observedAt)} · 当时{context.issue.state === "open" ? "开放" : "关闭"}{context.issue.stateReason ? `（${context.issue.stateReason}）` : ""} · 原作者 {context.issue.authorLogin ? `@${context.issue.authorLogin}` : "未知"} · {context.issue.authorAssociation}</p>
      <p className="context-note">开放不代表问题仍未解决，关闭也不证明方案有效。评论是作者陈述，需核对实现与替代。</p>
      {context.selectedForResearch && <p className="context-note">按需选择的讨论，不属于最近五条自动样本；后续扫描不会将它覆盖。保留最多十份核查，已选定期跟进的讨论优先保留。</p>}
      {outdated && <p className="form-error">新样本比此快照更新，请重新核查。旧讨论暂不进入模型分析。</p>}
      <details className="issue-current-body"><summary>核查时的正文</summary><p className="context-note issue-context-body-notice">{issueBodyDescription(context.issue)}</p><pre>{context.issue.bodyExcerpt || "没有正文"}</pre></details>
      {context.commentsError && <p className="form-error">本次评论读取失败：{context.commentsError}。{context.comments.length ? `下方保留 ${context.commentsObservedAt ? date(context.commentsObservedAt) : "先前"} 的旧评论，不用于本次模型分析。` : "未取得评论，不能推断没有回复。"}</p>}
      <p className="context-note">已读 {context.comments.length} / 当时 {context.issue.comments} 条评论 · {issueCommentSamplingDescription(context)} · {context.commentsComplete ? "条数与分页核对完整，正文仍可能截断" : "未覆盖完整讨论"}</p>
      {context.comments.map((comment) => <details className="issue-comment" key={comment.id}>
        <summary>{comment.authorLogin ? `@${comment.authorLogin}` : "作者未知"} · {comment.authorAssociation}{comment.isBot ? " · Bot" : ""} · {date(comment.updatedAt)}{comment.bodyTruncated ? " · 正文截断" : ""}</summary>
        <pre>{comment.bodyExcerpt || "没有评论正文"}</pre><a href={comment.url} target="_blank" rel="noreferrer">核对这条评论 ↗</a>
      </details>)}
      {!context.comments.length && !context.commentsError && <p className="context-note">本次没有读到评论，不代表有人确认需求或付费。</p>}
      <section aria-label="提及的 PR 核查">
        <b>后继实现线索</b>
        <p className="context-note">仅核查已读正文和评论中最多三个同仓库编号或 PR 地址。被提及不代表修复了原问题，已合并也不证明已发布或实际有效。</p>
        {!context.referencedPullRequests && <p className="context-note">旧快照尚未核查 PR 状态，请重新核查讨论。</p>}
        {context.referencedPullRequests && <>
          {context.referencedPullRequests.items.map((pull) => <details className="issue-comment" key={pull.number}>
            <summary>PR #{pull.number} · {pull.merged ? "已合并" : pull.state === "closed" ? "关闭未合并" : pull.draft ? "草稿" : "开放未合并"} · {pull.title}</summary>
            <p className="context-note">状态核查 {date(context.observedAt)}{pull.mergedAt ? ` · 合并 ${date(pull.mergedAt)}` : ""} · PR 更新 {date(pull.updatedAt)}</p>
            <pre>{pull.bodyExcerpt || "PR 没有描述正文"}{pull.bodyTruncated ? "\n（正文截断）" : ""}</pre>
            <a href={pull.url} target="_blank" rel="noreferrer">核对 PR ↗</a>
            {pull.merged && pull.mergeCommitSha && <p><a href={`${project.url}/commit/${pull.mergeCommitSha}`} target="_blank" rel="noreferrer">核对合并提交 ↗</a></p>}
          </details>)}
          {!context.referencedPullRequests.checkedNumbers.length && <p className="context-note">已读样本中未发现可核查的同仓库提及，不代表没有现有实现。</p>}
          {context.referencedPullRequests.omitted > 0 && <p className="context-note">另有 {context.referencedPullRequests.omitted} 个提及未核查；评论采样和正文截断还可能遗漏其他实现。</p>}
          {context.referencedPullRequests.notFoundNumbers.length > 0 && <p className="context-note">编号 {context.referencedPullRequests.notFoundNumbers.map((number) => `#${number}`).join("、")} 未返回公开 PR，可能是普通 Issue、已删除或不可访问；不表示没有解决方案。</p>}
          {context.referencedPullRequests.errors.map((error) => <p className="form-error" key={error.number}>PR #{error.number} 核查失败：{error.message}。状态未知。</p>)}
        </>}
      </section>
    </>}
  </section>;
}
