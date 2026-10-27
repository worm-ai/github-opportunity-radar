import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Project } from "./api";

export function IssueCollector({ project }: { project: Project }) {
  const [issue, setIssue] = useState("");
  const queryClient = useQueryClient();
  const integration = useQuery({ queryKey: ["integrations"], queryFn: api.integrations, refetchInterval: 3000 });
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const collect = useMutation({ mutationFn: () => api.importIssue(project.id, issue.trim()), onSuccess: () => { void queryClient.invalidateQueries(); } });
  const blocked = collect.isPending || integration.data?.analysis.running || integration.data?.evidence.running || dashboard.data?.lastScan?.status === "running" || (integration.data?.runtime === "iii" && integration.data.engineState !== "connected");
  const submit = (event: FormEvent) => { event.preventDefault(); if (!blocked && issue.trim()) collect.mutate(); };
  const search = `https://github.com/${project.fullName}/issues?q=${encodeURIComponent("is:issue")}`;
  const stale = Object.values(project.issueContexts ?? {}).filter((context) => context.selectedForResearch && !project.issues.some((issue) => issue.number === context.issue.number));
  return <details className="issue-collector">
    <summary>补充其他问题讨论{stale.length ? ` · ${stale.length} 份补充讨论待重查` : ""}</summary>
    <p className="context-note">最近五条样本可能遗漏长期任务。可在 <a href={search} target="_blank" rel="noreferrer">GitHub 查找本仓库的讨论 ↗</a>，再填编号或 Issue 地址，开放和关闭的讨论均可收录。</p>
    <form aria-label="补充指定讨论" onSubmit={submit}>
      <label>Issue 编号或地址<input aria-label="补充的 Issue" value={issue} onChange={(event) => { setIssue(event.target.value); collect.reset(); }} placeholder={`例如 4616 或 https://github.com/${project.fullName}/issues/4616`} maxLength={300} required /></label>
      <button type="submit" className="button-secondary" disabled={blocked || !issue.trim()}>{collect.isPending ? "正在补充讨论" : "收录并核查讨论"}</button>
    </form>
    <p className="context-note">读取正文及最早十条评论，不调用模型。每个项目保留最近十份讨论核查；超出后较早的补充讨论会退出可用材料，已保存判断的引文快照保留。</p>
    {stale.map((context) => <p className="form-error" key={context.issue.number}>#{context.issue.number} 的旧核查已被更新的样本超越，暂不作为研究材料。<button type="button" className="button-secondary" onClick={() => { setIssue(String(context.issue.number)); collect.reset(); }}>填入编号重新核查</button></p>)}
    {collect.isError && <p className="form-error" role="alert">{collect.error.message}。已有资料保留。</p>}
    {collect.isSuccess && <p className="context-note" role="status">已收录 #{collect.data.issue.number}，核查时{collect.data.issue.state === "open" ? "开放" : "关闭"}；关闭不代表已经解决。<Link to={`/opportunities?project=${encodeURIComponent(project.id)}&issue=${collect.data.issue.number}`}>查看问题与组合材料 →</Link></p>}
  </details>;
}
