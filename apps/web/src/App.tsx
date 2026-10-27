import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bookmark, Check, ChevronRight,
  CircleHelp, Clock3, Compass, ExternalLink, FileSearch2, FolderGit2, FlaskConical,
  Gauge, Github, Lightbulb, LoaderCircle, Play, Radar, Search, Settings2,
  ShieldAlert, Sparkles, X,
} from "lucide-react";
import { api, type AnalysisRun, type DemandSummary, type IntegrationStatus, type Opportunity, type Project, type RelatedResearchNote, type ResearchNoteView, type ScanRun, type Settings, type TechnicalExperiment } from "./api";
import { DiscoveryWorkbench } from "./DiscoveryWorkbench";
import { ResearchMaterials, researchIssues } from "./ResearchMaterials";
import { ComponentFinder } from "./ComponentFinder";
import { DemandResearch } from "./DemandResearch";
import { experimentAnchor } from "./demand-experiments";
import { ResearchNotebook, ResearchNoteForm, researchDecisionLabel, researchNoteUrl } from "./ResearchNotebook";
import { IssueCollector } from "./IssueCollector";
import { IssueContextPanel } from "./IssueContextPanel";
import { issueBodyDescription } from "@radar/contracts/issues";
import { MonitoringOverview, ProjectMonitoring } from "./Monitoring";
import { CollectionNotice } from "./CollectionNotice";
import { ResearchLeads } from "./ResearchLeads";
import { ValidationProgress } from "./ValidationProgress";
import { ExternalValidation } from "./ExternalValidation";
import { explainAnalysisOutcome } from "@radar/contracts/analysis-outcome";

const navItems = [
  { to: "/research", label: "需求研究", icon: FileSearch2 },
  { to: "/", label: "项目雷达", icon: Radar, end: true },
  { to: "/projects", label: "项目档案", icon: FolderGit2 },
  { to: "/opportunities", label: "机会假设", icon: Lightbulb },
  { to: "/experiments", label: "技术实测", icon: FlaskConical },
  { to: "/activity", label: "运行轨迹", icon: Activity },
  { to: "/settings", label: "采集设置", icon: Settings2 },
];

const pageTitles: Record<string, string> = {
  "/research": "需求研究",
  "/": "项目雷达",
  "/projects": "项目档案",
  "/opportunities": "机会假设",
  "/experiments": "技术实测",
  "/activity": "运行轨迹",
  "/settings": "采集设置",
};

function dateLabel(value?: string | null) {
  if (!value) return "尚无记录";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function numberLabel(value: number) {
  return new Intl.NumberFormat("en", { notation: value > 9999 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function ResearchQuestionText({ value }: { value: string }) {
  const hasEncodingGap = /\?{2,}|�/.test(value);
  if (!hasEncodingGap) return <>{value}</>;
  return <><span>原研究问题包含不可恢复字符，未作为可读证据显示；请以指定 Issue、技术实测和来源引用为准。</span><details className="corrupt-field"><summary>展开原始字段</summary><code>{value}</code></details></>;
}

function App() {
  const queryClient = useQueryClient();
  const location = useLocation().pathname;
  const activeTitle = location.startsWith("/projects/") ? "项目档案" : location.startsWith("/opportunities/") ? "机会假设" : pageTitles[location] ?? "机会捕手";
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, refetchInterval: 10_000 });
  const [scanMessage, setScanMessage] = useState("");
  useEffect(() => {
    if (dashboard.data?.lastScan?.finishedAt || dashboard.data?.analysis.lastRun?.finishedAt) {
      for (const queryKey of [["projects"], ["opportunities"], ["analysis-runs"], ["project"], ["opportunity"], ["scans"], ["research-notes"]]) void queryClient.invalidateQueries({ queryKey });
    }
  }, [dashboard.data?.lastScan?.finishedAt, dashboard.data?.analysis.lastRun?.finishedAt, queryClient]);
  const scan = useMutation({
    mutationFn: api.startScan,
    onSuccess: (run) => {
      setScanMessage(`扫描已启动 · ${run.id.slice(0, 8)}`);
      void queryClient.invalidateQueries();
    },
    onError: (error) => setScanMessage(error.message),
  });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/" aria-label="机会捕手首页">
          <span className="brand-mark"><Compass size={19} strokeWidth={2.2} /></span>
          <span><strong>机会捕手</strong><small>OPEN SOURCE RADAR</small></span>
        </Link>
        <div className="workspace-label">工作区</div>
        <nav className="main-nav">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} {...(end ? { end: true } : {})} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
              <Icon size={17} strokeWidth={1.9} /><span>{label}</span>
              {label === "机会假设" && dashboard.data?.opportunityCount ? <span className="nav-count">{dashboard.data.opportunityCount}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="runtime-box">
            <span className={`status-dot ${dashboard.data?.engineState === "connected" ? "live" : "local"}`} />
            <span><b>{dashboard.data?.runtime === "iii" ? dashboard.data.engineState === "connected" ? "iii Engine 已连接" : "iii Engine 未连接" : "本地执行器"}</b><small>{dashboard.data?.analysis.state === "needs_cli" ? "本机 CLI 待配置" : dashboard.data?.analysis.mode === "local" ? "免费模型优先 · Codex 后备" : dashboard.data?.analysis.mode === "codex" ? "本机 Codex" : dashboard.data?.analysis.mode === "opencode" ? "OpenCode 免费模型优先" : dashboard.data?.analysis.state === "configured" ? "DeepSeek 已配置" : dashboard.data?.analysis.state === "needs_api_key" ? "DeepSeek 待配置密钥" : "规则分析"}</small></span>
            <CircleHelp size={15} className="muted-icon" />
          </div>
          <div className="sidebar-foot"><span className="version-mark">MVP</span><span>0.1.0</span><span className="sidebar-foot-spacer" /><Github size={14} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="crumb"><span>工作台</span><ChevronRight size={14} /><strong>{activeTitle}</strong></div>
          <div className="top-actions">
            <span className="scan-time"><Clock3 size={14} />{dateLabel(dashboard.data?.lastScan?.finishedAt ?? dashboard.data?.lastScan?.startedAt)}</span>
            {location === "/" ? <Link className="button-primary" to="/research"><FileSearch2 size={16} /><span>开始需求研究</span></Link> : location === "/research" ? <Link className="button-primary" to="/research"><FileSearch2 size={16} /><span>新需求</span></Link> : <button className="button-primary" onClick={() => scan.mutate()} disabled={scan.isPending || dashboard.data?.analysis.running || dashboard.data?.evidence?.running || dashboard.data?.lastScan?.status === "running"} title="开始扫描 GitHub">
              {scan.isPending ? <LoaderCircle className="spin" size={16} /> : <Play size={15} fill="currentColor" />}
              <span>开始扫描</span>
            </button>}
          </div>
        </header>
        {scanMessage && <div className="toast" role="status"><span>{scanMessage}</span><button onClick={() => setScanMessage("")} aria-label="关闭"><X size={14} /></button></div>}
        {dashboard.data?.lastScan?.status === "running" && <div className="scan-banner"><LoaderCircle className="spin" size={15} /> 正在采集 GitHub 查询结果，完成后自动刷新项目雷达</div>}
        {dashboard.data?.lastScan?.status !== "running" && dashboard.data?.analysis.running && <div className="scan-banner" role="status"><LoaderCircle className="spin" size={15} /> 正在分析已有项目，采集资料可直接查看；机会假设将在审查完成后刷新。<Link to="/activity">查看分析进度</Link></div>}
        <div className="page-content">
          <Routes>
            <Route path="/research" element={<DemandResearch />} />
            <Route path="/" element={<RadarPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="/opportunities" element={<OpportunitiesPage />} />
            <Route path="/opportunities/:id" element={<OpportunityPage />} />
            <Route path="/experiments" element={<ExperimentsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function PageHeading({ eyebrow, title, detail, aside }: { eyebrow: string; title: string; detail: string; aside?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{detail}</p></div>{aside}</div>;
}

function ExperimentsPage() {
  const query = useQuery({ queryKey: ["technical-experiments"], queryFn: api.experiments });
  const runs = useQuery({ queryKey: ["technical-experiment-runs"], queryFn: api.experimentRuns, refetchInterval: 3000 });
  const startRun = useMutation({ mutationFn: api.startExperimentRun, onSuccess: () => { void runs.refetch(); } });
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash || !query.data) return;
    try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView(); } catch { /* Ignore malformed external fragments. */ }
  }, [hash, query.data]);
  return <>
    <PageHeading eyebrow="TECHNICAL EXPERIMENTS" title="技术实测" detail="查看已归档的实验、真实产物和异常，或重新运行已接入的实验。先验证单项目，再按明确缺口验证组合；技术结果不代表用户收益。" />
    {query.isLoading && <p>正在读取实测记录…</p>}
    {query.isError && <p className="form-error">{query.error.message}</p>}
    {runs.isError && <p className="form-error">无法读取实验运行状态：{runs.error.message}</p>}
    {query.data?.warnings.map((warning) => <p className="form-error" key={warning}>{warning}</p>)}
    {query.data && query.data.records.length === 0 && <div className="empty-state compact"><h3>尚无归档的技术实验</h3><p>这里展示真实执行记录，不会用示例填充，也不会自动运行项目代码。</p></div>}
    {query.data?.records.map((record) => {
      const artifactUrl = (name: string) => `/api/v1/experiments/${encodeURIComponent(record.id)}/artifacts/${encodeURIComponent(name)}`;
      const latestRun = runs.data?.find(run => run.experimentId === record.id);
      const running = latestRun?.status === "queued" || latestRun?.status === "running";
      const runnable = ["agent-world-adaptation-2026-10-23", "agent-world-continuous-crash-2026-10-27-v4"].includes(record.id);
      return <article className="experiment-record" id={experimentAnchor(record.id)} key={record.id}>
        <div className="eyebrow">技术证据 · {dateLabel(record.executedAt)}</div>
        <h2>{record.title}</h2><p><b>验证问题：</b>{record.question}</p><p className="experiment-conclusion">{record.conclusion}</p>
        <div className="capability-list">{record.sources.map((source) => <a key={source.repository} href={`https://github.com/${source.repository}/tree/${source.commit}`} target="_blank" rel="noreferrer">{source.repository}</a>)}</div>
        {record.sources.filter(source => source.modification).map(source => <p className="context-note" key={source.repository}><b>本地改造版 · 上游提交仅为基线：</b>{source.modification!.description} <a href={artifactUrl(source.modification!.artifact)} download>下载改造代码与补丁</a><small className="artifact-hash">SHA-256 {source.modification!.sha256}</small></p>)}
        <p className="context-note">输入：{record.inputOrigin}</p>
        <div className="experiment-previews">{record.artifacts.filter((artifact) => artifact.name.endsWith("-powerpoint.png")).map((artifact) => <figure key={artifact.name}><a href={artifactUrl(artifact.name)} target="_blank" rel="noreferrer"><img src={artifactUrl(artifact.name)} alt={artifact.label} loading="lazy" /></a><figcaption>{artifact.label}</figcaption></figure>)}</div>
        <h3>观察与反证</h3><ul className="experiment-checks">{record.checks.map((check) => <li key={check.label}><b>{check.outcome === "supported" ? "支持" : check.outcome === "refuted" ? "反驳" : "未确定"} · {check.label}</b><p>{check.observation}</p></li>)}</ul>
        <h3>验证边界</h3><ul>{record.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        <p><b>下一步：</b>{record.nextAction}</p>
        <div className="experiment-run-panel">
          <div><b>重新验证</b><p className="context-note">运行已接入的受控实验，保存日志和产物；结果仅适用于记录中的版本与环境。</p></div>
          {runnable ? <button className="button-secondary" onClick={() => startRun.mutate(record.id)} disabled={running || startRun.isPending || !runs.isSuccess}>{running ? <><LoaderCircle size={14} className="spin" /> 运行中</> : <><Play size={14} /> 重新运行实验</>}</button> : <span className="context-note">尚未接入在线运行</span>}
          {startRun.isError && startRun.variables === record.id && <p className="form-error">启动失败：{startRun.error.message}</p>}
          {latestRun && <details open={running}><summary>最近一次运行：{latestRun.status === "succeeded" ? "成功" : latestRun.status === "failed" ? "失败" : latestRun.status === "queued" ? "排队中" : "运行中"} · {dateLabel(latestRun.startedAt)}</summary><p>{latestRun.error ?? (latestRun.status === "succeeded" ? "实验已结束，请结合日志、产物和验证边界判断结果。" : "等待本次实验结束。")}</p><pre className="experiment-run-log">{latestRun.outputTail || "暂无日志"}</pre></details>}
        </div>
        <details><summary>版本、环境与产物下载</summary><p>{record.environment}</p>{record.sources.map((source) => <p className="experiment-source" key={source.repository}><a href={`https://github.com/${source.repository}/tree/${source.commit}`} target="_blank" rel="noreferrer">{source.repository} · {source.commit}</a></p>)}<ul>{record.artifacts.map((artifact) => <li key={artifact.name}><a href={artifactUrl(artifact.name)} download>{artifact.label}</a><small className="artifact-hash">SHA-256 {artifact.sha256}</small></li>)}</ul></details>
      </article>;
    })}
  </>;
}

function MetricStrip() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const metrics = query.data;
  return <div className="metric-strip">
    <div className="metric"><span>已追踪项目</span><strong>{numberLabel(metrics?.projectCount ?? 0)}</strong><small><FolderGit2 size={13} /> 真实公开仓库</small></div>
    <div className="metric"><span>机会假设</span><strong>{numberLabel(metrics?.opportunityCount ?? 0)}</strong><small><Lightbulb size={13} /> 尚待市场验证</small></div>
    <div className="metric"><span>本周新发现</span><strong>{numberLabel(metrics?.freshCount ?? 0)}</strong><small><ArrowUpRight size={13} /> 按当前查询范围</small></div>
    <div className="metric metric-last"><span>公开问题样本</span><strong>{numberLabel(metrics?.issueSampleCount ?? 0)}</strong><small><span className="status-dot live" />Issue 原文 · 不代表付费需求</small></div>
  </div>;
}

function RadarPage() {
  const opportunities = useQuery({ queryKey: ["opportunities"], queryFn: api.opportunities });
  const researchNotes = useQuery({ queryKey: ["research-notes"], queryFn: api.researchNotes });
  return <>
    <PageHeading eyebrow="DISCOVERY / GITHUB" title="项目雷达" detail="发现新能力，检查公开问题，把值得验证的组合留下来。" aside={<a className="button-secondary" href="/api/v1/reports/latest.md" download>导出研究简报 <ArrowUpRight size={14} /></a>} />
    <ResearchFirstStart />
    <nav className="radar-shortcuts" aria-label="工作台区域"><a href="#discovery">发现能力</a><a href="#monitoring">持续关注</a><a href="#research-notes">研究判断</a></nav>
    <CollectionNotice />
    <DiscoveryWorkbench />
    <MetricStrip />
    <MonitoringOverview />
    <ResearchNotebook compact />
    <ResearchBrief />
    <section className="content-section">
        <div className="section-head"><div><h2>机会假设</h2><span>来自项目能力组合</span></div><Lightbulb size={17} className="accent-icon" /></div>
        {opportunities.data?.length ? opportunities.data.slice(0, 3).map((opportunity) => <OpportunityRow key={opportunity.id} opportunity={opportunity} researchNote={exactResearchNoteForOpportunity(opportunity, researchNotes.data ?? [])} />) : <EmptyInline text="暂无证据充分的组合候选" />}
        <Link className="rail-footer" to="/opportunities">查看机会工作台 <ArrowUpRight size={14} /></Link>
    </section>
    <div className="radar-footnote"><ShieldAlert size={14} /><span>GitHub 活跃度仅作为技术与维护信号，不代表市场需求或付费意愿。</span></div>
  </>;
}

function ResearchFirstStart() {
  const demands = useQuery({ queryKey: ["demands", "research-first"], queryFn: api.demands, staleTime: 30_000 });
  // Reuse the notebook's read-only notes query as a compatibility fallback
  // for an older running backend that does not yet expose researchNoteCount.
  const notes = useQuery({ queryKey: ["research-notes"], queryFn: api.researchNotes, staleTime: 30_000 });
  const noteCounts = new Map<string, number>();
  for (const note of notes.data ?? []) if (note.originDemandId && !note.supersededBy) noteCounts.set(note.originDemandId, (noteCounts.get(note.originDemandId) ?? 0) + 1);
  const summaryHasEvidenceField = demands.data?.some((run) => typeof run.researchNoteCount === "number") ?? false;
  const historyReady = notes.isSuccess || summaryHasEvidenceField;
  const latestCompleted = historyReady && demands.data?.filter((run) => ["succeeded", "partial"].includes(run.status)).sort((a, b) => {
    // A durable decision is closer to the product's promised output than a
    // newer partial scan with candidates but no reviewable next action.
    const evidenceRank = (run: DemandSummary) => ((run.researchNoteCount ?? noteCounts.get(run.id) ?? 0) > 0 ? 2 : run.status === "succeeded" ? 1 : 0);
    return evidenceRank(b) - evidenceRank(a) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  })[0];
  return <section className="research-first-start" aria-label="从需求开始">
    <div className="research-first-copy">
      <span className="eyebrow">从需求开始</span>
      <h2>先说清楚要实现什么，再找能跑起来的开源项目</h2>
      <p>不需要先知道仓库名。输入自然语言需求后，系统会记录检索范围、保存 GitHub 证据、比较直接采用与改造路径，并给出下一项最小验证。</p>
      <div className="research-first-actions">
        <Link className="button-primary" to="/research"><FileSearch2 size={16} />开始需求研究 <ArrowUpRight size={14} /></Link>
        {latestCompleted ? <Link className="text-link" to={`/research?run=${encodeURIComponent(latestCompleted.id)}`}>查看已完成研究 <ChevronRight size={14} /></Link> : <Link className="text-link" to="/projects">先看已保存的项目档案 <ChevronRight size={14} /></Link>}
      </div>
    </div>
    <ol className="research-first-steps" aria-label="需求研究步骤">
      <li><b>01</b><span>描述目标与约束</span></li>
      <li><b>02</b><span>核查真实仓库与版本</span></li>
      <li><b>03</b><span>运行最小实验再决策</span></li>
    </ol>
  </section>;
}

function ResearchBrief() {
  const runs = useQuery({ queryKey: ["analysis-runs"], queryFn: api.analysisRuns, refetchInterval: 5000 });
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const run = runs.data?.[0];
  const outcome = run ? explainAnalysisOutcome(run) : null;
  const tracks = dashboard.data?.lastScan?.tracks ?? [];
  return <section className="research-brief" aria-label="本轮研究简报">
    <div><span className="eyebrow">RESEARCH BRIEF</span><h2>{outcome?.label ?? "先从真实采集开始研究"}</h2><p>{outcome ? `${outcome.detail} ${run?.selection ? `浏览 ${run.selection.catalogProjects} 个项目目录，深读 ${run.analyzedProjects?.length ?? 0} 个项目。` : ""} 每个方向仍需核查技术对接与用户需求。` : run?.error ?? "扫描后会自动寻找互补能力；没有合格证据时允许结果为空。"}</p></div>
    <div className="brief-tracks">{tracks.length ? tracks.map((track) => <span key={track.id} className={track.error ? "track-failed" : ""}>{track.label}<b>{track.found ?? "—"}</b></span>) : <Link to="/settings" className="text-link">查看发现范围 <ChevronRight size={14} /></Link>}<Link to="/activity" className="text-link">查看审查依据 <ChevronRight size={14} /></Link></div>
  </section>;
}

function ProjectsPage() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const [filter, setFilter] = useState("");
  const [channel, setChannel] = useState("all");
  const [sort, setSort] = useState("discovered");
  const [withIssues, setWithIssues] = useState(false);
  const cachedSearch = useQuery({ queryKey: ["project-search", filter.trim()], queryFn: () => api.searchProjects(filter.trim()), enabled: filter.trim().length > 0, staleTime: 30_000 });
  const channels = [...new Set(projects.data?.flatMap((project) => project.discoveryChannels ?? []) ?? [])];
  const source = filter.trim() && cachedSearch.data ? cachedSearch.data.items : projects.data ?? [];
  const visible = source.filter((project) => `${project.fullName} ${project.description ?? ""} ${project.language ?? ""} ${project.capabilities.join(" ")} ${project.discovery.clues.map((clue) => clue.label).join(" ")}`.toLowerCase().includes(filter.toLowerCase()) && (channel === "all" || project.discoveryChannels?.includes(channel)) && (!withIssues || project.issues?.length > 0)).sort((a, b) => sort === "score" ? b.score - a.score : sort === "issues" ? (b.issues?.length ?? 0) - (a.issues?.length ?? 0) : Date.parse(b.firstSeenAt ?? b.observedAt) - Date.parse(a.firstSeenAt ?? a.observedAt)) ?? [];
  return <>
    <PageHeading eyebrow="REPOSITORY INDEX" title="项目档案" detail="仓库证据、维护线索与可复用能力。" aside={<label className="inline-search"><Search size={15} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="筛选项目" /></label>} />
    {filter.trim() && <p className="context-note">本地缓存检索 · 不访问 GitHub 实时数据{cachedSearch.data?.observedAt ? ` · 资料最晚观察于 ${dateLabel(cachedSearch.data.observedAt)}` : ""}{cachedSearch.isFetching ? " · 检索中" : cachedSearch.isError ? ` · ${cachedSearch.error.message}，显示已加载档案` : ""}</p>}
    <div className="filter-bar"><label>发现渠道 <select aria-label="发现渠道" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">全部渠道</option>{channels.map((value) => <option key={value}>{value}</option>)}</select></label><label>排序 <select aria-label="项目排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="discovered">最近发现</option><option value="score">技术线索分</option><option value="issues">问题样本数</option></select></label><label><input type="checkbox" checked={withIssues} onChange={(event) => setWithIssues(event.target.checked)} />有公开 Issue 样本</label><small>{visible.length} 个项目</small></div>
    <ProjectTable projects={visible} loading={projects.isLoading || (Boolean(filter.trim()) && cachedSearch.isPending)} />
  </>;
}

function ProjectTable({ projects, loading }: { projects: Project[]; loading: boolean }) {
  if (loading) return <div className="loading-row"><LoaderCircle size={16} className="spin" /> 正在读取本地项目档案</div>;
  if (projects.length === 0) return <EmptyState />;
  return <div className="table-wrap"><table className="project-table"><thead><tr><th>项目</th><th>语言</th><th>Star</th><th>许可证</th><th>Issue 样本</th><th>技术线索</th><th aria-label="操作" /></tr></thead><tbody>
    {projects.map((project) => <tr key={project.id}>
      <td><Link className="repo-name" to={`/projects/${project.id}`}><b>{project.fullName}</b><small>{project.description || "暂无项目描述"}</small><small>最近观察 {dateLabel(project.observedAt)}</small></Link></td>
      <td><span className="language-label"><i className={`language-dot ${languageClass(project.language)}`} />{project.language || "未知"}</span></td>
      <td className="numeric">{numberLabel(project.stars)}</td>
      <td><span className={`license ${project.license ? "known" : "unknown"}`}>{project.license || "未知"}</span></td>
      <td className="muted-cell">{project.issuesFetchedAt ? `${project.issues?.length ?? 0} 条` : "未采集"}</td>
      <td><span className="score-pill">{project.score}<small>/100</small></span></td>
      <td><Link className="icon-link" to={`/projects/${project.id}`} aria-label={`查看 ${project.fullName}`}><ChevronRight size={16} /></Link></td>
    </tr>)}
  </tbody></table></div>;
}

function EmptyState() {
  return <div className="empty-state">
    <div className="empty-icon"><FileSearch2 size={21} /></div>
    <h3>还没有采集到项目</h3>
    <p>先设置 GitHub 搜索条件，再运行一次扫描。工作区只显示真实采集结果。</p>
    <Link className="button-secondary" to="/settings"><Settings2 size={15} />配置采集条件</Link>
  </div>;
}

function EmptyInline({ text }: { text: string }) {
  return <div className="empty-inline"><Sparkles size={15} /><span>{text}</span></div>;
}

function exactResearchNoteForOpportunity(opportunity: Opportunity, notes: ResearchNoteView[]) {
  return notes.filter((note) => !note.supersededBy && note.projectIds.length === opportunity.projectIds.length && note.projectIds.every((projectId) => opportunity.projectIds.includes(projectId))).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}

function OpportunityRow({ opportunity, researchNote }: { opportunity: Opportunity; researchNote?: ResearchNoteView | null }) {
  const evidenceChanged = researchNote?.evidenceStates.some((state) => state !== "same");
  const progress = (opportunity.validationProgress ?? []).filter((entry) => opportunity.validationSteps[entry.index] === entry.step);
  return <Link className="opportunity-row" to={`/opportunities/${opportunity.id}`}>
    <span className="opp-score">{opportunity.score}</span>
    <span className="opp-copy"><b>{opportunity.title}</b><small>{opportunity.projectNames.join(" + ") || "项目组合"}</small><i>{opportunity.status === "candidate" && opportunity.supersededAt ? "历史候选 · 需重新核查" : "机会假设 · 未做市场验证"}</i>{researchNote && <i className={`research-signal note-${researchNote.decision}`}>{researchDecisionLabel[researchNote.decision]} · {evidenceChanged ? "先复核原文" : "已有研究判断"}</i>}</span>
    {progress.length > 0 && <small className="validation-progress-summary">已完成 {progress.filter((entry) => entry.status === "completed").length}/{opportunity.validationSteps.length} 步 · 跳过 {progress.filter((entry) => entry.status === "skipped").length} 步</small>}
    <ChevronRight size={15} />
  </Link>;
}

function ProjectPage() {
  const { id = "" } = useParams();
  const { hash } = useLocation();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.project(id) });
  const observations = useQuery({ queryKey: ["observations", id], queryFn: () => api.observations(id) });
  useEffect(() => {
    if (!project.data || !/^#issue-\d+$/.test(hash)) return;
    const target = document.getElementById(hash.slice(1));
    if (target instanceof HTMLDetailsElement) { target.open = true; target.scrollIntoView({ block: "start" }); }
  }, [hash, project.data?.id]);
  if (project.isLoading) return <div className="loading-row"><LoaderCircle size={16} className="spin" /> 正在读取项目档案</div>;
  if (!project.data) return <EmptyInline text="项目档案不存在" />;
  const item = project.data;
  return <>
    <div className="back-row"><Link to="/projects"><ArrowDownRight size={14} />返回项目档案</Link></div>
    <PageHeading eyebrow="REPOSITORY PROFILE" title={item.fullName} detail={item.description || "暂无项目描述"} aside={<a className="button-secondary" href={item.url} target="_blank" rel="noreferrer">GitHub 仓库 <ExternalLink size={14} /></a>} />
    <ProjectMonitoring key={item.id} id={item.id} />
    <div className="profile-metrics"><Metric label="Star" value={numberLabel(item.stars)} /><Metric label="Fork" value={numberLabel(item.forks)} /><Metric label="开放 Issue" value={numberLabel(item.openIssues)} /><Metric label="许可证" value={item.license || "未知"} /><Metric label="技术线索分" value={`${item.score} / 100`} /></div>
    <Link className="text-link" to={`/opportunities?project=${encodeURIComponent(item.id)}`}>研究它与其他项目的组合 <ArrowUpRight size={14} /></Link>
    <div className="filter-bar">{item.discoveryChannels?.map((channel) => <span className="source-tag" key={channel}>{channel}</span>)}<small>首次发现 {dateLabel(item.firstSeenAt)} · 已观察 {observations.data?.length ?? 0} 次 · 最近更新 {dateLabel(item.pushedAt)}</small></div>
    <div className="detail-grid">
      <section className="plain-section"><div className="section-head"><div><h2>能力线索</h2><span>原文关键词线索 · 接口与可用性仍需核实</span></div><Gauge size={17} className="accent-icon" /></div>
        {item.discovery.kind === "resource_hint" && <p className="context-note">描述中有资料或教程迹象：{item.discovery.resourceQuote}。先确认是否提供可独立复用的软件组件。</p>}
        {item.discovery.kind === "unclassified" && item.discovery.clues.length > 0 && <p className="context-note">以下仅为 README 提及，可能属于赞助、依赖或贡献说明，尚未确认为项目自身能力。</p>}
        {item.discovery.clues.length ? <div className="profile-clues">{item.discovery.clues.map((clue) => <details key={clue.id}><summary>{clue.label}</summary><blockquote>{clue.quote}</blockquote><p className="context-note">{clue.source === "description" ? "项目描述" : "README 提及，需核对是否项目自身能力"} · 档案观察 {dateLabel(clue.observedAt)}{clue.source === "readme" ? "；获取失败时可能保留先前摘录" : ""}</p><a className="text-link" href={clue.url} target="_blank" rel="noreferrer">核对原文 <ExternalLink size={12} /></a><p>{clue.nextCheck}</p></details>)}</div> : <EmptyInline text="尚未识别能力，可从 README 的安装与用法开始核对" />}
        <div className="section-head nested-head"><div><h2>排序理由</h2><span>规则线索，不是商业评分</span></div><Gauge size={15} /></div>
        {item.scoreReasons.length ? <ul className="reason-list">{item.scoreReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <EmptyInline text="当前没有额外排序理由" />}
        <div className="section-head nested-head"><div><h2>README 摘录</h2><span>采集于 {dateLabel(item.observedAt)}</span></div><ExternalLink size={15} /></div>
        {item.readmeExcerpt ? <pre className="readme-excerpt">{item.readmeExcerpt}</pre> : <EmptyInline text="仓库未提供可读取的 README" />}
        <DocumentationPanel project={item} />
      </section>
      <section className="plain-section"><div className="section-head"><div><h2>证据与限制</h2><span>事实来自 GitHub 公开仓库</span></div><ShieldAlert size={17} className="warning-icon" /></div>
        <div className="evidence-item"><span className="evidence-type">技术事实</span><p>{item.description || `${item.fullName} 是一个公开 GitHub 项目。`}</p><a href={item.url} target="_blank" rel="noreferrer">仓库元数据 <ExternalLink size={12} /></a></div>
        <div className="evidence-item caution"><span className="evidence-type">市场验证</span><p>没有来自用户访谈、试用或付费承诺的证据。Star 与 Fork 不构成需求证明。</p></div>
        <div className="evidence-item caution"><span className="evidence-type">许可证</span><p>{item.license ? `检测到 ${item.license} 标识；商业使用前仍需人工检查许可证原文。` : "未检测到许可证信息，商业使用权限未知。"}</p></div>
        <div className="section-head nested-head"><div><h2>公开问题样本</h2><span>{item.issuesFetchedAt ? `自动样本采集于 ${dateLabel(item.issuesFetchedAt)} · 最多 5 条开放 Issue；按需补充讨论单独标记` : "尚无自动样本，可按编号补充讨论"}</span></div><FileSearch2 size={16} /></div>
        <p className="context-note">Issue 可能是缺陷、功能请求或操作疑问；维护者路线图不等于多位客户反馈，作者关系不证明付费意愿。</p>
        <IssueCollector key={item.id} project={item} />
        {item.issues?.length ? item.issues.map((issue) => <details className="issue-card" id={`issue-${issue.number}`} key={issue.id}><summary><span>#{issue.number}</span> {issue.title}{item.issueContexts?.[String(issue.number)]?.selectedForResearch && <small>按需收录 · 核查时{item.issueContexts?.[String(issue.number)]?.issue.state === "open" ? "开放" : "关闭"}</small>}</summary><p>{issue.bodyExcerpt || "该 Issue 没有正文。"}</p><p className="context-note issue-body-notice">{issueBodyDescription(issue)}</p><small>{issue.authorLogin ? `@${issue.authorLogin} · ` : ""}{issue.authorAssociation ?? "作者关系未知"} · {issue.comments} 条评论 · {issue.reactions} 次反应 · 更新 {dateLabel(issue.updatedAt)}</small><div className="research-origin-actions"><a href={issue.url} target="_blank" rel="noreferrer">检查原始讨论 <ExternalLink size={12} /></a><Link to={`/opportunities?project=${encodeURIComponent(item.id)}&issue=${issue.number}`}>围绕此问题研究组合 <ArrowUpRight size={12} /></Link></div><IssueContextPanel project={item} number={issue.number} /></details>) : <EmptyInline text={item.issuesFetchedAt ? "此次样本中没有开放 Issue；不表示没有用户问题" : "下次扫描或按编号补充问题证据"} />}
      </section>
    </div>
  </>;
}

function DocumentationPanel({ project }: { project: Project }) {
  const [paths, setPaths] = useState("");
  const [ref, setRef] = useState("");
  const queryClient = useQueryClient();
  const integration = useQuery({ queryKey: ["integrations"], queryFn: api.integrations, refetchInterval: 3000 });
  const collect = useMutation({ mutationFn: () => api.collectDocumentation(project.id, paths.trim() ? paths.split(/\r?\n/).map((path) => path.trim()).filter(Boolean) : undefined, ref.trim() || undefined), onSuccess: () => { void queryClient.invalidateQueries(); } });
  const report = project.documentation;
  return <section className="documentation-panel" aria-label="补充技术文档">
    <div className="section-head nested-head"><div><h2>补充技术文档</h2><span>接口、用法与输入输出的原文证据</span></div><FileSearch2 size={16} /></div>
    <p className="context-note">自动寻找 README 中同仓库的接口/用法链接，也可指定最多两个文档路径。仅补证据；重新分析需单独触发。</p>
    <label className="documentation-paths">版本（选填，tag、分支或 commit）<input aria-label="文档版本" value={ref} onChange={(event) => setRef(event.target.value)} maxLength={160} placeholder="例如 v1.1.0；留空读取默认分支" /></label>
    <p className="context-note">指定版本会固定到提交，读取失败时保留旧材料及原版本；留空时链接指向可变 HEAD。文档自述仍需运行验证。</p>
    <label className="documentation-paths">指定文档路径（选填，每行一个）<textarea aria-label="指定文档路径" value={paths} onChange={(event) => setPaths(event.target.value)} rows={2} maxLength={482} placeholder={"packages/cli/README.md\ndocs/api.md"} /></label>
    <button className="button-secondary" disabled={collect.isPending || integration.data?.analysis.running || integration.data?.evidence?.running || (integration.data?.runtime === "iii" && integration.data.engineState !== "connected")} onClick={() => collect.mutate()}>{collect.isPending || integration.data?.evidence?.projectId === project.id ? "正在补充文档" : "补充接口文档"}</button>
    {collect.isError && <p className="form-error">{collect.error.message}</p>}
    {collect.isSuccess && <p className="context-note">本次读取成功 {collect.data.documents.filter((document) => !document.stale && collect.data.attemptedPaths.includes(document.path)).length} 份文档；采集结果已保存。未触发模型分析。</p>}
    {report && <p className="context-note">最近补证 {dateLabel(report.observedAt)} · 本次尝试 {report.attemptedPaths.length} 个路径 · 留存 {report.documents.length} 份文档</p>}
    {report?.commitSha && <p className="context-note">本次请求版本 {report.ref} · 解析提交 {report.commitSha}；各份材料的版本见下方。</p>}
    {report?.warnings.map((warning, index) => <p className="form-error" key={index}>{warning}</p>)}
    {report && !report.attemptedPaths.length && <p className="context-note">未找到可读取的同仓库文档链接，可从仓库选择具体文件路径后补充。</p>}
    {report?.documents.map((document) => <details className="documentation-card" key={document.path}><summary>{document.path} · {document.commitSha ? `版本 ${document.ref ?? document.commitSha.slice(0, 12)}` : "默认分支 · 可变 HEAD"}{document.stale ? " · 本次读取失败，保留旧文档；暂不用于分析" : ""}</summary><small>采集 {dateLabel(document.observedAt)} · Blob {document.sha}</small>{document.commitSha && <small>固定提交 {document.commitSha}</small>}<a href={document.url} target="_blank" rel="noreferrer">查看仓库文档 <ExternalLink size={12} /></a><pre className="readme-excerpt">{document.excerpt}</pre></details>)}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="profile-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function ResearchFocusForm({ status }: { status: IntegrationStatus | undefined }) {
  const location = useLocation();
  const noteId = new URLSearchParams(location.search).get("note");
  const editing = useQuery({ queryKey: ["research-note", noteId], queryFn: () => api.researchNote(noteId!), enabled: Boolean(noteId) });
  const [selected, setSelected] = useState(() => {
    const ids = [...new Set(new URLSearchParams(location.search).getAll("project"))].filter(Boolean).slice(0, 3);
    return Array.from({ length: 3 }, (_, index) => ids[index] ?? "");
  });
  const [question, setQuestion] = useState(() => (new URLSearchParams(location.search).get("question") ?? "").slice(0, 1200));
  const [findingComponent, setFindingComponent] = useState(false);
  const [originKey, setOriginKey] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get("project") && /^\d+$/.test(params.get("issue") ?? "") ? `${params.get("project")}:${Number(params.get("issue"))}` : "";
  });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const queryClient = useQueryClient();
  const research = useMutation({ mutationFn: api.research, onSuccess: () => { void queryClient.invalidateQueries(); } });
  const ids = selected.filter(Boolean);
  const chosenProjects = ids.flatMap((id) => projects.data?.find((project) => project.id === id) ?? []);
  const issues = researchIssues(chosenProjects);
  const origin = issues.find((item) => item.key === originKey);
  const originInvalid = Boolean(originKey && projects.isSuccess && !origin);
  const busy = findingComponent || research.isPending || status?.analysis.running || status?.evidence?.running || dashboard.data?.lastScan?.status === "running";
  const modelReady = status?.analysis.state === "configured" && (status.runtime !== "iii" || status.engineState === "connected");
  const latest = status?.analysis.lastRun?.focus ? status.analysis.lastRun : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (projects.isSuccess && !originInvalid && ids.length >= 2 && new Set(ids).size === ids.length && question.trim().length >= 12) research.mutate({ projectIds: ids, question: question.trim(), ...(origin ? { originIssue: { projectId: origin.project.id, issueNumber: origin.issue.number } } : {}) });
  };
  return <section id="focused-research" className="focused-research" aria-label="定向研究">
    <div className="section-head"><div><h2>研究一个具体组合</h2><span>选择 2～3 个互补组件，检验一个待证伪的问题</span></div><Compass size={18} /></div>
    <ComponentFinder selectedIds={ids} blocked={Boolean(research.isPending || status?.analysis.running || status?.evidence?.running || dashboard.data?.lastScan?.status === "running" || (status?.runtime === "iii" && status.engineState !== "connected"))} onBusy={setFindingComponent} onSelect={(id) => setSelected((previous) => { if (previous.includes(id)) return previous; const slot = previous.indexOf(""); return slot < 0 ? previous : previous.map((value, index) => index === slot ? id : value); })} />
    <form onSubmit={submit}>
      <div className="research-focus-projects">{selected.map((value, index) => <label key={index}>组件 {index + 1}{index === 2 ? "（选填）" : ""}<select aria-label={`研究组件 ${index + 1}`} required={index < 2} value={value} onChange={(event) => { if (origin?.project.id === value && event.target.value !== value) setOriginKey(""); setSelected((previous) => previous.map((id, slot) => slot === index ? event.target.value : id)); }}>
        <option value="">选择已采集项目</option>{[...(projects.data ?? [])].sort((a, b) => a.fullName.localeCompare(b.fullName)).map((project) => <option key={project.id} value={project.id} disabled={selected.includes(project.id) && value !== project.id}>{project.fullName}</option>)}
      </select></label>)}</div>
      {chosenProjects.length > 0 && <label className="research-origin-select">问题起点（选填）<select aria-label="研究问题起点" value={originInvalid ? originKey : origin?.key ?? ""} onChange={(event) => setOriginKey(event.target.value)}><option value="">暂不引用 Issue，先研究技术假设</option>{originInvalid && <option disabled value={originKey}>原问题不在有效采集材料中，请重新选择</option>}{issues.map((item) => <option key={item.key} value={item.key}>{item.project.fullName} #{item.issue.number} · {item.issue.title}</option>)}</select></label>}
      {originInvalid && <p className="form-error">原问题不在有效采集材料中。请重新选择问题起点，或显式切换为不引用 Issue 的技术假设。</p>}
      <ResearchMaterials projects={chosenProjects} origin={origin} onDraft={() => { if (origin) setQuestion(`围绕 ${origin.project.fullName} #${origin.issue.number}「${origin.issue.title.slice(0, 240)}」，所选组件能否共同干预原文中的实际障碍？请区分各自分工、是否只需修复单个项目、现有替代与最先证伪的假设；目标用户和付费意愿尚未核实。`); }} />
      <label className="research-question">待证伪的研究问题<textarea aria-label="待证伪的研究问题" required minLength={12} maxLength={1200} rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：地区 CSV → 地图图片 → PPTX，能否减少每周更新地区经营汇报的整理时间？最关键的接口和用户工作假设分别是什么？" /></label>
      <p className="context-note">写明目标用户、工作和关键未知点。研究问题本身不是需求证据；没有相关 Issue 或实测时，结论必须保留这一缺口。</p>
      <div className="research-submit"><button className="button-primary" type="submit" disabled={!projects.isSuccess || busy || !modelReady || originInvalid || ids.length < 2 || new Set(ids).size !== ids.length || question.trim().length < 12}><Sparkles size={14} />{busy ? "请等待当前任务完成" : "研究这个组合"}</button><small>提交后调用已配置模型；相同问题、问题起点和证据复用已完成结果。</small></div>
      {!modelReady && status && <p className="context-note">需要模型已配置且执行器就绪，可在<Link to="/settings">设置页</Link>检查。</p>}
      {research.isError && <p className="form-error">{research.error.message}</p>}
      {research.isSuccess && <p className="context-note">定向研究已提交，结果会自动刷新；也可在运行轨迹查看和导出。</p>}
    </form>
    {editing.isError && <p className="form-error">{editing.error.message}</p>}
    {(!noteId || editing.data) && projects.isSuccess && !originInvalid && <ResearchNoteForm key={editing.data?.id ?? "new"} projects={chosenProjects} question={question} {...(origin ? { originIssue: { projectId: origin.project.id, issueNumber: origin.issue.number } } : {})} {...(editing.data ? { initial: editing.data } : {})} />}
    {latest && <div className="focused-research-result"><h3>最近一次定向研究</h3><AnalysisRunRecord run={latest} /></div>}
  </section>;
}

function OpportunitiesPage() {
  const location = useLocation();
  const opportunities = useQuery({ queryKey: ["opportunities"], queryFn: api.opportunities, refetchInterval: 5000 });
  const [filter, setFilter] = useState("all");
  const history = useQuery({ queryKey: ["opportunity-history"], queryFn: api.opportunityHistory, enabled: filter === "history", refetchInterval: 5000 });
  const queryClient = useQueryClient();
  const integration = useQuery({ queryKey: ["integrations"], queryFn: api.integrations, refetchInterval: 5000 });
  const researchNotes = useQuery({ queryKey: ["research-notes"], queryFn: api.researchNotes });
  const analyze = useMutation({ mutationFn: api.analyze, onSuccess: () => { void queryClient.invalidateQueries(); } });
  const historical = filter === "history";
  const selectedQuery = historical ? history : opportunities;
  const all = selectedQuery.data ?? [];
  const list = all.filter((item) => filter === "all" || historical || item.status === filter);
  const latestRun = integration.data?.analysis.lastRun;
  const latestOutcome = latestRun ? explainAnalysisOutcome(latestRun) : null;
  const filterEmpty = filter !== "all" && !historical && all.length > 0;
  const stageCounts = latestRun?.decisions.reduce<Record<string, number>>((counts, decision) => {
    counts[decision.stage] = (counts[decision.stage] ?? 0) + 1;
    return counts;
  }, {}) ?? {};
  const stageSummary = Object.entries(stageCounts).map(([stage, count]) => `${analysisStageLabel(stage as AnalysisRun["decisions"][number]["stage"])} ${count}`).join(" · ");
  const emptyMessage = historical ? "没有被后续同范围分析移出当前列表的候选。已忽略的假设不在此列。" : filterEmpty
    ? "当前筛选下没有机会假设。"
    : integration.data?.analysis.running
      ? "正在浏览项目能力并审查组合；完成后会自动显示结果，可在运行轨迹查看进度。"
    : latestRun?.status === "failed"
      ? `最近一次分析未完成：${latestRun.error || "请查看运行轨迹中的错误信息。"}`
      : latestRun?.status === "succeeded"
        ? `最近一次分析：${latestOutcome?.label}。${latestOutcome?.detail}${stageSummary ? ` 审查阶段记录：${stageSummary}。` : ""}`
        : ["needs_api_key", "needs_cli"].includes(integration.data?.analysis.state ?? "")
          ? "模型尚未配置，请在设置页检查；已采集数据保留。"
          : "还没有已完成的机会分析；你可以分析现有项目，或先运行一次 GitHub 扫描。";
  const filters: Array<[string, string]> = [["all", "当前"], ["saved", "已收藏"], ["validating", "验证中"], ["history", "历史候选"]];
  return <>
    <PageHeading eyebrow="COMBINATION SIGNALS" title="机会假设" detail="每一项都可回到技术证据，并保留未验证的问题。" aside={<div className="segmented">{filters.map(([value, label]) => <button className={filter === value ? "selected" : ""} key={value} onClick={() => setFilter(value)}>{label}</button>)}</div>} />
    {latestRun && <section className="analysis-summary" role="status" aria-label="最近分析结果"><b>{latestOutcome?.label}</b><p>{dateLabel(latestRun.startedAt)} · {latestRun.focus ? "定向研究" : "目录发现"} · {latestOutcome?.detail}</p>{latestRun.focus && <p>本次问题：<ResearchQuestionText value={latestRun.focus.question} /></p>}{latestRun.error && <p className="form-error">{latestRun.error}</p>}<p>列表包含其他批次或研究范围的假设；本轮结果不证伪旧假设。</p><Link className="text-link" to="/activity">查看分析记录 <ChevronRight size={14} /></Link></section>}
    <ResearchLeads />
    <ResearchNotebook />
    <ResearchFocusForm key={location.search} status={integration.data} />
    <div className="filter-bar"><button className="button-secondary" disabled={analyze.isPending || integration.data?.analysis.running || integration.data?.evidence?.running} onClick={() => analyze.mutate()}><Sparkles size={14} />{integration.data?.analysis.running ? "正在分析" : "分析现有项目"}</button><a className="text-link" href="/api/v1/reports/latest.md" download>导出研究简报 <ArrowUpRight size={14} /></a><small>{analyze.isError ? analyze.error.message : "相同证据复用已成功结果，候选必须通过原文核验与反方审查。"}</small></div>
    {historical && <p className="context-note">这些候选曾被模型保留，后被同范围的新一轮分析移出当前列表；该操作本身不是反证。可进入详情复查来源与研究判断，收藏后继续跟进。</p>}
    <div className="opportunity-list">{selectedQuery.isLoading ? <div className="loading-row"><LoaderCircle size={16} className="spin" /> 正在读取机会</div> : selectedQuery.isError ? <p className="form-error">{selectedQuery.error.message}</p> : list.length ? list.map((item) => <OpportunityRow key={item.id} opportunity={item} researchNote={exactResearchNoteForOpportunity(item, researchNotes.data ?? [])} />) : <div className="empty-state compact"><div className="empty-icon"><Lightbulb size={20} /></div><h3>{historical ? "暂无历史候选" : filterEmpty ? "当前筛选下没有结果" : latestOutcome?.label ?? "暂时没有机会假设"}</h3><p>{emptyMessage}</p>{filterEmpty && <button className="button-secondary" onClick={() => setFilter("all")}>显示全部</button>}{!historical && !filterEmpty && latestRun?.status === "succeeded" && latestRun.decisions.length > 0 && <details className="analysis-record empty-review" open><summary>本轮候选审查 · {latestRun.decisions.length} 条</summary>{latestRun.decisions.map((decision, index) => <AnalysisDecision key={`${decision.stage}-${index}`} decision={decision} analyzedProjects={latestRun.analyzedProjects} />)}</details>}{!historical && !filterEmpty && ["needs_api_key", "needs_cli"].includes(integration.data?.analysis.state ?? "") && <Link className="button-secondary" to="/settings">检查模型配置</Link>}</div>}</div>
  </>;
}

function analysisStageLabel(stage: AnalysisRun["decisions"][number]["stage"]) {
  return { schema: "结构校验", evidence: "原文核验", review: "反方审查", accepted: "通过" }[stage];
}

function AnalysisDecision({ decision, analyzedProjects }: { decision: AnalysisRun["decisions"][number]; analyzedProjects: AnalysisRun["analyzedProjects"] }) {
  const byId = new Map(analyzedProjects.map((project) => [project.id, project]));
  const recordedIds = [...new Set(decision.projectIds ?? [])].filter((id) => byId.has(id));
  const projectIds = recordedIds.length ? recordedIds : [...new Set(decision.projectNames.flatMap((name) => {
    const project = analyzedProjects.find((item) => item.fullName === name);
    return project ? [project.id] : [];
  }))];
  return <div className={`decision ${decision.stage}`}>
    <b>{decision.stage === "accepted" ? "保留" : "剔除"} · {decision.title}</b>
    <small>{analysisStageLabel(decision.stage)}</small>
    {projectIds.length ? <div className="decision-projects">{projectIds.map((id) => <Link key={id} to={`/projects/${id}`}>{byId.get(id)!.fullName}</Link>)}</div> : <small>本轮输出未能关联到已分析的具体仓库。</small>}
    <p>{decision.reason}</p>
  </div>;
}

function OpportunityPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const opportunity = useQuery({ queryKey: ["opportunity", id], queryFn: () => api.opportunity(id) });
  const experiments = useQuery({ queryKey: ["technical-experiments"], queryFn: api.experiments });
  const researchNotes = useQuery({ queryKey: ["opportunity-research-notes", id], queryFn: () => api.opportunityResearchNotes(id) });
  const update = useMutation({ mutationFn: (status: Parameters<typeof api.updateOpportunity>[1]) => api.updateOpportunity(id, status), onSuccess: () => { void queryClient.invalidateQueries(); } });
  if (opportunity.isLoading) return <div className="loading-row"><LoaderCircle size={16} className="spin" /> 正在读取机会假设</div>;
  if (!opportunity.data) return <EmptyInline text="机会假设不存在" />;
  const item = opportunity.data;
  const currentResearch = exactResearchNoteForOpportunity(item, researchNotes.data ?? []);
  const exactExperiments = (experiments.data?.records ?? []).filter((record) => record.projectIds.length === item.projectIds.length && record.projectIds.every((projectId) => item.projectIds.includes(projectId)));
  const hasFollowupEvidence = Boolean(currentResearch || exactExperiments.length);
  return <>
    <div className="back-row"><Link to="/opportunities"><ArrowDownRight size={14} />返回机会假设</Link></div>
    <PageHeading eyebrow="OPPORTUNITY HYPOTHESIS" title={item.title} detail={item.hypothesis} aside={<div className="heading-actions"><button className="button-secondary" onClick={() => update.mutate(item.status === "saved" ? "candidate" : "saved")} disabled={item.marketStatus === "evidence_recorded"}><Bookmark size={14} />{item.status === "saved" ? "已收藏" : "收藏假设"}</button>{item.marketStatus !== "evidence_recorded" && <><button className="button-secondary" onClick={() => update.mutate("dismissed")} title="忽略此假设"><X size={14} />忽略</button><button className="button-primary" onClick={() => update.mutate("validating")}><Check size={14} />开始验证</button></>}{item.marketStatus === "evidence_recorded" && item.status !== "validating" && <button className="button-primary" onClick={() => update.mutate("validating")}><Check size={14} />继续验证</button>}</div>} />
    {item.status === "candidate" && item.supersededAt && <div className="analysis-summary" role="status" aria-label="历史候选说明"><b>历史候选 · 需重新核查</b><p>{dateLabel(item.supersededAt)} 被后续同范围分析移出当前列表；这不表示假设已被证伪。先复查来源、反证与研究判断，再决定是否收藏或开始验证。</p></div>}
    <div className="hypothesis-banner"><span className="hypothesis-score">{item.score}<small>/100</small></span><div><b>技术组合线索分 · {item.combinationKey.startsWith("local-cli-") ? "本机模型提案与反方审查" : item.combinationKey.startsWith("codex-") ? "Codex 提案与反方审查" : item.combinationKey.startsWith("opencode-") ? "OpenCode 提案与反方审查" : item.combinationKey.startsWith("deepseek-") ? "DeepSeek 提案与反方审查" : "规则生成"}</b><p>市场状态：{item.marketStatus === "evidence_recorded" ? `已记录 ${item.validationRecords.length} 项外部验证，结论需结合样本判断` : "尚无外部验证记录"}。线索分不代表市场置信度或付费意愿。</p></div></div>
    <RelatedResearchNotes notes={researchNotes.data ?? []} loading={researchNotes.isPending} error={researchNotes.error} />
    <RelatedExperiments opportunity={item} records={experiments.data?.records ?? []} loading={experiments.isPending} error={experiments.error} />
    {item.firstExperiment && <div className="experiment-callout">{researchNotes.isPending || experiments.isPending ? <><span className="eyebrow">RESEARCH STATUS</span><p>正在核对后续判断与实测记录，暂不展示初始实验建议。</p></> : hasFollowupEvidence ? <><span className="eyebrow">ORIGINAL PROPOSAL</span><details><summary>查看最初提案的实验建议</summary><p>{item.firstExperiment}</p></details><p className="context-note">已有同组合研究判断或实测，请先核对上方记录与重新审视条件。</p></> : <><span className="eyebrow">INITIAL EXPERIMENT</span><h2>最初提案的实验建议</h2><p>{item.firstExperiment}</p><p className="context-note">执行前先核对相关技术实测与步骤记录，避免重复已完成的实验。</p></>}<a className="text-link" href={`/api/v1/opportunities/${item.id}/report.md`} download>导出完整研究记录 <ArrowUpRight size={14} /></a></div>}
    <ResearchProfileSnapshot profile={item.researchProfile} />
    {item.researchFocus && <p className="context-note">定向研究问题（待证伪，不是需求证据）：<ResearchQuestionText value={item.researchFocus.question} /></p>}
    {item.researchFocus?.originIssue && <p className="context-note">指定问题起点：<Link className="text-link" to={`/projects/${item.researchFocus.originIssue.projectId}`}>项目档案 #{item.researchFocus.originIssue.issueNumber}</Link> · 单条公开讨论</p>}
    <div className="detail-grid opportunity-detail-grid">
      <section className="plain-section"><div className="section-head"><div><h2>目标用户与工作</h2><span>假设，需由用户验证</span></div><Lightbulb size={17} className="accent-icon" /></div>
        <div className="claim-block"><label>目标用户</label><p>{item.targetUser}</p></div><div className="claim-block"><label>待完成的工作</label><p>{item.jobToBeDone}</p></div>
        {item.whyNow && <div className="claim-block"><label>为什么现在值得看 · 时机假设</label><p>{item.whyNow}</p></div>}
        {item.integrationPlan && <div className="claim-block"><label>集成路径与待补工程 · 待实测</label><p>{item.integrationPlan}</p></div>}
        {item.alternatives && <div className="claim-block"><label>现有做法与替代方案 · 待调研</label><p>{item.alternatives}</p></div>}
        <ExternalValidation key={item.id} opportunity={item} />
        <div className="section-head nested-head"><div><h2>7 天验证实验</h2><span>在投入开发前寻找反证</span></div><Clock3 size={15} /></div>
        <ValidationProgress opportunity={item} />
        <div className="metric-pair"><div><small>成功指标</small><p>{item.successMetric}</p></div><div><small>失败指标</small><p>{item.failureMetric}</p></div></div>
      </section>
      <section className="plain-section"><div className="section-head"><div><h2>组合项目</h2><span>{item.projectNames.length} 个技术组件</span></div><FolderGit2 size={17} /></div>
        {item.projectIds.map((projectId, index) => <Link key={projectId} className="linked-project" to={`/projects/${projectId}`}><span className="linked-project-index">0{index + 1}</span><b>{item.projectNames[index]}</b><ExternalLink size={14} /></Link>)}
        {item.components?.map((component) => <div className="component-role" key={component.projectId}><b>{item.projectNames[item.projectIds.indexOf(component.projectId)]}</b><p>{component.role}</p><small>输入：{component.input}<br />输出：{component.output}</small></div>)}
        <div className="section-head nested-head"><div><h2>问题线索</h2><span>公开 Issue 引用 · 尚未验证需求或付费</span></div><FileSearch2 size={15} /></div>
        {item.problemEvidence?.length ? item.problemEvidence.map((evidence) => <EvidenceItem key={evidence.url + evidence.quote} evidence={evidence} />) : <EmptyInline text="没有直接问题线索，此方向只有技术能力证据" />}
        <div className="section-head nested-head"><div><h2>支持证据</h2><span>来源可回溯</span></div><Check size={15} /></div>
        {item.supportingEvidence.map((evidence) => <EvidenceItem key={evidence.url + evidence.quote} evidence={evidence} />)}
        <div className="section-head nested-head"><div><h2>反证与缺口</h2><span>未满足项保持可见</span></div><ShieldAlert size={15} className="warning-icon" /></div>
        {item.counterEvidence.map((evidence) => <EvidenceItem key={evidence.url + evidence.quote} evidence={evidence} />)}
      </section>
    </div>
  </>;
}

function RelatedResearchNotes({ notes, loading, error }: { notes: RelatedResearchNote[]; loading: boolean; error: Error | null }) {
  const active = notes.filter((note) => !note.supersededBy);
  const direct = active.filter((note) => note.relation === "exact");
  const shared = active.filter((note) => note.relation === "partial");
  const renderNote = (note: RelatedResearchNote, compact = false) => {
    const changed = note.evidenceStates.some((state) => state !== "same");
    return <article className={`related-research-note note-${note.decision}${compact ? " compact" : ""}`} key={note.id}>
      <div className="research-note-status"><b>{researchDecisionLabel[note.decision]}</b><small>{note.relation === "exact" ? "同一项目组合" : `共享 ${note.sharedProjectIds.length} 个项目`} · {new Date(note.createdAt).toLocaleString("zh-CN")}</small></div>
      <h3>{note.title}</h3>
      {changed && <p className="form-error">引用来源已变化或暂不可用，继续行动前请重新核对原文。</p>}
      <p className="related-research-conclusion">{note.conclusion}</p>
      {!compact && <p><b>下一步：</b>{note.nextAction}</p>}
      <div className="research-note-actions"><Link className="text-link" to={researchNoteUrl(note)}>核对当前材料</Link><a className="text-link" href={`/api/v1/research-notes/${note.id}/report.md`} download>导出判断</a></div>
    </article>;
  };
  return <section className="related-research" aria-label="相关研究判断">
    <div className="section-head"><div><h2>相关研究判断</h2><span>把后续复核带回这条机会，避免继续依据过期假设</span></div><FileSearch2 size={17} /></div>
    <p className="context-note">研究判断来自已保存的原文快照，不是市场验证；“停止”或“等待”只约束研究方向，不会自动改变机会状态。</p>
    {loading && <p className="loading-row">正在读取相关研究判断</p>}
    {error && <p className="form-error">{error.message}</p>}
    {!loading && !error && !active.length && <p className="context-note">当前组合没有已保存的相关研究判断。没有记录不代表问题已被证实或不存在。</p>}
    {direct.map((note) => renderNote(note))}
    {shared.length > 0 && <details className="related-research-shared"><summary>共享项目参考（不针对本组合） · {shared.length}</summary><p className="context-note">这些判断只与机会共享部分项目，不能直接改变本组合的研究结论。</p>{shared.map((note) => renderNote(note, true))}</details>}
    {notes.length > active.length && <details className="related-research-history"><summary>查看已被后续判断替代的历史记录 · {notes.length - active.length}</summary>{notes.filter((note) => note.supersededBy).map((note) => <p key={note.id}><b>{note.title}</b> · {researchDecisionLabel[note.decision]} · 已有后续判断</p>)}</details>}
  </section>;
}

function RelatedExperiments({ opportunity, records, loading, error }: { opportunity: Opportunity; records: TechnicalExperiment[]; loading: boolean; error: Error | null }) {
  const related = records
    .map((record) => ({ record, overlap: record.projectIds.filter((projectId) => opportunity.projectIds.includes(projectId)).length }))
    .filter(({ overlap }) => overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || Date.parse(b.record.executedAt) - Date.parse(a.record.executedAt));
  return <section className="related-experiments" aria-label="相关技术实测">
    <div className="section-head"><div><h2>相关技术实测</h2><span>按共同项目自动关联；技术结果不等于用户需求或付费验证</span></div><FlaskConical size={17} className="accent-icon" /></div>
    {loading ? <div className="loading-row"><LoaderCircle size={16} className="spin" /> 正在读取技术实测</div> : error ? <p className="form-error">技术实测读取失败：{error.message}</p> : related.length ? related.map(({ record, overlap }) => <article className="related-experiment" key={record.id}>
      <div><span className="eyebrow">TECHNICAL EVIDENCE · {dateLabel(record.executedAt)}</span><h3>{record.title}</h3><p>{record.conclusion}</p></div>
      <div className="related-experiment-meta"><span>{overlap}/{opportunity.projectIds.length} 个组合项目有交集</span><span>{record.checks.filter((check) => check.outcome === "supported").length} 项支持 · {record.checks.filter((check) => check.outcome === "refuted").length} 项反驳 · {record.checks.filter((check) => check.outcome === "inconclusive").length} 项未确定</span></div>
      <div className="related-experiment-actions"><Link className="text-link" to="/experiments">查看完整实测记录 <ArrowUpRight size={14} /></Link>{record.artifacts.slice(0, 2).map((artifact) => <a className="text-link" key={artifact.name} href={`/api/v1/experiments/${encodeURIComponent(record.id)}/artifacts/${encodeURIComponent(artifact.name)}`} download>{artifact.label} <ArrowUpRight size={14} /></a>)}</div>
    </article>) : <p className="context-note">还没有与本机会项目交集的技术实测；完成实验后归档，记录会自动出现在这里。</p>}
  </section>;
}

function EvidenceItem({ evidence }: { evidence: Opportunity["supportingEvidence"][number] }) {
  return <div className={`evidence-item ${evidence.relation === "refutes" ? "caution" : ""}`}><p>{evidence.quote}</p>{evidence.sourcePath && <small>{evidence.sourcePath} · Blob {evidence.sourceSha}</small>}{evidence.url && <a href={evidence.url} target="_blank" rel="noreferrer">来源 · {dateLabel(evidence.observedAt)} <ExternalLink size={12} /></a>}</div>;
}

function analysisUsageLabel(usage: AnalysisRun["usage"]) {
  if (!usage) return "未收到 token 用量回执，实际消耗未知";
  return `${usage.complete ? "输入/输出 token" : "已知 token 小计（完整用量未确认）"}：${usage.promptTokens}/${usage.completionTokens}`;
}

function analysisRunUsageLabel(run: AnalysisRun) {
  return run.reusedFrom ? `复用分析 ${run.reusedFrom}；本次未调用模型，不重复计入历史用量` : analysisUsageLabel(run.usage);
}

function ResearchProfileSnapshot({ profile }: { profile: Settings["researchProfile"] | undefined }) {
  if (!profile) return null;
  return <section className="analysis-profile" aria-label="本次研究画像"><h3>本次研究画像 · 筛选背景</h3><p>目标用户：{profile.targetUser || "未指定"}</p><p>反复工作：{profile.recurringWork || "未指定"}</p><p>技术与交付约束：{profile.constraints || "未指定"}</p><p className="context-note">这是运行开始时的画像快照，不证明需求或付费；修改设置不会重写本次记录。</p></section>;
}

function AnalysisRunRecord({ run }: { run: AnalysisRun }) {
  const outcome = explainAnalysisOutcome(run);
  return <details className="analysis-record">
    <summary>{dateLabel(run.startedAt)} · {run.focus ? "定向研究 · " : ""}{outcome.label}<small>{run.model} · 深读 {run.analyzedProjects?.length ?? 0} 个项目</small></summary>
    <p className="context-note">{outcome.detail}</p>
    {run.error && <p className="form-error">{run.error}</p>}
    {run.focus && <p className="research-question-record">研究问题（待证伪，不是需求证据）：<ResearchQuestionText value={run.focus.question} /></p>}
    <ResearchProfileSnapshot profile={run.researchProfile} />
    {run.focus?.originIssue && <p className="context-note">指定问题起点：<Link className="text-link" to={`/projects/${run.focus.originIssue.projectId}`}>项目档案 #{run.focus.originIssue.issueNumber}</Link> · 单条公开讨论</p>}
    <p className="context-note">{analysisRunUsageLabel(run)} · {run.promptVersion ?? "旧版分析"}</p>
    <a className="text-link" href={`/api/v1/analysis/runs/${run.id}/report.md`} download>导出本次研究 <ArrowUpRight size={14} /></a>
    <p className="context-note">提案与反方分次调用模型；角色分离和免费模型切换均不代表独立验证。通过审查仅表示本轮未被否决，仍需核查接口和需求。</p>
    {run.selection && <section className="analysis-selection" aria-label="目录选择依据">
      <h3>浏览 {run.selection.catalogProjects} 个项目目录 · {run.selection.groups.length} 组深读线索</h3>
      <p className="context-note">选择与排除理由是模型判断，不能证明技术兼容或市场需求。</p>
      {run.selection.warnings?.map((warning, index) => <p className="context-note" key={`${warning}-${index}`}>筛选提示：{warning}</p>)}
      {run.selection.groups.map((group, index) => <div className="selection-group" key={index}><b>{group.researchQuestion}</b><p>{group.reason}</p><div className="capability-list">{group.projectIds.map((id, projectIndex) => <Link key={id} to={`/projects/${id}`}>{group.projectNames[projectIndex]}</Link>)}</div></div>)}
      {run.selection.skipped.length > 0 && <details><summary>代表性排除项 · {run.selection.skipped.length}</summary>{run.selection.skipped.map((item) => <p key={item.projectId}><Link to={`/projects/${item.projectId}`}>{item.projectName}</Link>：{item.reason}</p>)}</details>}
    </section>}
    <div className="capability-list">{run.analyzedProjects?.map((project) => <Link key={project.id} to={`/projects/${project.id}`}>{project.fullName}</Link>)}</div>
    {run.decisions?.map((decision, index) => <AnalysisDecision key={`${decision.stage}-${index}`} decision={decision} analyzedProjects={run.analyzedProjects} />)}
    {run.candidateAudits ? <section className="candidate-audits" aria-label="候选与审查快照"><h3>候选与审查快照</h3><p className="context-note">以下是模型返回的提案和检查，不是事实或人工验证。原文核验只证明引文存在；反方的语义判断也可能出错。</p>{run.candidateAudits.map((audit) => <details className="candidate-audit" key={audit.index}><summary>候选 {audit.index + 1} · {audit.evidenceStatus === "passed" ? "原文核验通过" : audit.evidenceStatus === "schema_failed" ? "结构不合格" : "原文或组件覆盖不合格"}{audit.review ? ` · 反方 ${audit.review.verdict}` : " · 无有效审查快照"}</summary>{audit.evidenceFailures?.length ? <><h4>原文核验缺口</h4><ul>{audit.evidenceFailures.map((failure, index) => <li key={`${failure.code}-${index}`}><b>{failure.code}</b>：{failure.message}</li>)}</ul><p className="context-note">这些缺口可以转成下一步补证任务；系统不会把它们升级成机会。</p></> : null}<h4>完整提案（模型输出）</h4><pre>{JSON.stringify(audit.proposal, null, 2)}</pre>{audit.review && <><h4>审查检查（模型判断）</h4><ul>{Object.entries(audit.review.checks).map(([check, passed]) => <li key={check}>{check === "profileFit" ? `画像适配：${{ not_applicable: "未设置画像", aligned: "一致", plausible: "有明确对应，待验证", unknown: "未知", misaligned: "偏离" }[String(passed) as "not_applicable" | "aligned" | "plausible" | "unknown" | "misaligned"] ?? "旧记录未保存"}` : `${check}：${passed ? "通过" : "未通过"}`}</li>)}</ul><h4>完整审查</h4><pre>{JSON.stringify(audit.review, null, 2)}</pre></>}</details>)}</section> : <p className="context-note">本次历史结果没有完整候选快照，不能逐字段复核原始提案；复用缓存不会补造历史内容。</p>}
  </details>;
}

function ActivityPage() {
  const runs = useQuery({ queryKey: ["scans"], queryFn: api.scans, refetchInterval: 3000 });
  const analyses = useQuery({ queryKey: ["analysis-runs"], queryFn: api.analysisRuns, refetchInterval: 5000 });
  return <>
    <PageHeading eyebrow="COLLECTION STATUS" title="运行轨迹" detail="查看每次 GitHub 采集的范围、结果和错误。" />
    <div className="activity-summary"><span><Activity size={16} />最近扫描</span><b>{runs.data?.[0] ? dateLabel(runs.data[0].startedAt) : "尚无扫描记录"}</b></div>
    <div className="run-list">{runs.data?.length ? runs.data.map((run) => <ScanRow key={run.id} run={run} />) : <EmptyState />}</div>
    <div className="section-head nested-head"><div><h2>机会审查记录</h2><span>保留与剔除都有理由；模型审查仍是推断</span></div><ShieldAlert size={17} /></div>
    {analyses.data?.slice(0, 10).map((run) => <AnalysisRunRecord key={run.id} run={run} />)}
  </>;
}

function ScanRow({ run }: { run: ScanRun }) {
  const statusLabel: Record<ScanRun["status"], string> = { queued: "排队中", running: "正在采集", succeeded: "采集完成", partial: "采集部分成功", failed: "采集失败" };
  return <div className="run-row"><span className={`run-status ${run.status}`}>{run.status === "running" && <LoaderCircle size={13} className="spin" />}{statusLabel[run.status]}</span><span className="run-id">{run.id}</span><span className="run-date">{dateLabel(run.startedAt)}</span><span className="run-count">发现 {run.found} · 新信号 {run.inserted} · 重复 {run.duplicates}</span>{run.tracks?.length ? <details className="scan-tracks"><summary>发现范围 · {run.tracks.length} 个渠道</summary>{run.tracks.map((track) => <p key={track.id}><b>{track.label} · 第 {track.page ?? 1} 页 · {track.found ?? 0} 个</b><code>{track.query}</code>{track.totalCount !== undefined && <span>搜索匹配约 {track.totalCount.toLocaleString()} 个；有限采样。</span>}{track.incomplete && <span>GitHub 搜索不完整，下轮重试本页。</span>}{track.searchComplete === false && !track.incomplete && <span>本页资料未完整取得，保留重试位置。</span>}{track.error}</p>)}</details> : null}{(run.error || run.warnings.length > 0) && <p className="run-error">{[run.error, ...run.warnings].filter(Boolean).join(" · ")}</p>}</div>;
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const plan = useQuery({ queryKey: ["discovery-plan"], queryFn: api.discoveryPlan, refetchInterval: 5000 });
  const save = useMutation({ mutationFn: api.saveSettings, onSuccess: () => { setDraft(null); void queryClient.invalidateQueries({ queryKey: ["settings"] }); void queryClient.invalidateQueries({ queryKey: ["discovery-plan"] }); } });
  const [draft, setDraft] = useState<Settings | null>(null);
  const value = draft ?? settings.data;
  function setProfileField(field: "targetUser" | "recurringWork" | "constraints", text: string) {
    if (!value) return;
    setDraft({ ...value, researchProfile: { targetUser: "", recurringWork: "", constraints: "", ...value.researchProfile, [field]: text } });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (value) save.mutate(value);
  }
  if (!value) return <div className="loading-row"><LoaderCircle size={16} className="spin" /> 正在读取采集设置</div>;
  return <>
    <PageHeading eyebrow="SOURCE CONFIGURATION" title="采集设置" detail="设置 GitHub Search 查询和本地采集频率。" />
    <IntegrationsPanel />
    <section className="settings-form" aria-label="下次扫描范围">
      <div className="settings-section"><div className="settings-label"><h2>下次扫描范围</h2><p>按已保存设置显示。首页刷新与后续页探索交替进行，重启保留位置；查询或每页数量变化时，相应渠道重新开始。搜索排序会变化，翻页仍可能重复或遗漏。</p></div><div className="settings-control">
        {plan.isError && <p className="form-error">{plan.error.message}</p>}
        {!plan.data && !plan.isError && <small>正在读取查询…</small>}
        {plan.data?.map((track) => <div key={track.id}><b>{track.label} · 第 {track.page ?? 1} 页 · 最多 {track.limit} 个</b><small>{track.query}</small></div>)}
        <small>每渠道最多探索 20 页，并受 GitHub 前 1,000 项限制；到末页后重新轮换。资料失败或搜索不完整时重试本页。页码不代表已覆盖的独立仓库数量。</small>
      </div></div>
    </section>
    <form className="settings-form" onSubmit={submit}>
      <div className="settings-section"><div className="settings-label"><h2>研究画像 · 可选</h2><p>告诉系统优先研究谁的什么工作。用于后续模型分析的筛选和反方审查，不是已验证需求；保存不会启动分析，也不改变 GitHub 搜索范围。</p></div><div className="settings-control">
        <label htmlFor="profile-user">目标用户</label><input id="profile-user" maxLength={240} value={value.researchProfile?.targetUser ?? ""} onChange={(event) => setProfileField("targetUser", event.target.value)} placeholder="例如：维护公开数据流程的小团队" />
        <label htmlFor="profile-work">反复发生的工作</label><textarea id="profile-work" rows={3} maxLength={400} value={value.researchProfile?.recurringWork ?? ""} onChange={(event) => setProfileField("recurringWork", event.target.value)} placeholder="例如：每周整理数据来源、核对转换结果并交付报告" />
        <label htmlFor="profile-constraints">技术与交付约束</label><textarea id="profile-constraints" rows={3} maxLength={400} value={value.researchProfile?.constraints ?? ""} onChange={(event) => setProfileField("constraints", event.target.value)} placeholder="例如：本地运行、一人能维护；暂不做重部署或需要企业账号的方案" />
        <button type="button" className="button-secondary" onClick={() => setDraft({ ...value, researchProfile: null })}>清空研究画像</button><small>清空后点击“保存设置”生效。画像会随分析请求发送给已配置的模型服务；不要填写客户秘密或个人敏感信息。</small>
      </div></div>
      <div className="settings-section"><div className="settings-label"><h2>发现方式</h2><p>广度发现同时寻找新兴能力、早期项目、自动化与数据基础组件，并加入你的关注查询。</p></div><div className="settings-control"><label htmlFor="discovery-mode">发现范围</label><select id="discovery-mode" value={value.discoveryMode ?? "balanced"} onChange={(event) => setDraft({ ...value, discoveryMode: event.target.value as Settings["discoveryMode"] })}><option value="balanced">跨领域发现 + 自定义关注</option><option value="custom">只使用自定义查询</option></select><small>每轮总上限分配到 5 个查询，重复仓库合并。成熟组件不受新建窗口限制。</small></div></div>
      <div className="settings-section"><div className="settings-label"><h2>GitHub 搜索</h2><p>使用 GitHub repository search 语法；索引延迟和匿名配额会影响发现范围。</p></div><div className="settings-control"><label htmlFor="search-query">查询条件</label><textarea id="search-query" rows={3} value={value.searchQuery} onChange={(event) => setDraft({ ...value, searchQuery: event.target.value })} placeholder="topic:ai-agent language:TypeScript stars:>=20" /><small>示例：topic:ai-agent language:TypeScript stars:&gt;=20</small></div></div>
      <div className="settings-section"><div className="settings-label"><h2>新项目窗口</h2><p>搜索最近创建的公开仓库。手动查询条件包含 created: 时，以手动条件为准。</p></div><div className="settings-control"><label htmlFor="created-window">仓库创建时间</label><select id="created-window" value={value.createdWithinDays} onChange={(event) => setDraft({ ...value, createdWithinDays: Number(event.target.value) })}><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option><option value={180}>最近 180 天</option><option value={365}>最近 1 年</option></select></div></div>
      <div className="settings-section"><div className="settings-label"><h2>扫描上限</h2><p>每个仓库补充 README、Release 和最多 5 条公开 Issue。一次模型分析最多选 12 个项目，控制调用成本。</p></div><div className="settings-control"><label htmlFor="max-results">每次最多采集</label><div className="input-suffix"><input id="max-results" type="number" min={1} max={60} value={value.maxResults} onChange={(event) => setDraft({ ...value, maxResults: Number(event.target.value) })} /><span>个仓库</span></div></div></div>
      <div className="settings-section"><div className="settings-label"><h2>本地调度</h2><p>仅在机会捕手进程运行时执行周期扫描。</p></div><div className="settings-control"><label htmlFor="interval">扫描间隔</label><div className="input-suffix"><input id="interval" type="number" min={6} max={168} value={value.scanIntervalHours} onChange={(event) => setDraft({ ...value, scanIntervalHours: Number(event.target.value) })} /><span>小时</span></div></div></div>
      <div className="settings-footer"><span>{save.isSuccess ? <><Check size={14} />设置已保存</> : save.isError ? save.error.message : "数据仅查询公开 GitHub 仓库"}</span><button className="button-primary" type="submit" disabled={save.isPending}>{save.isPending ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}保存设置</button></div>
    </form>
  </>;
}

function IntegrationsPanel() {
  const queryClient = useQueryClient();
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: api.integrations, refetchInterval: 3000 });
  const analyze = useMutation({ mutationFn: api.analyze, onSuccess: () => { void queryClient.invalidateQueries(); } });
  const value = integrations.data;
  if (!value) return <div className="loading-row">正在检查执行与分析服务…</div>;
  const lastRun = value.analysis.lastRun;
  const lastOutcome = lastRun ? explainAnalysisOutcome(lastRun) : null;
  const modelState = value.analysis.running ? "分析进行中" : value.analysis.state === "needs_cli" ? "本机 CLI 或模型待配置" : value.analysis.state === "needs_api_key" ? "待填写 API Key" : value.analysis.state === "rules_only" ? "仅规则分析" : lastRun?.model === value.analysis.model && lastRun.status === "failed" ? "最近同模型分析失败" : lastRun?.model === value.analysis.model && lastRun.status === "succeeded" ? lastRun.reusedFrom ? "最近同模型分析复用历史结果" : "最近同模型分析已完成" : "已配置，尚待实际调用验证";
  return <section className="settings-form integrations-panel" aria-label="执行与分析服务">
    <div className="settings-section"><div className="settings-label"><h2>iii 执行引擎</h2><p>配置 iii 后断线会明确报错，可重启引擎后继续扫描。</p></div><div className="settings-control"><b>{value.runtime === "iii" ? `iii Engine · ${value.engineState}` : "本地执行器"}</b><small>本次服务启动后已完成 {value.completedExecutions} 次函数调用。</small></div></div>
    <div className="settings-section">
      <div className="settings-label"><h2>{value.analysis.mode === "local" ? "免费模型优先 · 本机 Codex 后备" : value.analysis.mode === "codex" ? "本机 Codex 分析" : value.analysis.mode === "opencode" ? "OpenCode 免费模型分析" : value.analysis.mode === "deepseek" ? "DeepSeek 机会分析" : "规则分析"}</h2><p>提出组合机会 → 原文引用校验 → 反方审查。模型角色不代表独立验证，结果仍是待验证的假设。</p></div>
      <div className="settings-control">
        <b>{modelState}</b><small>模型通道：{value.analysis.model}</small>
        {["local", "opencode"].includes(value.analysis.mode) && <p>免费 GLM 优先，其次 MiniMax，再尝试其他已确认零价格的 OpenCode 模型。不会自动调用 DeepSeek API。</p>}
        {["local", "codex"].includes(value.analysis.mode) && <p>{value.analysis.mode === "codex" ? "使用本机 Codex 的模型配置。" : value.analysis.codexFallback ? "免费候选不可用时，使用本机 Codex 后备。" : "本机 Codex 后备尚未配置。"}Codex 模型费用与额度取决于你已有的服务配置，不标记为免费。本机 CLI 仍可能联网调用模型服务。</p>}
        {value.analysis.state === "needs_cli" && <p>在项目 .env 配置 OPENCODE_BIN，或 CODEX_BIN 与 CODEX_MODEL，然后重启服务。</p>}
        {value.analysis.state === "needs_api_key" && <p>在项目 .env 填入 DEEPSEEK_API_KEY，然后重启服务。<a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">获取 DeepSeek API Key ↗</a></p>}
        {lastRun && <small>最近分析配置：{lastRun.model}{lastRun.modelsUsed?.length ? `；实际使用：${lastRun.modelsUsed.join("、")}` : ""}</small>}
        {lastRun?.error && <p className="form-error">{lastRun.error}</p>}
        {lastOutcome && <p className="context-note analysis-service-outcome"><b>{lastOutcome.label}</b>；{lastOutcome.detail}</p>}
        {lastRun && <small>{analysisRunUsageLabel(lastRun)}。</small>}
        <button type="button" className="button-secondary" disabled={analyze.isPending || value.analysis.running || value.evidence?.running || (value.analysis.state !== "configured" && value.analysis.state !== "rules_only") || (value.runtime === "iii" && value.engineState !== "connected")} onClick={() => analyze.mutate()}><Sparkles size={14} />分析已有项目</button>
        {analyze.isError && <small className="form-error">{analyze.error.message}</small>}{analyze.isSuccess && <small>分析任务已提交，状态将自动刷新。相同输入可复用已完成结果。</small>}
      </div>
    </div>
    <div className="settings-section"><div className="settings-label"><h2>GitHub 访问凭证</h2><p>用于提高官方 API 配额，凭证只在服务端使用。</p></div><div className="settings-control"><b>{value.github.tokenConfigured ? "Token 已配置，扫描时验证" : "匿名访问，易受限流影响"}</b><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">创建 Fine-grained Token ↗</a><small>只读取公开仓库：选择 Public repositories，不添加额外写入权限。填入本地 .env 的 GITHUB_TOKEN 后重启。</small></div></div>
    <div className="settings-section"><div className="settings-label"><h2>GitHub TLS 信任链</h2><p>提交研究前会先做证书校验预检。</p></div><div className="settings-control github-tls-status"><b>{value.github.caConfigured ? "已配置额外 PEM CA bundle" : "使用系统信任链，未配置额外 CA"}</b><p>{value.github.caConfigured ? "仍需通过 GitHub 预检后才能证明连接可用。" : "如果预检报告证书链失败，请让管理员通过可信渠道提供 PEM CA bundle，并设置 RADAR_GITHUB_CA_FILE 后重启服务。"}</p><small>不能使用失败连接中的叶证书，也不能关闭 TLS 校验；当前状态只描述配置，不代表连接已成功。</small></div></div>
  </section>;
}

function languageClass(language: string | null) {
  if (!language) return "unknown";
  return `lang-${language.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export default App;
