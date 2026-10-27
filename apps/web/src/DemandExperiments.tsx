import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type DemandRun } from "./api";
import { experimentHref, experimentVersionLabels, matchDemandExperiments, type ExperimentMatch } from "./demand-experiments";

export function DemandExperiments({ run }: { run: DemandRun }) {
  const query = useQuery({ queryKey: ["technical-experiments"], queryFn: api.experiments, retry: false });
  const runs = useQuery({ queryKey: ["technical-experiment-runs"], queryFn: api.experimentRuns, retry: false, refetchInterval: 3000 });
  const startRun = useMutation({ mutationFn: api.startExperimentRun, onSuccess: () => { void runs.refetch(); } });
  const matches = run.snapshot ? matchDemandExperiments(run.snapshot, query.data?.records ?? []) : [];
  const activeRun = runs.data?.find(item => item.status === "queued" || item.status === "running");

  const exportBundle = () => {
    const payload = { format: "demand-with-manual-experiments-v1", retrievedAt: new Date().toISOString(), run, experiments: matches, archiveWarnings: query.data?.warnings ?? [] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `demand-${run.id}-with-experiments.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const renderMatches = (items: ExperimentMatch[]) => items.map(({ record, repositories, unmatchedRepositories }) => {
    const latestRun = runs.data?.find(item => item.experimentId === record.id);
    const running = latestRun?.status === "queued" || latestRun?.status === "running";
    const status = latestRun?.status === "succeeded" ? "最近一次运行成功" : latestRun?.status === "failed" ? "最近一次运行失败" : running ? "运行中" : null;
    return <div className="demand-experiment" key={record.id}>
      <h4><Link to={experimentHref(record.id)}>{record.title}</Link>{record.id.includes("-rerun-") && <span className="context-note">（独立入口复跑）</span>}</h4>
      <p><b>验证问题：</b>{record.question}</p>
      <p><b>实测结论：</b>{record.conclusion}</p>
      <ul>{repositories.map(source => <li key={source.repository}>
        <b>{source.repository} · {experimentVersionLabels[source.version]}</b><br />
        {source.modification ? "上游基线提交" : "实测提交"}：<code>{source.experimentCommit}</code><br />
        研究源码提交：{source.researchCommits.length ? source.researchCommits.map(commit => <code key={commit}>{commit} </code>) : "未知"}
        {source.modification && <p>修改内容：{source.modification.description}<br /><a href={`/api/v1/experiments/${encodeURIComponent(record.id)}/artifacts/${encodeURIComponent(source.modification.artifact)}`} download>下载修改代码与补丁</a><small className="artifact-hash">SHA-256 {source.modification.sha256}</small></p>}
      </li>)}</ul>
      {unmatchedRepositories.length > 0 && <p>实验还涉及本次研究未匹配的仓库：{unmatchedRepositories.join("、")}；不能把整个组合结果归属于上面的单个候选。</p>}
      <details><summary>观察、反证与未覆盖范围</summary><p>执行时间：{new Date(record.executedAt).toLocaleString("zh-CN")}；输入：{record.inputOrigin}</p><p>环境：{record.environment}</p><ul>{record.checks.map((check, index) => <li key={index}><b>{check.outcome === "supported" ? "支持" : check.outcome === "refuted" ? "反驳" : "未确定"} · {check.label}</b><p>{check.observation}</p></li>)}</ul><h4>验证边界</h4><ul>{record.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>
      <p><b>实测建议的下一步：</b>{record.nextAction}</p>
      {query.data?.runnableIds?.includes(record.id) && <div className="demand-experiment-run">
        <button type="button" className="button-secondary" disabled={Boolean(activeRun && activeRun.id !== latestRun?.id) || running || startRun.isPending || runs.isPending} onClick={() => startRun.mutate(record.id)}>{startRun.isPending ? "正在启动实测" : running ? "实测运行中" : "开始受控实测"}</button>
        {status && <span className="context-note">{status}{latestRun?.error ? `：${latestRun.error}` : ""}</span>}
        <small className="context-note">仅运行项目登记的固定入口，不执行任意仓库命令；结果保存为技术实测记录。</small>
        {latestRun?.status === "succeeded" && <Link className="button-secondary" to={`/research?run=${encodeURIComponent(run.id)}&experiment=${encodeURIComponent(record.id)}#demand-decisions`}>基于此实测形成判断草稿</Link>}
      </div>}
      <Link to={experimentHref(record.id)}>查看原始实测与产物下载</Link>
    </div>;
  });

  const visibleMatches = matches.slice(0, 3);
  const historicalMatches = matches.slice(3);
  return <section id="demand-experiments" className="demand-experiments" aria-label="相关人工实测">
    <h3>相关人工实测 · 补充证据</h3>
    <p className="context-note">按同一 GitHub 仓库关联；是否适用于本次需求仍需核对验证问题与边界。同一提交不代表本次研究读到了实测涉及的全部实现，历史模型判断保持原样。</p>
    {query.isPending && <p role="status">正在核对实测归档…</p>}
    {query.isError && <p role="alert">实测归档读取失败，不能判断是否存在相关实验。<button type="button" className="button-secondary" onClick={() => { void query.refetch(); }}>重试读取实测</button></p>}
    {query.data?.warnings.map(warning => <p className="form-error" key={warning}>{warning}</p>)}
    {query.isSuccess && !matches.length && <p>当前可读归档中没有同仓库实测；没有记录不证明候选未经测试或不可用。</p>}
    {!query.isError && renderMatches(visibleMatches)}
    {!query.isError && historicalMatches.length > 0 && <details className="demand-experiment-history"><summary>查看其余 {historicalMatches.length} 条历史实测（默认折叠）</summary>{renderMatches(historicalMatches)}</details>}
    {startRun.isError && <p className="form-error" role="alert">无法启动受控实测：{startRun.error.message}</p>}
    {query.isSuccess && matches.length > 0 && <div className="demand-actions"><button type="button" className="button-secondary" disabled={query.isFetching} onClick={exportBundle}>导出研究与补充实测</button><span className="context-note">包含当前研究快照、实测记录及版本对应；原始研究导出保留。</span></div>}
  </section>;
}
