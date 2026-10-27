import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ProjectMonitor } from "./api";
import type { MonitoredIssue } from "@radar/contracts/issues";

const label = { idle: "等待首次刷新", running: "正在刷新", succeeded: "已检查", partial: "部分更新", failed: "刷新失败" };
const date = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN") : "尚无记录";
const discussionLabel = { pending: "等待核查", baseline: "已建立基线", unchanged: "本次采样未变", changed: "发现变化", partial: "核查不完整", failed: "核查失败" };

export function MonitoredDiscussion({ id, issue }: { id: string; issue: MonitoredIssue }) {
  const client = useQueryClient();
  const acknowledge = useMutation({ mutationFn: () => api.acknowledgeMonitoredIssue(id, issue.number, issue.changeId!), onSuccess: () => { void client.invalidateQueries({ queryKey: ["monitor", id] }); void client.invalidateQueries({ queryKey: ["monitoring"] }); } });
  return <div className="monitored-discussion" data-monitored-issue={issue.number}>
    <Link to={`/projects/${id}#issue-${issue.number}`}>#{issue.number} · {issue.title}</Link>
    <p className="context-note">{discussionLabel[issue.status]} · 最近核查 {date(issue.lastCheckedAt)}</p>
    {issue.unreadChange && <p className="discussion-change">待核对 · {issue.changeDescription} · 发现于 {date(issue.changedAt)}</p>}
    {issue.error && <p className="form-error">{issue.error}。上次成功比对 {date(issue.lastSuccessAt)}，原快照保留。</p>}
    {issue.unreadChange && issue.changeId && <button className="button-secondary" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate()}>已核对 #{issue.number} 的变化</button>}
    {acknowledge.error && <p className="form-error">{acknowledge.error.message}</p>}
  </div>;
}

export function IssueMonitoring({ id, number }: { id: string; number: number }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["monitor", id], queryFn: () => api.projectMonitor(id), refetchInterval: 5000 });
  const item = query.data?.issues?.find((issue) => issue.number === number);
  const set = useMutation({ mutationFn: (enabled: boolean) => api.setMonitoredIssue(id, number, enabled), onSuccess: (value) => { client.setQueryData(["monitor", id], value); void client.invalidateQueries({ queryKey: ["monitoring"] }); } });
  return <div className="issue-monitor-selection">
    <label><input type="checkbox" checked={Boolean(item)} disabled={query.isLoading || query.isError || set.isPending} onChange={(event) => set.mutate(event.target.checked)} />跟进讨论 #{number}</label>
    {item && !query.data?.enabled && <p className="context-note">已选择；开启此项目的“持续关注”后定期核查，也可手动刷新仓库资料。</p>}
    {(set.error || query.error) && <p className="form-error">{(set.error || query.error)?.message}</p>}
  </div>;
}
function changes(item: ProjectMonitor) {
  if (!item.changes || !["succeeded", "partial"].includes(item.status)) return null;
  const value = item.changes, parts: string[] = [];
  if (value.stars) parts.push(`Star ${value.stars > 0 ? "+" : ""}${value.stars}`);
  if (value.readmeChanged) parts.push("README 摘录有变化");
  if (value.releaseBefore !== value.releaseAfter) parts.push(value.releaseBefore ? `版本标签 ${value.releaseBefore} → ${value.releaseAfter || "无标签"}` : `首次记录标签 ${value.releaseAfter}，缺少发布基线`);
  return parts.length ? parts.join(" · ") : "本次比对的 Star、版本标签与 README 摘录未变";
}

export function MonitoringOverview() {
  const query = useQuery({ queryKey: ["monitoring"], queryFn: api.monitoring, refetchInterval: 5000 });
  const client = useQueryClient();
  const revision = query.data?.items.map((item) => `${item.projectId}:${item.lastFinishedAt ?? ""}`).join("|");
  useEffect(() => {
    if (!revision) return;
    for (const queryKey of [["projects"], ["project"], ["observations"], ["discovery-brief"], ["research-notes"]]) void client.invalidateQueries({ queryKey });
  }, [revision, client]);
  return <section id="monitoring" className="monitoring-overview" aria-label="持续关注动态">
    <div className="section-head"><div><h2>持续关注</h2><span>已收录项目离开搜索结果后，仍按周期检查</span></div><small>{query.data?.items.length ?? 0} / {query.data?.limit ?? 20}</small></div>
    {query.isError && <p className="form-error">{query.error.message}</p>}
    {query.data?.pausedUntil && <p className="form-error">GitHub 限流中，关注刷新暂停至 {date(query.data.pausedUntil)}。原资料保留。</p>}
    {query.data && !query.data.items.length && <p className="context-note">在项目档案打开“持续关注”，服务运行期间会定期刷新资料。<Link to="/projects">选择关注的项目 ↗</Link></p>}
    {query.data?.items.map((item) => <article className="monitor-row" key={item.projectId} data-monitor-id={item.projectId}>
      <div><Link to={`/projects/${item.projectId}`}>{item.fullName}</Link><small>{label[item.status]} · 最近完成 {date(item.lastFinishedAt)}</small></div>
      {changes(item) && <p>{changes(item)}</p>}
      {item.error && <p className="form-error">{item.error}；既有资料保留。</p>}
      {item.warning && <p className="form-error">{item.warning}；失败字段保留旧资料。</p>}
      {item.issues?.map((issue) => <MonitoredDiscussion key={issue.id} id={item.projectId} issue={issue} />)}
      <small>下次检查 {date(item.nextDueAt)}</small>
    </article>)}
    {query.data && <p className="context-note">成功后每 {query.data.intervalHours} 小时检查，单批最多 {query.data.batchLimit} 个；服务需保持运行。刷新仓库资料与已选讨论，不自动调用模型。讨论变化只表示需复核研究判断。</p>}
  </section>;
}

export function ProjectMonitoring({ id }: { id: string }) {
  const client = useQueryClient();
  const [selection, setSelection] = useState<boolean | null>(null);
  const query = useQuery({ queryKey: ["monitor", id], queryFn: () => api.projectMonitor(id), refetchInterval: 5000 });
  const integration = useQuery({ queryKey: ["integrations"], queryFn: api.integrations, refetchInterval: 5000 });
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, refetchInterval: 5000 });
  const invalidate = () => {
    for (const queryKey of [["monitor", id], ["monitoring"], ["project", id], ["projects"], ["observations", id], ["discovery-brief"], ["research-notes"]]) void client.invalidateQueries({ queryKey });
  };
  useEffect(() => { if (query.data?.lastFinishedAt) { void client.invalidateQueries({ queryKey: ["project", id] }); void client.invalidateQueries({ queryKey: ["observations", id] }); void client.invalidateQueries({ queryKey: ["research-notes"] }); } }, [query.data?.lastFinishedAt, id, client]);
  const set = useMutation({ mutationFn: (enabled: boolean) => api.setProjectMonitor(id, enabled), onSuccess: (value) => { client.setQueryData(["monitor", id], value); setSelection(null); invalidate(); }, onError: () => { setSelection(null); invalidate(); } });
  const refresh = useMutation({ mutationFn: () => api.refreshProject(id), onSettled: invalidate });
  const state = integration.data;
  const blocked = refresh.isPending || !state || dashboard.data?.lastScan?.status === "running" || state.analysis.running || state.evidence.running || (state.runtime === "iii" && state.engineState !== "connected");
  return <section className="project-monitor" aria-label="项目持续关注">
    <div className="monitor-actions"><label><input type="checkbox" checked={selection ?? Boolean(query.data?.enabled)} disabled={query.isLoading || set.isPending || query.isError} onChange={(event) => { setSelection(event.target.checked); set.mutate(event.target.checked); }} />持续关注此项目</label><button className="button-secondary" disabled={blocked} onClick={() => refresh.mutate()}>{refresh.isPending || query.data?.status === "running" ? "正在刷新仓库资料" : "刷新仓库资料"}</button></div>
    <p className="context-note">更新 README、版本标签与近期问题；可在下方讨论中选择最多三条定期跟进，包括已关闭讨论。沿用关注周期，不自动重跑模型；补充文档仍需单独核查。</p>
    {query.data?.issues?.map((issue) => <MonitoredDiscussion key={issue.id} id={id} issue={issue} />)}
    {query.data?.lastAttemptAt && <p className="context-note">{label[query.data.status]} · 最近完成 {date(query.data.lastFinishedAt)}{query.data.enabled ? ` · 下次检查 ${date(query.data.nextDueAt)}` : " · 未开启自动关注"}</p>}
    {changes(query.data ?? { projectId: id, enabled: false, status: "idle" }) && <p className="context-note">{changes(query.data!)}</p>}
    {(query.error || set.error || refresh.error) && <p className="form-error">{(query.error || set.error || refresh.error)?.message}</p>}
    {query.data?.error && !refresh.isError && <p className="form-error">{query.data.error}；既有资料保留。</p>}
    {query.data?.warning && <p className="form-error">{query.data.warning}；失败字段保留旧资料。</p>}
  </section>;
}
