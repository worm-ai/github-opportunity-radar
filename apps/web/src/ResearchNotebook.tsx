import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { researchSources, researchSourceKey, type ResearchNoteInput, type ResearchSource, type ResearchSourceProject } from "@radar/contracts/research";
import { measurementValue, trialTimeSummary, type TrialMeasurement } from "@radar/contracts/validation";
import { api, type ResearchNoteView } from "./api";

export const researchDecisionLabel = { continue: "继续研究", watch: "等待变化", stop: "停止这条方向" };
export const hasResearchEncodingGap = (value: string) => /\?{2,}|�/.test(value);
export function ResearchReadableText({ value, label }: { value: string; label: string }) {
  if (!hasResearchEncodingGap(value)) return <>{value}</>;
  return <><span className="corrupt-field-warning">{label}包含不可恢复字符，未作为可读证据显示。</span><details className="corrupt-field"><summary>展开原始字段</summary><code>{value}</code></details></>;
}
export function researchNoteUrl(note: ResearchNoteView, revise = false) {
  const params = new URLSearchParams();
  if (note.originDemandId) {
    params.set("run", note.originDemandId);
    if (revise) params.set("note", note.id);
    return `/research?${params}#demand-decisions`;
  }
  for (const id of note.projectIds) params.append("project", id);
  if (note.originIssue) {
    params.delete("project"); params.append("project", note.originIssue.projectId);
    for (const id of note.projectIds) if (id !== note.originIssue.projectId) params.append("project", id);
    params.set("issue", String(note.originIssue.issueNumber));
  }
  if (revise) params.set("note", note.id);
  return `/opportunities?${params}`;
}

export function ResearchNotebook({ compact = false }: { compact?: boolean }) {
  const query = useQuery({ queryKey: ["research-notes"], queryFn: api.researchNotes });
  const [history, setHistory] = useState(false);
  const all = query.data ?? [], active = all.filter((note) => !note.supersededBy);
  const notes = (history ? all : active).slice(0, compact ? 3 : 100);
  return <section id="research-notes" className="research-notebook" aria-label="研究判断记录">
    <div className="section-head"><div><h2>研究判断</h2><span>保存值得继续、等待变化或应该停止的理由</span></div>{!compact && <label className="note-history"><input type="checkbox" checked={history} onChange={(event) => setHistory(event.target.checked)} />含历史判断</label>}</div>
    {query.isLoading && <p>正在读取研究判断…</p>}
    {query.isError && <p className="form-error">{query.error.message}</p>}
    {query.isSuccess && !notes.length && <p className="context-note">尚无研究判断。研究后可在组合表单下保存结论和准确原文；不需要先生成机会卡片。</p>}
    {notes.map((note) => {
      const changed = note.evidenceStates.some((state) => state !== "same");
      return <article className={`research-note note-${note.decision}`} key={note.id} data-note-id={note.id}>
        <div className="research-note-status"><b>{researchDecisionLabel[note.decision]}</b><small>{note.author === "assistant" ? "代理研究 · 待人工复核" : "用户判断"} · {new Date(note.createdAt).toLocaleString("zh-CN")}{note.supersededBy ? " · 已有后续判断" : ""}</small></div>
        <h3>{hasResearchEncodingGap(note.title) ? "历史判断（原标题不可恢复）" : note.title}</h3>
        {hasResearchEncodingGap(note.title) && <details className="corrupt-field"><summary>展开原始标题</summary><code>{note.title}</code></details>}
        {changed && <p className="form-error">已采集来源发生变化或暂不可用，请重新核对判断。原文快照保留。</p>}
        <small className="context-note">{note.projectNames.join(" + ")} · {note.evidence.length} 条原文 · {note.originDemandId ? "需求实现尚待验收" : "尚无市场验证"}</small>
        {compact ? <details className="research-note-review"><summary>查看结论与下一步</summary><ResearchNoteContent note={note} /></details> : <ResearchNoteContent note={note} />}
        <div className="research-note-actions"><Link className="text-link" to={researchNoteUrl(note)}>核对当前材料</Link>{!note.supersededBy && <Link className="text-link" to={researchNoteUrl(note, true)}>更新判断</Link>}<a className="text-link" href={`/api/v1/research-notes/${note.id}/report.md`} download>导出判断</a></div>
      </article>;
    })}
    {compact && active.length > 3 && <Link className="text-link" to="/opportunities#research-notes">查看其余 {active.length - 3} 条判断</Link>}
  </section>;
}

export function ResearchNoteContent({ note }: { note: ResearchNoteView }) {
  return <>
    {note.originDemandId && <p><Link to={researchNoteUrl(note)}>查看原需求研究</Link> · 判断关联的是这次历史材料，非当前项目档案。</p>}
    <div className="research-note-conclusion"><ResearchReadableText value={note.conclusion} label="结论" /></div><div><b>下一步：</b><ResearchReadableText value={note.nextAction} label="下一步" /></div>
    {note.valueMeasurement && <details className="research-note-measurement"><summary>本次任务对照</summary><p>{note.valueMeasurement.taskDescription}</p><p>基线：{note.valueMeasurement.baselineMethod}<br />使用后：{note.valueMeasurement.assistedMethod}</p><p>{note.valueMeasurement.comparable ? "任务可比" : "任务不可比"} · {note.valueMeasurement.bothCompleted ? "前后均完成" : "前后未均完成或未确认"} · {note.valueMeasurement.timing} · {note.valueMeasurement.tasksCompared} 项</p><p>基线 {measurementValue(note.valueMeasurement.baselineMinutes)} 分钟 · 使用后 {measurementValue(note.valueMeasurement.assistedMinutes)} 分钟 · 误留 {measurementValue(note.valueMeasurement.falseKeeps)} · 漏选 {measurementValue(note.valueMeasurement.missedCandidates)}</p><p className="context-note">{trialTimeSummary(note.valueMeasurement)} 本记录只描述本次任务，不代表普遍收益。</p></details>}
    <details><summary>问题与原文依据</summary><div><ResearchReadableText value={note.question} label="研究问题" /></div>{note.evidence.map((source, index) => <div className="research-note-evidence" key={index}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a><div><ResearchReadableText value={source.quote} label="原文引用" /></div><small>采集 {new Date(source.observedAt).toLocaleString("zh-CN")} · {source.notice}</small><p className="context-note">{note.evidenceStates[index] === "same" ? "与当前已采集内容一致；未核对远端最新状态。" : note.evidenceStates[index] === "changed" ? "来源内容或状态已变化，请复核。" : "来源当前不可用，保存时的原文仍保留。"}</p></div>)}</details>
  </>;
}

export type ResearchNoteDraft = Pick<ResearchNoteInput, "title" | "question" | "decision" | "author" | "conclusion" | "nextAction" | "evidence">;

export function ResearchNoteForm({ projects, question, originIssue, originDemandId, availableSources, initial, draft, startWithMeasurement = false }: { projects: ResearchSourceProject[]; question: string; originIssue?: ResearchNoteInput["originIssue"]; originDemandId?: string; availableSources?: ResearchSource[]; initial?: ResearchNoteView; draft?: ResearchNoteDraft; startWithMeasurement?: boolean }) {
  const sources = availableSources ? availableSources.filter(source => projects.some(project => project.id === source.ref.projectId)) : researchSources(projects);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(initial?.title ?? draft?.title ?? ""), [researchQuestion, setQuestion] = useState(initial?.question ?? draft?.question ?? question);
  const [decision, setDecision] = useState<ResearchNoteInput["decision"]>(initial?.decision ?? draft?.decision ?? "watch");
  const [author, setAuthor] = useState<ResearchNoteInput["author"]>(initial?.author ?? draft?.author ?? "user");
  const [conclusion, setConclusion] = useState(initial?.conclusion ?? draft?.conclusion ?? ""), [nextAction, setNextAction] = useState(initial?.nextAction ?? draft?.nextAction ?? "");
  const [measure, setMeasure] = useState(Boolean(initial?.valueMeasurement) || startWithMeasurement);
  const [measurement, setMeasurement] = useState<TrialMeasurement>(initial?.valueMeasurement ?? { taskDescription: "", baselineMethod: "", assistedMethod: "", comparable: true, bothCompleted: true, timing: "unmeasured", tasksCompared: 1, baselineMinutes: null, assistedMinutes: null, falseKeeps: null, missedCandidates: null });
  const [evidence, setEvidence] = useState(() => initial?.evidence.map((item) => ({ key: researchSourceKey(item.ref), quote: item.quote })) ?? draft?.evidence.map((item) => ({ key: researchSourceKey(item.ref), quote: item.quote })) ?? [{ key: "", quote: "" }]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [open, setOpen] = useState(Boolean(initial) || startWithMeasurement);
  const [timerMode, setTimerMode] = useState<"baseline" | "assisted" | null>(null);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerElapsedMs, setTimerElapsedMs] = useState(0);
  const save = useMutation({ mutationFn: api.saveResearchNote, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["research-notes"] }); void queryClient.invalidateQueries({ queryKey: ["research-note"] }); void queryClient.invalidateQueries({ queryKey: ["opportunity-research-notes"] }); setRequestId(crypto.randomUUID()); } });
  const unique = new Set(projects.map((project) => project.id)).size === projects.length;
  const validQuotes = evidence.every((item) => { const source = sources.find((source) => source.key === item.key); return source && item.quote.trim().length >= 16 && source.text.replace(/\s+/g, " ").includes(item.quote.trim().replace(/\s+/g, " ")); });
  const blocked = save.isPending || save.isSuccess || !projects.length || !unique || !validQuotes || title.trim().length < 4 || researchQuestion.trim().length < 12 || conclusion.trim().length < 15 || nextAction.trim().length < 10 || Boolean(initial?.supersededBy);
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (blocked) return;
    save.mutate({ requestId, author, title, question: researchQuestion, projectIds: projects.map((project) => project.id), decision, conclusion, nextAction, ...(measure ? { valueMeasurement: measurement } : {}), ...(originIssue ? { originIssue } : {}), ...(originDemandId ? { originDemandId } : {}), ...(initial ? { supersedesId: initial.id } : {}), evidence: evidence.map((item) => ({ ref: sources.find((source) => source.key === item.key)!.ref, quote: item.quote })) });
  };
  const updateMeasurement = <K extends keyof TrialMeasurement>(key: K, value: TrialMeasurement[K]) => { setMeasurement(previous => ({ ...previous, [key]: value })); save.reset(); };
  useEffect(() => {
    if (timerStartedAt === null) return;
    const tick = () => setTimerElapsedMs(Math.max(0, performance.now() - timerStartedAt));
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [timerStartedAt]);
  const startTimer = (mode: "baseline" | "assisted") => {
    setTimerMode(mode);
    setTimerStartedAt(performance.now());
    setTimerElapsedMs(0);
    save.reset();
  };
  const stopTimer = () => {
    if (!timerMode || timerStartedAt === null) return;
    const minutes = Number(((performance.now() - timerStartedAt) / 60_000).toFixed(2));
    updateMeasurement(timerMode === "baseline" ? "baselineMinutes" : "assistedMinutes", minutes);
    updateMeasurement("timing", "measured");
    setTimerMode(null);
    setTimerStartedAt(null);
    setTimerElapsedMs(0);
  };
  const timerMinutes = (timerElapsedMs / 60_000).toFixed(2);
  const numberValue = (value: number | null) => value === null ? "" : String(value);
  const parseNumber = (value: string) => value.trim() === "" ? null : Number(value);
  return <details className="research-note-editor" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{initial ? "更新研究判断（保留原记录）" : "记录研究判断，不调用模型"}</summary>
    <p className="context-note">先选择上方 1～3 个项目。记录是你的阶段判断，引用必须来自已采集原文；它不会改变机会评分或市场状态。{originDemandId ? "已绑定这次需求研究，可引用历史材料及人工实测；实测不是模型自动执行结果。" : originIssue ? `已绑定问题 #${originIssue.issueNumber}。` : "未绑定具体 Issue。"}</p>
    <form onSubmit={submit} aria-label="保存研究判断">
      <label>判断标题<input aria-label="判断标题" value={title} onChange={(event) => { setTitle(event.target.value); save.reset(); }} minLength={4} maxLength={160} required /></label>
      <label>这次研究的问题<textarea aria-label="记录的研究问题" value={researchQuestion} onChange={(event) => { setQuestion(event.target.value); save.reset(); }} minLength={12} maxLength={4000} rows={2} required /></label>
      {question && <button className="button-secondary" type="button" onClick={() => { setQuestion(question); save.reset(); }}>使用上方研究问题</button>}
      <label>当前决定<select aria-label="研究决定" value={decision} onChange={(event) => { setDecision(event.target.value as ResearchNoteInput["decision"]); save.reset(); }}>{Object.entries(researchDecisionLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>记录者<select aria-label="判断记录者" value={author} onChange={(event) => { setAuthor(event.target.value as ResearchNoteInput["author"]); save.reset(); }}><option value="user">用户判断</option><option value="assistant">代理研究（待人工复核）</option></select></label>
      <label>结论与理由<textarea aria-label="判断结论" value={conclusion} onChange={(event) => { setConclusion(event.target.value); save.reset(); }} minLength={15} maxLength={2400} rows={3} required /></label>
      <label>下一步或重新审视条件<textarea aria-label="判断下一步" value={nextAction} onChange={(event) => { setNextAction(event.target.value); save.reset(); }} minLength={10} maxLength={1200} rows={2} placeholder="写明接下来验证什么、通过条件，以及出现什么结果就停止或换路线。" required /></label>
      <fieldset className="research-note-measurement-editor"><legend><label><input type="checkbox" checked={measure} onChange={(event) => { setMeasure(event.target.checked); if (!event.target.checked) { setTimerMode(null); setTimerStartedAt(null); setTimerElapsedMs(0); } save.reset(); }} />记录本次任务对照（可选）</label></legend>
        {measure && <><p className="context-note">只记录这次实际使用的任务；空白耗时保持“未记录”，不会自动当作 0，也不能据此推出普遍省时。</p>
          <label>任务描述<input aria-label="对照任务描述" value={measurement.taskDescription} onChange={event => updateMeasurement("taskDescription", event.target.value)} minLength={10} maxLength={500} required={measure} /></label>
          <label>基线方法<input aria-label="基线方法" value={measurement.baselineMethod} onChange={event => updateMeasurement("baselineMethod", event.target.value)} minLength={2} maxLength={300} required={measure} /></label>
          <label>使用后方法<input aria-label="使用后方法" value={measurement.assistedMethod} onChange={event => updateMeasurement("assistedMethod", event.target.value)} minLength={2} maxLength={300} required={measure} /></label>
          <div className="measurement-timer" aria-label="同一任务计时器"><p><b>同一任务计时器</b>：先按实际流程计时，再把结果写入对应字段；计时器只在本机运行，不会自动保存。</p>{timerMode ? <p role="timer">正在记录{timerMode === "baseline" ? "基线" : "使用后"}：{timerMinutes} 分钟 <button className="button-secondary" type="button" onClick={stopTimer}>停止并填入</button></p> : <div className="demand-actions"><button className="button-secondary" type="button" onClick={() => startTimer("baseline")}>开始基线计时</button><button className="button-secondary" type="button" onClick={() => startTimer("assisted")}>开始使用后计时</button></div>}</div>
          <label><input type="checkbox" checked={measurement.comparable} onChange={event => updateMeasurement("comparable", event.target.checked)} /> 前后任务条件可比</label>
          <label><input type="checkbox" checked={measurement.bothCompleted} onChange={event => updateMeasurement("bothCompleted", event.target.checked)} /> 前后任务均完成</label>
          <label>计时<select aria-label="任务计时方式" value={measurement.timing} onChange={event => updateMeasurement("timing", event.target.value as TrialMeasurement["timing"])}><option value="measured">实际计时</option><option value="estimated">估计</option><option value="unmeasured">未记录</option></select></label>
          <label>对比任务数<input aria-label="对比任务数" type="number" min={1} max={1000} value={measurement.tasksCompared} onChange={event => updateMeasurement("tasksCompared", Number(event.target.value))} required={measure} /></label>
          <label>基线分钟<input aria-label="基线分钟" type="number" min={0} max={100000} step="any" value={numberValue(measurement.baselineMinutes)} onChange={event => updateMeasurement("baselineMinutes", parseNumber(event.target.value))} /></label>
          <label>使用后分钟<input aria-label="使用后分钟" type="number" min={0} max={100000} step="any" value={numberValue(measurement.assistedMinutes)} onChange={event => updateMeasurement("assistedMinutes", parseNumber(event.target.value))} /></label>
          <label>误留候选数<input aria-label="误留候选数" type="number" min={0} max={100000} value={numberValue(measurement.falseKeeps)} onChange={event => updateMeasurement("falseKeeps", parseNumber(event.target.value))} /></label>
          <label>漏选候选数<input aria-label="漏选候选数" type="number" min={0} max={100000} value={numberValue(measurement.missedCandidates)} onChange={event => updateMeasurement("missedCandidates", parseNumber(event.target.value))} /></label>
        </>}
      </fieldset>
      {evidence.map((item, index) => {
        const source = sources.find((source) => source.key === item.key);
        return <fieldset className="research-note-source" key={index}><legend>依据 {index + 1}</legend><label>已采集来源<select aria-label={`判断来源 ${index + 1}`} value={item.key} onChange={(event) => { setEvidence((previous) => previous.map((prior, slot) => slot === index ? { key: event.target.value, quote: "" } : prior)); save.reset(); }} required><option value="">选择原文来源</option>{item.key && !source && <option value={item.key} disabled>旧来源当前不可用，请重新选择</option>}{sources.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}</select></label>
          {source && <><p className="context-note">{source.notice}</p><details><summary>查看已采集原文</summary><pre>{source.text}</pre></details></>}
          <label>连续原文引用<textarea aria-label={`判断引用 ${index + 1}`} value={item.quote} onChange={(event) => { setEvidence((previous) => previous.map((prior, slot) => slot === index ? { ...prior, quote: event.target.value } : prior)); save.reset(); }} minLength={16} maxLength={2000} rows={3} placeholder="从所选来源复制 16～2,000 字符的连续原文；判断理由写在上方。" required /></label>
          {item.quote.trim().length >= 16 && source && !source.text.replace(/\s+/g, " ").includes(item.quote.trim().replace(/\s+/g, " ")) && <p className="form-error">这段引用不在所选原文中，请核对。</p>}
          {evidence.length > 1 && <button className="button-secondary" type="button" onClick={() => { setEvidence((previous) => previous.filter((_, slot) => slot !== index)); save.reset(); }}>移除此依据</button>}
        </fieldset>;
      })}
      {evidence.length < 6 && <button className="button-secondary" type="button" onClick={() => { setEvidence((previous) => [...previous, { key: "", quote: "" }]); save.reset(); }}>增加一条依据</button>}
      <div className="research-submit"><button className="button-primary" type="submit" disabled={blocked}>{save.isPending ? "正在保存判断" : "保存研究判断"}</button><small>仅保存本地记录和原文快照。</small></div>
      {save.isError && <p className="form-error" role="alert">{save.error.message}</p>}
      {save.isSuccess && <p className="context-note" role="status">研究判断已保存，原文快照已留存；未调用模型。</p>}
      {initial?.supersededBy && <p className="form-error">此记录已有后续判断，请从最新记录继续更新。</p>}
    </form>
  </details>;
}
