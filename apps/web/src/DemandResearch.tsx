import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type DemandRun, type DemandSnapshot } from "./api";
import { DemandExperiments } from "./DemandExperiments";
import { DemandDecisions } from "./DemandDecisions";
import { DemandLineage } from "./DemandLineage";
import { DemandBriefExport } from "./DemandBriefExport";
import { TaskMeasurementNotebook } from "./TaskMeasurementNotebook";
import { groupDemandRuns, demandRunLabel, demandGroupEntry, type DemandGroup } from "./demand-lineage";
import { demandSearchStatus } from "./demand-search-status";
import { demandAction } from "./demand-action";
import { triageCachedCandidates } from "./demand-cache";
import "./demand.css";

const example = "我想做一个社会模拟游戏。多个 AI 角色有自己的身份、记忆和目标，能自主交流、形成关系，并根据共同世界里的事件采取行动。玩家可以介入和观察。帮我找可复用的开源实现，优先考虑能直接运行的项目。";
const stages: Record<DemandSnapshot["stage"], string> = { planning: "分析需求", searching: "搜索 GitHub", selecting: "筛选候选", collecting: "采集资料", evaluating: "比较实现路径", reviewing: "反方审查", finished: "研究完成", failed: "研究失败" };
const outcomes = { adopt: "直接采用", adapt: "改造单项目", combine: "组合项目", insufficient_evidence: "证据不足" };
const statuses = { running: "研究中", succeeded: "已完成", partial: "部分完成", failed: "失败", interrupted: "已中断" };
const coverageLabels = { supported: "资料支持", partial: "部分支持", unsupported: "资料明确不支持", unknown: "未知" };
const date = (value: string) => new Date(value).toLocaleString("zh-CN");
const cacheStopWords = new Set(["want", "make", "build", "real", "find", "help", "need", "use", "using", "with", "from", "the", "and", "for", "github", "project", "projects", "implementation", "implement"]);
const cacheChineseTerms = ["多智能体", "社会模拟", "持久身份", "共享世界", "重启恢复", "本地优先", "知识库", "记忆", "目标", "玩家", "事件", "开源", "笔记", "文档", "协作", "代理", "游戏", "模型", "实时"];
export function cacheQueryFromDemand(question: string) {
  const words = question.match(/[A-Za-z][A-Za-z0-9-]{2,}/g)?.map(word => word.toLowerCase()).filter(word => !cacheStopWords.has(word)) ?? [];
  if (words.length) return [...new Set(words)].slice(0, 2).join(" ");
  const chinese = cacheChineseTerms.find(term => question.includes(term));
  return chinese ?? "agent";
}

const demandDraftStorageKey = "radar:demand-draft:v1";
type DemandDraft = { question: string; retryOf: string | null };

function readDemandDraft(): DemandDraft | null {
  try {
    const raw = window.localStorage.getItem(demandDraftStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DemandDraft>;
    if (typeof parsed.question !== "string" || parsed.question.trim().length < 1 || parsed.question.length > 4000) return null;
    if (parsed.retryOf !== null && parsed.retryOf !== undefined && typeof parsed.retryOf !== "string") return null;
    return { question: parsed.question, retryOf: parsed.retryOf ?? null };
  } catch {
    return null;
  }
}

function writeDemandDraft(draft: DemandDraft | null) {
  try {
    if (!draft || !draft.question.trim()) window.localStorage.removeItem(demandDraftStorageKey);
    else window.localStorage.setItem(demandDraftStorageKey, JSON.stringify(draft));
  } catch {
    // Restrictive storage policies must not block research.
  }
}

function CachedDemandCandidates({ question }: { question: string }) {
  const [query, setQuery] = useState(() => cacheQueryFromDemand(question));
  const [submitted, setSubmitted] = useState(() => cacheQueryFromDemand(question));
  const cached = useQuery({ queryKey: ["demand-cache-candidates", submitted], queryFn: () => api.searchProjects(submitted, 12, true), enabled: submitted.trim().length > 0, staleTime: 30_000 });
  const triage = cached.data ? triageCachedCandidates(cached.data.items, cached.data.expandedQueries) : [];
  return <section className="demand-notice demand-cache-candidates" aria-label="本地缓存候选"><h3>网络失败后的本地缓存线索</h3><p>以下只检索本机已经保存的项目档案，不访问 GitHub、模型或写入任务；命中结果不是实时状态、兼容证明或推荐。关键词是从需求中提取的起点，可以修改。</p><form onSubmit={event => { event.preventDefault(); setSubmitted(query.trim()); }}><label htmlFor="demand-cache-query">缓存关键词</label><div className="demand-actions"><input id="demand-cache-query" value={query} onChange={event => setQuery(event.target.value)} minLength={1} maxLength={256} /><button className="button-secondary" type="submit" disabled={!query.trim() || cached.isFetching}>检索本地缓存</button></div></form>{cached.isError && <p className="form-error" role="alert">{cached.error.message}</p>}{cached.data && <><small>模式：{cached.data.mode} · 查询：{cached.data.query} · 最晚观察：{cached.data.observedAt ? date(cached.data.observedAt) : "无"}</small>{cached.data.expandedQueries.length > 0 && <p className="context-note" role="status">精确查询无结果，已扩展为单词线索：{cached.data.expandedQueries.join("、")}。这些结果仅用于人工复核，不是推荐。</p>} <div className="demand-actions"><a className="text-link" href={`/api/v1/projects/search?q=${encodeURIComponent(cached.data.query)}&limit=12&expand=true&download=true`} download>下载 JSON 证据</a><a className="text-link" href={`/api/v1/projects/search?q=${encodeURIComponent(cached.data.query)}&limit=12&expand=true&format=markdown`} download>下载 Markdown 交接简报</a></div>{triage.length > 0 && <section className="cache-triage" aria-label="离线证据短名单"><h4>离线证据短名单</h4><p className="context-note">先核验证据较多的项目，最多打开两个；这是阅读顺序，不是推荐或可运行结论。</p><div className="cache-triage-grid">{triage.slice(0, 3).map(({ item, evidenceCount, evidenceLabel, matchLabel, nextAction }) => <article className="cache-triage-card" key={item.id}><div className="cache-triage-meta"><span>{evidenceLabel}</span><span>{matchLabel}</span><span>{evidenceCount} 条摘录</span></div><h5><Link to={`/projects/${encodeURIComponent(item.id)}`}>{item.fullName}</Link></h5><p>{nextAction}</p><a className="text-link" href={item.url} target="_blank" rel="noreferrer">打开 GitHub ↗</a></article>)}</div></section>}{cached.data.items.length ? <details className="cache-evidence-list" open><summary>查看全部 {cached.data.items.length} 条缓存证据</summary><ul>{cached.data.items.map(item => <li key={item.id}><Link to={`/projects/${encodeURIComponent(item.id)}`}>{item.fullName}</Link> · <a className="text-link" href={item.url} target="_blank" rel="noreferrer">打开 GitHub ↗</a> · 命中 {item.matchedFields.join("、")} · 观察 {date(item.observedAt)}{item.matchedEvidence.map(evidence => <blockquote key={evidence.field}><small>{evidence.field === "readmeExcerpt" ? "README 摘录" : evidence.field === "description" ? "项目描述" : "项目名"}：{evidence.excerpt}</small></blockquote>)}</li>)}</ul></details> : <p>没有命中已保存档案；这不证明 GitHub 上不存在相关实现。</p>}</>}</section>;
}

export function DemandResearch() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("run");
  const [restoredDraft] = useState(readDemandDraft);
  const [question, setQuestion] = useState(restoredDraft?.question ?? "");
  const [retryOf, setRetryOf] = useState<string | null>(restoredDraft?.retryOf ?? null);
  const [draftRestored, setDraftRestored] = useState(Boolean(restoredDraft));
  const [composerOpen, setComposerOpen] = useState(!selectedId);
  const [showLocalCache, setShowLocalCache] = useState(false);
  useEffect(() => { setComposerOpen(!selectedId); if (!selectedId && !restoredDraft) setRetryOf(null); }, [selectedId, restoredDraft]);
  const request = useRef<{ question: string; retryOf: string | null; requestId: string } | null>(null);
  const cache = useQueryClient();
  const history = useQuery({ queryKey: ["demands"], queryFn: api.demands, refetchInterval: 4000 });
  const run = useQuery({ queryKey: ["demand", selectedId], queryFn: () => api.demand(selectedId!), enabled: Boolean(selectedId), refetchInterval: query => query.state.data?.status === "running" ? 2000 : false });
  const researchNotes = useQuery({ queryKey: ["demand-research-notes", selectedId], queryFn: () => api.demandResearchNotes(selectedId!), retry: false, enabled: Boolean(selectedId) });
  const integration = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, refetchInterval: 5000 });
  const features = useQuery({ queryKey: ["demand-features"], queryFn: api.demandFeatures, retry: false });
  const start = useMutation({ mutationFn: api.startDemand, onSuccess: result => {
    cache.setQueryData(["demand", result.id], result);
    writeDemandDraft(null);
    setDraftRestored(false);
    setParams({ run: result.id }); setComposerOpen(false); setShowLocalCache(false); request.current = null;
    void cache.invalidateQueries({ queryKey: ["demands"] });
    void cache.invalidateQueries({ queryKey: ["dashboard"] });
  }, onError: () => setShowLocalCache(true) });
  useEffect(() => {
    if (!selectedId) writeDemandDraft({ question, retryOf });
  }, [question, retryOf, selectedId]);
  const active = history.data?.find(item => item.status === "running");
  const groups = groupDemandRuns(history.data ?? [], run.data);
  const selectedGroup = groups.find(group => group.runs.some(item => item.id === selectedId));
  const busy = Boolean(active || integration.data?.analysis.running || integration.data?.evidence?.running || ["running", "queued"].includes(integration.data?.lastScan?.status ?? ""));
  const submit = () => {
    const trimmed = question.trim();
    if (trimmed.length < 12 || busy || start.isPending) return;
    if (!request.current || request.current.question !== trimmed || request.current.retryOf !== retryOf) request.current = { question: trimmed, retryOf, requestId: crypto.randomUUID() };
    start.mutate(request.current);
  };
  const edit = (value: DemandRun) => { setQuestion(value.question); setRetryOf(value.id); setShowLocalCache(false); setComposerOpen(true); request.current = null; start.reset(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return <div className="demand-page">
    <section className="demand-intro">
      <p className="eyebrow">从想法到实现路径</p><h1>需求研究</h1>
      <details className="demand-composer" open={composerOpen} onToggle={event => setComposerOpen(event.currentTarget.open)}><summary>{retryOf ? "编辑需求 / 重新研究" : "描述你想实现什么"}</summary>
      <p>这里帮助你研究和选择可复用的开源实现：先比较单项目，再围绕明确缺口考虑组合，并给出原文依据、剩余工程和最小验证步骤。</p>
      <p className="context-note">这是实现选型与验证助手，不会替你开发完整游戏，也不会自动安装或运行任意上游代码。社会模拟只是验收案例；页面中的“组合项目”默认是待验证的工程假设。</p>
      {draftRestored && !selectedId && <p className="demand-draft-notice" role="status">已恢复上次未提交的需求草稿（仅保存在此浏览器）。<button className="text-link" type="button" onClick={() => { setQuestion(""); setRetryOf(null); setDraftRestored(false); writeDemandDraft(null); request.current = null; }}>清除草稿</button></p>}
      <form onSubmit={event => { event.preventDefault(); submit(); }}>
        <label htmlFor="demand-question">你的需求</label>
        <textarea id="demand-question" rows={5} minLength={12} maxLength={4000} required value={question} onChange={event => { setQuestion(event.target.value); setShowLocalCache(false); request.current = null; start.reset(); }} placeholder="例如：我想做一个多个 AI 角色共同生活的社会模拟游戏，玩家能观察并介入。有哪些开源实现可以复用？" />
        <div className="demand-actions">
          <button className="button-secondary" type="button" onClick={() => { setQuestion(example); setRetryOf(null); setShowLocalCache(false); request.current = null; start.reset(); }}>使用社会模拟示例</button>
          <button className="button-secondary" type="button" disabled={question.trim().length < 12} onClick={() => setShowLocalCache(true)}>先查本地缓存</button>
          <button className="button-primary" type="submit" disabled={busy || start.isPending || history.isPending || history.isError || question.trim().length < 12 || !integration.data || integration.data.analysis.state !== "configured"}>{start.isPending ? "正在提交" : retryOf ? "按当前需求重新研究" : "开始研究"}</button>
        </div>
        <p className="context-note">提交后先检查 GitHub 连接与搜索额度，通过后才调用已配置模型，按当前费用策略执行。研究可能需要数分钟，最多 6 次搜索、采集 8 个仓库。静态源码和文档证据不等于可运行验证；真实组合仍需在页面列出的实验中单独核实。</p>
        {retryOf && <p className="context-note">基于已有任务修改或重试，旧任务及材料会保留。重试会重新搜索并调用模型。</p>}
        {integration.data && integration.data.analysis.state !== "configured" && <p role="alert">需要先在<Link to="/settings">设置</Link>中配置模型。</p>}
        {history.isError && <p className="form-error" role="alert">需求研究服务暂不可用，当前服务可能尚未加载此功能。<button className="button-secondary" type="button" onClick={() => { void history.refetch(); }}>重新检查</button></p>}
        {busy && <p role="status">{active ? <><button className="button-secondary" type="button" onClick={() => setParams({ run: active.id })}>查看进行中的研究</button> · </> : null}请等待当前采集或分析完成，再发起新的研究。</p>}
        {start.isError && <p className="form-error" role="alert">{start.error.message}；可重试提交，相同请求不会重复创建任务。{question.trim().length >= 12 && <button className="button-secondary" type="button" onClick={() => setShowLocalCache(true)}>查看本地缓存线索</button>}</p>}
      </form>
      </details>
      {showLocalCache && question.trim().length >= 12 && <CachedDemandCandidates question={question} />}
    </section>
    <div className="demand-layout">
      <aside className="demand-history"><details open={!selectedId}><summary>研究记录{history.data ? `（${history.data.length}）` : ""}</summary>
        {history.isPending && <p>正在读取记录…</p>}{history.isError && <p role="alert">{history.error.message}<button type="button" onClick={() => { void history.refetch(); }}>重试读取研究记录</button></p>}
        {history.data && <p className="context-note">最近记录，最多 30 条；按明确关系分组。</p>}
        {history.data?.length === 0 && <p>提交需求后，进度和材料会保存在这里。</p>}
        {groups.map(group => <div className="demand-history-group" key={group.id}><button type="button" aria-current={group.runs.some(item => item.id === selectedId) ? "true" : undefined} onClick={() => setParams({ run: demandGroupEntry(group).id })}><strong>{group.runs[0]!.question}</strong><small>{group.runs.length} 次关联任务 · 最近{statuses[group.runs.at(-1)!.status]}{group.incomplete ? " · 前序未载全" : ""}</small></button><details><summary>展开任务（{group.runs.length}）</summary>{group.runs.map(item => <button type="button" key={item.id} aria-current={selectedId === item.id ? "true" : undefined} onClick={() => setParams({ run: item.id })}><strong>{demandRunLabel(item)} · {statuses[item.status]}</strong><small>{date(item.startedAt)} · {item.id.slice(0, 8)}</small></button>)}</details></div>)}
      </details></aside>
      <div className="demand-results" aria-live="polite">
        {run.isFetching && !run.data && <p>正在读取研究…</p>}
        {run.isError && <p className="form-error" role="alert">{run.error.message}<button type="button" onClick={() => { void run.refetch(); }}>重试读取</button></p>}
        {run.data && selectedGroup && <DemandResult key={run.data.id} run={run.data} manualNotes={researchNotes.data ?? []} group={selectedGroup} historyAvailable={history.isSuccess && features.isSuccess} historyError={history.isError} onEdit={() => edit(run.data!)} canContinue={features.data?.sourceStudy === true} canResume={features.data?.sourceResume === true} canResumeEvaluation={features.data?.evaluationResume === true} canResumeSelection={features.data?.selectionResume === true} canResumeGaps={features.data?.gapResume === true} canRecord={features.data?.researchNotes === true} busy={busy || integration.data?.analysis.state !== "configured"} onContinued={result => { cache.setQueryData(["demand", result.id], result); setParams({ run: result.id }); void cache.invalidateQueries({ queryKey: ["demands"] }); }} />}
        {!selectedId && <section className="demand-empty"><h2>先找到可复用的实现，再决定补什么</h2><p>研究结果会逐项说明能力覆盖、候选取舍、依据和下一步。没有足够证据时会明确停下来。</p></section>}
      </div>
    </div>
    <TaskMeasurementNotebook originDemandId={selectedId} />
  </div>;
}

function SourceStudyForm({ run, busy, onStarted }: { run: DemandRun; busy: boolean; onStarted: (result: DemandRun) => void }) {
  const [projects, setProjects] = useState<string[]>([]), [capabilities, setCapabilities] = useState<string[]>([]);
  const pending = useRef<{ parentId: string; requestId: string; projectIds: string[]; capabilityIds: string[] } | null>(null);
  const start = useMutation({ mutationFn: api.continueDemand, onSuccess: onStarted });
  const toggle = (values: string[], id: string, set: (values: string[]) => void) => { set(values.includes(id) ? values.filter(value => value !== id) : [...values, id]); pending.current = null; start.reset(); };
  return <section className="demand-source-form"><h3>针对缺口继续研究</h3><p>沿用原需求与材料，补读源码后重新比较实现路径。选择最多 2 个候选和 3 项疑问；浏览与选择不调用模型。</p>
    <form onSubmit={event => { event.preventDefault(); if (!projects.length || !capabilities.length || busy || start.isPending) return; pending.current ??= { parentId: run.id, requestId: crypto.randomUUID(), projectIds: [...projects].sort(), capabilityIds: [...capabilities].sort() }; start.mutate(pending.current); }}>
      <fieldset disabled={start.isPending}><legend>候选项目（{projects.length}/2）</legend>{run.snapshot!.projects.map(project => <label className="demand-source-choice" key={project.id}><input type="checkbox" checked={projects.includes(project.id)} disabled={!projects.includes(project.id) && projects.length >= 2} onChange={() => toggle(projects, project.id, setProjects)} /> {project.fullName}</label>)}</fieldset>
      <fieldset disabled={start.isPending}><legend>待核查能力（{capabilities.length}/3）</legend>{run.snapshot!.plan!.capabilities.map(capability => <label className="demand-source-choice" key={capability.id}><input type="checkbox" checked={capabilities.includes(capability.id)} disabled={!capabilities.includes(capability.id) && capabilities.length >= 3} onChange={() => toggle(capabilities, capability.id, setCapabilities)} /> {capability.description}</label>)}</fieldset>
      <p className="context-note">显式提交后最多新增 8 次模型调用（选文件、每批最多 2 个源码文件的证据核验、综合方案），每仓库 6 个文本文件、每文件前 12,000 字符、总计 48,000 字符。仅读源码，不安装运行。读取不全时会保留未知。</p>
      <button type="submit" className="button-primary" disabled={busy || start.isPending || !projects.length || !capabilities.length}>{start.isPending ? "正在提交续研" : "补读源码并重评"}</button>
      {start.isError && <p className="form-error" role="alert">{start.error.message}；可重试提交，相同请求不会重复创建任务。</p>}
    </form>
  </section>;
}

function SourceStudyEvidence({ snapshot }: { snapshot: DemandSnapshot }) {
  const study = snapshot.sourceStudy!;
  const names = { definition: "状态定义", write: "状态写入", decision: "决策读取", action: "实际动作", persistence: "保存恢复" };
  return <details id="demand-source-evidence" className="demand-source-evidence"><summary>源码核查（未经运行验证） · {study.findings.length} 条发现</summary><h3>源码核查（未经运行验证）</h3><p>本次保存 {study.charsRead.toLocaleString()} / 48,000 字符。重评与对抗式自审在同一模型阶段完成，不能替代独立审查或行为实验。大文件仅读取前部完整行，关键实现可能仍在未读部分。</p>
    <details><summary>目录与文件读取记录</summary>{study.inventories.map(item => <div key={item.projectId}><h4>{snapshot.projects.find(project => project.id === item.projectId)?.fullName}</h4><p>{item.status} · {item.inventory ? `提交 ${item.inventory.commitSha} · ${item.inventory.files.length} 个可读文本路径 · ${item.inventory.complete ? "GitHub 目录已读完（按文件类型筛选）" : "目录未读全"}` : item.error ?? "正在读取目录"}</p></div>)}<ul>{study.files.map((file, index) => <li key={index}>{snapshot.projects.find(project => project.id === file.projectId)?.fullName} / {file.path} · {file.status}<p>{file.reason}{file.error ? `；${file.error}` : ""}</p></li>)}</ul></details>
    {study.findings.map(finding => <section key={`${finding.projectId}:${finding.capabilityId}`}><h4>{snapshot.projects.find(project => project.id === finding.projectId)?.fullName} · {snapshot.plan?.capabilities.find(capability => capability.id === finding.capabilityId)?.description}</h4><p>{finding.conclusion}</p><ul>{finding.chain.map(step => <li key={step.step}><b>{names[step.step]} · {step.status === "located" ? "已定位静态依据" : step.status === "unclear" ? "仍不明确" : "尚未读到"}</b><p>{step.note}</p>{step.evidence.map((citation, index) => { const source = snapshot.sources.find(item => item.id === citation.sourceId); return <blockquote key={index}><pre>{citation.quote}</pre>{source && <a href={`${source.url.split("#")[0]}#L${citation.startLine}-L${citation.endLine}`} target="_blank" rel="noreferrer">{source.path}:{citation.startLine}–{citation.endLine} ↗</a>}</blockquote>; })}</li>)}</ul></section>)}
  </details>;
}

function SourceResume({ run, busy, onStarted }: { run: DemandRun; busy: boolean; onStarted: (result: DemandRun) => void }) {
  const pending = useRef<string | null>(null);
  const start = useMutation({ mutationFn: api.resumeDemandSource, onSuccess: onStarted });
  return <section className="demand-source-resume"><h3>继续分析已采源码</h3><p>沿用本次已保存的固定提交、原读取时间和核查范围，仅新增一次模型分析。不会刷新 GitHub 版本；如需补读文件或更换范围，请返回原研究任务。旧失败记录会保留。</p>
    <button className="button-primary" type="button" disabled={busy || start.isPending} onClick={() => { pending.current ??= crypto.randomUUID(); start.mutate({ runId: run.id, requestId: pending.current }); }}>{start.isPending ? "正在提交分析" : "用已采源码继续分析"}</button>
    {start.isError && <p className="form-error" role="alert">{start.error.message}；可重试提交，相同请求不会重复创建任务。</p>}
  </section>;
}

function EvaluationResume({ run, busy, onStarted }: { run: DemandRun; busy: boolean; onStarted: (result: DemandRun) => void }) {
  const pending = useRef<string | null>(null);
  const start = useMutation({ mutationFn: api.resumeDemandEvaluation, onSuccess: onStarted });
  return <section className="demand-source-resume"><h3>继续比较已采材料</h3><p>沿用原需求与已保存资料，重新评估并做反方审查。降级材料先重新理解原问题；可能在剩余预算内补搜和采集。原读取时间和版本限制继续有效，旧记录保留。模型仍可能不可用，资料也可能不足以形成建议。</p>
    <button className="button-primary" type="button" disabled={busy || start.isPending} onClick={() => { pending.current ??= crypto.randomUUID(); start.mutate({ runId: run.id, requestId: pending.current }); }}>{start.isPending ? "正在提交比较" : "用已采材料继续比较"}</button>
    {start.isError && <p className="form-error" role="alert">{start.error.message}；可重试提交，相同请求不会重复创建任务。</p>}
  </section>;
}

function SelectionResume({ run, busy, onStarted }: { run: DemandRun; busy: boolean; onStarted: (result: DemandRun) => void }) {
  const pending = useRef<string | null>(null);
  const start = useMutation({ mutationFn: api.resumeDemandSelection, onSuccess: onStarted });
  return <section className="demand-source-resume"><h3>继续候选筛选</h3><p>复用已保存的需求拆解和初始 GitHub 搜索预览；初始搜索不会重跑。后续评估仍可能按缺口补充搜索。旧失败记录会保留。</p>
    <button className="button-primary" type="button" disabled={busy || start.isPending} onClick={() => { pending.current ??= crypto.randomUUID(); start.mutate({ runId: run.id, requestId: pending.current }); }}>{start.isPending ? "正在提交筛选" : "用已采预览继续筛选"}</button>
    {start.isError && <p className="form-error" role="alert">{start.error.message}；可重试提交，相同请求不会重复创建任务。</p>}
  </section>;
}

function GapResume({ run, busy, onStarted }: { run: DemandRun; busy: boolean; onStarted: (result: DemandRun) => void }) {
  const pending = useRef<string | null>(null);
  const start = useMutation({ mutationFn: api.resumeDemandGaps, onSuccess: onStarted });
  return <section className="demand-source-resume"><h3>按评估缺口补搜并重评</h3><p>围绕本次评估明确记录的缺口重新搜索 GitHub，采集新的候选后再评估并做反方审查。原需求和已采材料保留；零结果不证明相关实现不存在，仍需结合有限搜索范围判断。</p>
    <button className="button-primary" type="button" disabled={busy || start.isPending} onClick={() => { pending.current ??= crypto.randomUUID(); start.mutate({ runId: run.id, requestId: pending.current }); }}>{start.isPending ? "正在提交补搜" : "开始缺口补搜"}</button>
    {start.isError && <p className="form-error" role="alert">{start.error.message}；可重试提交，相同请求不会重复创建任务。</p>}
  </section>;
}

const pathAnchor = (id: string) => `demand-path-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

function DemandPathOverview({ snapshot, final }: { snapshot: DemandSnapshot; final: DemandSnapshot["evaluations"][number] | undefined }) {
  if (!final?.paths.length) return null;
  const kindLabel = { adopt: "直接采用", adapt: "改造单项目", combine: "组合项目" } as const;
  return <section className="demand-path-overview" aria-label="实现路径总览">
    <div className="section-head"><div><h3>实现路径总览</h3><span>先比较决策，再展开原文证据</span></div></div>
    <p className="context-note">以下是本次资料研究形成的待验证路径摘要。覆盖数量来自保存的引用，不能替代依赖安装、启动、接口衔接和失败恢复实测。</p>
    <div className="demand-path-overview-grid">{final.paths.map(path => {
      const review = snapshot.reviews?.reviews.find(item => item.pathId === path.id);
      const reviewPassed = review?.verdict === "keep" && Object.values(review.checks).every(Boolean);
      const supported = path.coverage.filter(item => item.status === "supported").length;
      const tested = snapshot.recommendedPathId === path.id && reviewPassed ? "研究保留 · 仍待运行验收" : review ? "反方未完全通过 · 待补证" : "尚未完成反方审查";
      const names = path.projectIds.map(id => snapshot.projects.find(project => project.id === id)?.fullName ?? id);
      return <article className="demand-path-overview-card" key={path.id}>
        <p className="eyebrow">{kindLabel[path.kind]}{snapshot.recommendedPathId === path.id && reviewPassed ? " · 当前资料最强" : ""}</p>
        <h4>{path.title}</h4>
        <p className="context-note">{names.join(" + ")}</p>
        <dl><div><dt>能力覆盖</dt><dd>{supported}/{path.coverage.length} 项资料支持</dd></div><div><dt>审查状态</dt><dd>{tested}</dd></div><div><dt>运行边界</dt><dd>尚无通用组合运行证明</dd></div></dl>
        <p><b>最小验证：</b>{path.experiment.input}</p>
        <a className="text-link" href={`#${pathAnchor(path.id)}`}>查看完整证据与失败条件 →</a>
      </article>;
    })}</div>
  </section>;
}

function DemandResult({ run, manualNotes, group, historyAvailable, historyError, onEdit, canContinue, canResume, canResumeEvaluation, canResumeSelection, canResumeGaps, canRecord, busy, onContinued }: { run: DemandRun; manualNotes: import("@radar/contracts/research").ResearchNoteView[]; group: DemandGroup; historyAvailable: boolean; historyError: boolean; onEdit: () => void; canContinue: boolean; canResume: boolean; canResumeEvaluation: boolean; canResumeSelection: boolean; canResumeGaps: boolean; canRecord: boolean; busy: boolean; onContinued: (result: DemandRun) => void }) {
  const snapshot = run.snapshot, final = snapshot?.evaluations.at(-1);
  const candidateProjects = snapshot?.projects ?? [], candidateSources = snapshot?.sources ?? [];
  const searchStatus = demandSearchStatus(run);
  const showCacheCandidates = Boolean(searchStatus || (run.status === "failed" && candidateProjects.length === 0));
  const conclusion = snapshot?.reviews?.conclusion ?? final?.conclusion;
  const action = demandAction(run, manualNotes);
  useEffect(() => {
    const reveal = () => {
      if (!["#demand-plan", "#demand-source-evidence"].includes(window.location.hash)) return;
      const target = document.getElementById(window.location.hash.slice(1));
      if (target instanceof HTMLDetailsElement) { target.open = true; target.scrollIntoView(); }
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [run.id, Boolean(snapshot)]);
  return <article>
    <div className="demand-result-heading"><div><p className="eyebrow">{statuses[run.status]} · {run.status === "running" && snapshot ? stages[snapshot.stage] : run.status === "interrupted" ? "需要显式重试" : snapshot && run.status !== "failed" ? outcomes[snapshot.outcome] : "未形成可信建议"}</p><h2 title={run.question}>{run.question}</h2><small>{date(run.startedAt)}</small></div>
      <div className="demand-actions">{canRecord && run.status !== "running" && snapshot && snapshot.projects.length > 0 && <><a className="button-secondary" href={`?run=${encodeURIComponent(run.id)}#demand-decisions`}>记录选型判断</a><a className="button-secondary" href={`?run=${encodeURIComponent(run.id)}&measure=1#demand-decisions`}>记录本次任务对照</a></>}<button className="button-secondary" type="button" onClick={onEdit}>编辑需求 / 重试</button><a className="button-secondary" href={`/api/v1/demands/${encodeURIComponent(run.id)}/report.json`} download>导出完整材料</a></div>
    </div>
    {searchStatus && <div className="demand-notice" role="alert"><h3>{searchStatus.title}</h3><p>{searchStatus.reason}</p><p>{searchStatus.next}</p><p>已有需求拆解与执行记录保留在本任务；尚无可信选型结论。</p><button className="button-secondary" type="button" onClick={onEdit}>编辑需求 / 重新研究</button></div>}
    <section className={`demand-action demand-action-${action.kind}`} aria-label="当前行动摘要">
      <p className="eyebrow">当前行动摘要</p><h3>{action.title}</h3>
      <p className="demand-action-next"><b>下一步：</b>{action.next}</p>
      {action.blockers.length > 0 && <><h4>阻断因素</h4><ul>{action.blockers.map(item => <li key={item}>{item}</li>)}</ul></>}
      {action.projectNames.length > 0 && <p><b>涉及候选：</b>{action.projectNames.join("、")}</p>}
      <p>{action.explanation}</p>
      {Boolean(snapshot && snapshot.projects.length > 0) && <div className="demand-actions">{canRecord && run.status !== "running" && <><a className="button-secondary" href={`?run=${encodeURIComponent(run.id)}#demand-decisions`}>记录本次判断</a><a className="button-secondary" href={`?run=${encodeURIComponent(run.id)}&measure=1#demand-decisions`}>记录本次任务对照</a></>}<a className="button-secondary" href="#demand-experiments">查看或启动受控实测</a></div>}
      {action.experiment && <details><summary>验收标准</summary><p><b>输入：</b>{action.experiment.input}</p><p><b>通过：</b>{action.experiment.pass}</p><p><b>失败：</b>{action.experiment.fail}</p></details>}
    </section>
    {showCacheCandidates && <CachedDemandCandidates question={run.question} />}
    <DemandBriefExport run={run} group={group} canRecord={canRecord} historyAvailable={historyAvailable} />
    <DemandLineage run={run} group={group} canRecord={canRecord} historyError={historyError} />
    {run.error && <p className="form-error" role="alert">{run.error}</p>}
    {run.status === "running" && <p role="status">任务正在执行，刷新页面后可继续查看。当前材料是阶段结果，尚未形成最终建议。</p>}
    {run.status === "interrupted" && <p>下方是中断前的阶段材料，不代表研究完成；不会自动重新调用模型。</p>}
    {run.continuationOf && <p>本次沿用<Link to={`/research?run=${encodeURIComponent(run.continuationOf)}`}>原研究任务</Link>的需求与资料，旧结论保留；调用用量仅统计本次新增调用。{run.status !== "running" && <>可返回原任务重新选择疑问续研。</>}</p>}
    {run.retryOf && !run.continuationOf && !snapshot?.evaluationResume && <p>本次基于<Link to={`/research?run=${encodeURIComponent(run.retryOf)}`}>前次研究任务</Link>重试或修改需求；需求有修改时分别展示，旧报告保留。</p>}
    {snapshot?.evaluationResume && <p>本次复用<Link to={`/research?run=${encodeURIComponent(snapshot.evaluationResume.fromRunId)}`}>此前研究的已采材料</Link>继续比较；降级材料先重新理解原问题。若评估指出明确缺口，会在剩余预算内补搜、采集候选、重评并做反方审查。原任务和材料保留；零结果不证明相关实现不存在。</p>}
    {snapshot?.selectionResume && <p>本次复用<Link to={`/research?run=${encodeURIComponent(snapshot.selectionResume.fromRunId)}`}>失败研究的需求拆解与初始搜索预览</Link>继续筛选和采集，初始搜索未重跑；后续评估可能按缺口补充搜索。旧失败记录仍可查看。</p>}
    {snapshot?.gapResume && <p>本次沿用<Link to={`/research?run=${encodeURIComponent(snapshot.gapResume.fromRunId)}`}>原研究记录的评估缺口</Link>重新搜索并采集候选，再进行比较和反方审查；零结果不代表 GitHub 上不存在实现。</p>}
    {snapshot?.sourceStudy?.resumedFrom && <p>分析材料复用自<Link to={`/research?run=${encodeURIComponent(snapshot.sourceStudy.resumedFrom)}`}>这次失败研究</Link>；未重新采集或刷新源码版本。</p>}
    {candidateProjects.length > 0 && !final?.paths.length && <section className="demand-notice" aria-label="已采候选摘要"><h3>已找到的真实候选</h3><p>以下仓库来自本次 GitHub 搜索并已采集资料；模型尚未完成语义筛选、运行验证或推荐，请把它们作为待核查候选。</p><ul>{candidateProjects.map(project => { const preview = (snapshot?.searches ?? []).flatMap(search => search.items).find(item => item.fullName.toLowerCase() === project.fullName.toLowerCase()); const projectSources = candidateSources.filter(source => source.projectId === project.id).length; return <li key={project.id}><a href={project.url} target="_blank" rel="noreferrer">{project.fullName} ↗</a>{preview?.description ? <span>：{preview.description}</span> : ""} <small> · {preview?.stars !== undefined ? `★ ${preview.stars.toLocaleString("zh-CN")} · ` : ""}{project.language ?? "语言未知"} · {project.license ?? "许可证未知"} · {projectSources} 份来源</small></li>; })}</ul><p className="context-note">已采集 {candidateProjects.length} 个仓库、{candidateSources.length} 份有界来源；详细查询、来源和限制见下方记录。</p></section>}
    {canResumeSelection && !run.continuationOf && ["failed", "interrupted"].includes(run.status) && snapshot?.calls.at(-1)?.stage === "selection" && snapshot.plan && snapshot.searches.length > 0 && <SelectionResume run={run} busy={busy} onStarted={onContinued} />}
    {canResume && run.continuationOf && ["failed", "interrupted"].includes(run.status) && ["source_assessment", "source_synthesis"].includes(snapshot?.calls.at(-1)?.stage ?? "") && snapshot?.sources.some(source => source.field === "code") && <SourceResume run={run} busy={busy} onStarted={onContinued} />}
    {canResumeEvaluation && !run.continuationOf && (run.status === "partial" || ["failed", "interrupted"].includes(run.status)) && ["plan", "evaluation", "evaluation_compact"].includes(snapshot?.calls.at(-1)?.stage ?? "") && candidateProjects.length > 0 && candidateSources.length > 0 && <EvaluationResume run={run} busy={busy} onStarted={onContinued} />}
    {canResumeGaps && !run.continuationOf && run.status === "partial" && snapshot?.stage === "finished" && snapshot.evaluations.at(-1)?.gapQueries.length && snapshot.searches.length < 6 && snapshot.collections.length < 8 && <GapResume run={run} busy={busy} onStarted={onContinued} />}
    {snapshot && <>
      <nav className="demand-result-nav" aria-label="研究结果导航">{canRecord && run.status !== "running" && snapshot.projects.length > 0 && <><a href="#demand-decisions">选型判断</a><a href={`?run=${encodeURIComponent(run.id)}&measure=1#demand-decisions`}>本次任务对照</a></>}{snapshot.projects.length > 0 && <a href="#demand-experiments">补充实测</a>}{snapshot.plan && <a href="#demand-plan" onClick={() => { const element = document.getElementById("demand-plan"); if (element instanceof HTMLDetailsElement) element.open = true; }}>需求拆解</a>}{snapshot.sourceStudy && <a href="#demand-source-evidence" onClick={() => { const element = document.getElementById("demand-source-evidence"); if (element instanceof HTMLDetailsElement) element.open = true; }}>源码依据</a>}</nav>
      {conclusion && <section className="demand-model-conclusion" aria-label="模型研究结论"><h3>{run.status === "running" ? "阶段判断（待审查）" : run.status === "succeeded" || run.status === "partial" ? "模型研究结论" : "历史阶段判断（未完成）"}</h3><p>{conclusion}</p><p className="context-note">这是本次资料或源码研究的历史结论。后续人工判断与补充实测在下方单独列出；项目是否满足完整需求仍待验收。</p></section>}
      <DemandPathOverview snapshot={snapshot} final={final} />
      {canRecord && run.status !== "running" && snapshot.projects.length > 0 && <DemandDecisions key={run.id} run={run} />}
      {snapshot.projects.length > 0 && <DemandExperiments run={run} />}
      {snapshot.warnings.length > 0 && <details className="demand-notice"><summary>检索边界与缺失材料（{snapshot.warnings.length}）</summary><ul>{snapshot.warnings.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
      {snapshot.plan && <details id="demand-plan"><summary>需求拆解、约束与待澄清问题</summary><p>{snapshot.plan.summary}</p><ul>{snapshot.plan.capabilities.map(item => <li key={item.id}><b>{item.required ? "必须" : "可选"} · {item.origin === "user" ? "依据用户描述" : "研究假设"}</b>：{item.description}</li>)}</ul>
        {snapshot.plan.constraints.length > 0 && <><h4>约束</h4><ul>{snapshot.plan.constraints.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
        {snapshot.plan.assumptions.length > 0 && <><h4>可修改假设</h4><ul>{snapshot.plan.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
        {snapshot.plan.questions.length > 0 && <><h4>待澄清</h4><ul>{snapshot.plan.questions.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
      </details>}
      {snapshot.sourceStudy && <SourceStudyEvidence snapshot={snapshot} />}
      {canContinue && !run.continuationOf && run.status !== "running" && snapshot.plan && snapshot.projects.length > 0 && <SourceStudyForm run={run} busy={busy} onStarted={onContinued} />}
      {final?.paths.map(path => {
        const review = snapshot.reviews?.reviews.find(item => item.pathId === path.id);
        const recommended = (run.status === "succeeded" || run.status === "partial") && snapshot.recommendedPathId === path.id;
        return <section id={pathAnchor(path.id)} className={`demand-path${recommended ? " recommended" : ""}`} key={path.id}>
          <p className="eyebrow">{recommended ? "推荐验证 · " : "候选路径 · "}{outcomes[path.kind]}{review?.verdict === "reject" ? " · 反方未通过" : ""}</p><h3>{path.title}</h3>
          <p>{path.projectIds.map((id, i) => { const project = snapshot.projects.find(item => item.id === id); return <span key={id}>{i > 0 ? " + " : ""}<Link to={`/projects/${encodeURIComponent(id)}`}>{project?.fullName ?? id}</Link>（许可证：{project?.license ?? "未知"}）</span>; })}</p>
          <div className="demand-notice"><strong>{path.kind === "combine" ? "组合验证状态：静态证据，尚未完成真实组合运行验证。" : "验证状态：当前为文档/源码证据，尚未证明完整应用可运行。"}</strong><p>模型分析只能形成待验证路径；只有固定版本、依赖安装、启动、接口/状态衔接和失败恢复等实验均有归档证据，才能称为运行验证。</p></div>
          {review && (review.verdict === "reject" || !Object.values(review.checks).every(Boolean)) && <div className="demand-notice"><strong>此路径未通过反方复核，以下能力判断是被质疑的评估结果。</strong><p>{review.reason}</p></div>}
          <h4>{review && (review.verdict === "reject" || !Object.values(review.checks).every(Boolean)) ? "评估阶段能力判断（待补证）" : "能力覆盖"}</h4><div className="demand-coverage">{path.coverage.map(item => <div key={item.capabilityId}><b>{snapshot.plan?.capabilities.find(capability => capability.id === item.capabilityId)?.description ?? item.capabilityId}</b><span className={`coverage-${item.status}`}>{coverageLabels[item.status]}</span><p>{item.reason}</p>{item.evidence.map((citation, i) => { const source = snapshot.sources.find(candidate => candidate.id === citation.sourceId); return <blockquote key={i}><p>{citation.quote}</p>{source && <small><a href={source.url} target="_blank" rel="noreferrer">{source.path ?? source.field} ↗</a> · {date(source.observedAt)} · {source.notice}</small>}</blockquote>; })}</div>)}</div>
          <h4>约束适配：{path.constraintsFit === "compatible" ? "资料判断相容" : path.constraintsFit === "conflict" ? "存在冲突" : "仍待核实"}</h4><p>{path.constraintReason}</p>
          <h4>分工与衔接</h4><ul>{path.roles.map(role => <li key={role.projectId}><b>{snapshot.projects.find(project => project.id === role.projectId)?.fullName}</b>：{role.responsibility}<br />输入：{role.input}<br />输出：{role.output}</li>)}</ul><p>{path.integration}</p>
          <h4>剩余工程</h4><ul>{path.remainingWork.map((item, i) => <li key={i}>{item}</li>)}</ul><h4>风险与不确定性</h4><ul>{path.risks.map((item, i) => <li key={i}>{item}</li>)}</ul>
          <h4>最小验证实验（尚未执行）</h4><p>输入：{path.experiment.input}</p><ol>{path.experiment.steps.map((item, i) => <li key={i}>{item}</li>)}</ol><p>通过条件：{path.experiment.pass}</p><p>失败条件：{path.experiment.fail}</p>
          {review ? <div className="demand-notice"><h4>反方审查：{review.verdict === "keep" && Object.values(review.checks).every(Boolean) ? "可保留验证" : "未通过"}</h4><p>{review.reason}</p><ul>{review.risks.map((item, i) => <li key={i}>{item}</li>)}</ul></div> : <p>尚未完成反方审查。</p>}
        </section>;
      })}
      <details><summary>实际搜索与候选取舍（{snapshot.searches.length}/6 次搜索）</summary>
        {snapshot.searches.map((search, i) => <section key={i}><h4>{search.phase === "initial" ? "初始搜索" : "缺口补搜"} · {search.query}</h4><p>{search.reason}</p><p>{search.status === "failed" ? "失败" : search.status === "running" ? "进行中" : "已执行"} · {date(search.observedAt)}{search.total !== null ? ` · 匹配 ${search.total} 项，预览 ${search.items.length} 项` : ""}{search.incomplete ? " · GitHub 标记不完整" : ""}</p>{search.error && <p className="form-error">{search.error}</p>}
          {search.items.map(item => <div key={item.fullName}><a href={item.url} target="_blank" rel="noreferrer">{item.fullName} ↗</a><p>{item.description}</p><small>{item.language ?? "语言未知"} · {item.license ?? "许可证未知"}{item.archived ? " · 已归档" : ""}{item.fork ? " · Fork" : ""}</small></div>)}
        </section>)}
        {snapshot.selections.map((round, i) => <section key={i}><h4>第 {round.round} 轮候选取舍</h4><ul>{round.selection.selected.map(item => <li key={item.fullName}>选中 {item.fullName}：{item.reason}</li>)}{round.selection.skipped.map(item => <li key={item.fullName}>跳过 {item.fullName}：{item.reason}</li>)}</ul></section>)}
        <h4>采集记录（{snapshot.collections.length}/8 个仓库）</h4><ul>{snapshot.collections.map((item, i) => <li key={i}>{item.fullName} · {item.status === "running" ? "采集中" : item.status === "failed" ? "失败" : "已采集"}{item.error ? `：${item.error}` : ""}</li>)}</ul>
      </details>
      <details><summary>模型调用与原文材料</summary><p>通道：{snapshot.provider} · 配置模型：{snapshot.model} · 未自动切换到 DeepSeek API。</p><ul>{snapshot.calls.map((call, i) => <li key={i}>{call.stage} · {call.model} · {call.status} · 输入 {call.promptTokens ?? "未知"} / 输出 {call.completionTokens ?? "未知"} token</li>)}</ul>
        {snapshot.sources.map(source => <details key={source.id}><summary>{snapshot.projects.find(project => project.id === source.projectId)?.fullName} · {source.path ?? source.field}</summary><p>{source.notice} · {date(source.observedAt)}{source.commitSha ? ` · ${source.commitSha}` : ""}</p><a href={source.url} target="_blank" rel="noreferrer">原始来源 ↗</a><pre>{source.content}</pre></details>)}
      </details>
    </>}
  </article>;
}
