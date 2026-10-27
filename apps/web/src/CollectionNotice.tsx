import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "./api";
import { MonitoredDiscussion } from "./Monitoring";

export function CollectionNotice() {
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const monitoring = useQuery({ queryKey: ["monitoring"], queryFn: api.monitoring, refetchInterval: 5000 });
  const scan = dashboard.data?.lastScan;
  const incompleteScan = scan?.status === "failed" || scan?.status === "partial";
  const incompleteMonitors = monitoring.data?.items.filter((item) => item.status === "failed" || item.status === "partial").length ?? 0;
  const pause = monitoring.data?.pausedUntil;
  const paused = pause && Date.parse(pause) > Date.now();
  const changes = monitoring.data?.discussionChanges ?? [];
  const incomplete = incompleteScan || incompleteMonitors > 0 || paused || dashboard.isError || monitoring.isError;
  if (!incomplete && !changes.length) return null;
  return <>
    {changes.length > 0 && <aside className="collection-notice" aria-label="讨论变化提醒">
      <b>{changes.length} 条跟进讨论有变化，等待复核</b>
      <p>请核对是否影响研究结论。提醒保留到确认；关闭项目关注也会保留已有提醒。</p>
      <details><summary>查看并核对讨论变化</summary>{changes.map((issue) => <div key={issue.id}><small>{issue.fullName}{issue.enabled ? "" : " · 自动关注已关闭"}</small><MonitoredDiscussion id={issue.projectId} issue={issue} /></div>)}</details>
    </aside>}
    {incomplete && <aside className="collection-notice" role="status" aria-label="采集状态提醒">
    <b>采集尚未完整更新</b>
    {incompleteScan && <p>{scan.status === "failed" ? "最近一次扫描失败，发现列表保留之前采集的资料。" : "最近一次扫描仅部分成功，请核对未取得的资料。"} <Link to="/activity">查看扫描结果</Link></p>}
    {incompleteMonitors > 0 && <p>{incompleteMonitors} 个关注项目未完整刷新，失败字段保留旧资料。 <a href="#monitoring">查看关注详情</a></p>}
    {paused && <p>GitHub 限流，关注刷新暂停至 {new Date(pause!).toLocaleString("zh-CN")}。 <a href="#monitoring">查看暂停状态</a></p>}
    {dashboard.isError && <p>扫描状态暂时无法读取，请稍后重试；项目内容以标注的采集时间为准。</p>}
    {monitoring.isError && <p>持续关注状态暂时无法读取。 <a href="#monitoring">查看关注详情</a></p>}
    </aside>}
  </>;
}
