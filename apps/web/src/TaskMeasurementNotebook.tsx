import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TrialMeasurement } from "@radar/contracts/validation";
import { measurementValue, trialTimeSummary } from "@radar/contracts/validation";
import { api, type TaskMeasurement } from "./api";

const emptyMeasurement = (): TrialMeasurement => ({
  taskDescription: "", baselineMethod: "", assistedMethod: "", comparable: true, bothCompleted: true,
  timing: "unmeasured", tasksCompared: 1, baselineMinutes: null, assistedMinutes: null, falseKeeps: null, missedCandidates: null,
});

export function TaskMeasurementNotebook({ originDemandId }: { originDemandId?: string | null }) {
  const query = useQuery({ queryKey: ["task-measurements"], queryFn: api.taskMeasurements, retry: false });
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [measurement, setMeasurement] = useState<TrialMeasurement>(emptyMeasurement);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [timerMode, setTimerMode] = useState<"baseline" | "assisted" | null>(null);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerElapsedMs, setTimerElapsedMs] = useState(0);
  const save = useMutation({
    mutationFn: api.saveTaskMeasurement,
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["task-measurements"] }); setRequestId(crypto.randomUUID()); setMeasurement(emptyMeasurement()); setOpen(false); },
  });
  useEffect(() => {
    if (timerStartedAt === null) return;
    const tick = () => setTimerElapsedMs(Math.max(0, performance.now() - timerStartedAt));
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [timerStartedAt]);
  const update = <K extends keyof TrialMeasurement>(key: K, value: TrialMeasurement[K]) => { setMeasurement(previous => ({ ...previous, [key]: value })); save.reset(); };
  const startTimer = (mode: "baseline" | "assisted") => { setTimerMode(mode); setTimerStartedAt(performance.now()); setTimerElapsedMs(0); save.reset(); };
  const stopTimer = () => {
    if (!timerMode || timerStartedAt === null) return;
    const minutes = Number(((performance.now() - timerStartedAt) / 60_000).toFixed(2));
    update(timerMode === "baseline" ? "baselineMinutes" : "assistedMinutes", minutes);
    update("timing", "measured");
    setTimerMode(null); setTimerStartedAt(null); setTimerElapsedMs(0);
  };
  const numberValue = (value: number | null) => value === null ? "" : String(value);
  const parseNumber = (value: string) => value.trim() === "" ? null : Number(value);
  const blocked = save.isPending || !measurement.taskDescription.trim() || measurement.taskDescription.trim().length < 10 || measurement.baselineMethod.trim().length < 2 || measurement.assistedMethod.trim().length < 2;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    save.mutate({ requestId, ...(originDemandId ? { originDemandId } : { originDemandId: null }), ...measurement });
  };
  return <section className="task-measurement-notebook" aria-label="独立任务对照">
    <div className="section-head"><div><h2>独立任务对照</h2><span>不依赖研究判断，记录一次真实任务是否更快或少返工</span></div><button className="button-secondary" type="button" onClick={() => setOpen(value => !value)}>{open ? "收起记录表" : "记录一次任务"}</button></div>
    <p className="context-note">只记录你实际完成的同一任务。空白耗时保持“未记录”；本记录不自动生成推荐，也不代表普遍收益。</p>
    {query.isError && <p className="form-error" role="alert">历史任务对照读取失败：{query.error.message}</p>}
    {query.data?.length ? <div className="task-measurement-list">{query.data.map(item => <TaskMeasurementRow key={item.id} item={item} />)}</div> : query.isSuccess ? <p className="context-note">还没有独立任务对照。</p> : null}
    {open && <form className="task-measurement-editor" onSubmit={submit} aria-label="保存独立任务对照">
      <label>任务描述<input aria-label="独立任务描述" value={measurement.taskDescription} onChange={event => update("taskDescription", event.target.value)} minLength={10} maxLength={500} required /></label>
      <label>人工基线方法<input aria-label="独立任务基线方法" value={measurement.baselineMethod} onChange={event => update("baselineMethod", event.target.value)} minLength={2} maxLength={300} required /></label>
      <label>使用后方法<input aria-label="独立任务使用后方法" value={measurement.assistedMethod} onChange={event => update("assistedMethod", event.target.value)} minLength={2} maxLength={300} required /></label>
      <div className="measurement-timer" aria-label="独立任务计时器"><p><b>本地计时器</b>：只在浏览器运行，不自动保存。</p>{timerMode ? <p role="timer">正在记录{timerMode === "baseline" ? "基线" : "使用后"}：{(timerElapsedMs / 60_000).toFixed(2)} 分钟 <button className="button-secondary" type="button" onClick={stopTimer}>停止并填入</button></p> : <div className="demand-actions"><button className="button-secondary" type="button" onClick={() => startTimer("baseline")}>开始基线计时</button><button className="button-secondary" type="button" onClick={() => startTimer("assisted")}>开始使用后计时</button></div>}</div>
      <label><input type="checkbox" checked={measurement.comparable} onChange={event => update("comparable", event.target.checked)} /> 前后任务条件可比</label>
      <label><input type="checkbox" checked={measurement.bothCompleted} onChange={event => update("bothCompleted", event.target.checked)} /> 前后任务均完成</label>
      <label>计时方式<select aria-label="独立任务计时方式" value={measurement.timing} onChange={event => update("timing", event.target.value as TrialMeasurement["timing"])}><option value="measured">实际计时</option><option value="estimated">估计</option><option value="unmeasured">未记录</option></select></label>
      <label>对比任务数<input aria-label="独立任务对比数量" type="number" min={1} max={1000} value={measurement.tasksCompared} onChange={event => update("tasksCompared", Number(event.target.value))} required /></label>
      <label>基线分钟<input aria-label="独立任务基线分钟" type="number" min={0} max={100000} step="any" value={numberValue(measurement.baselineMinutes)} onChange={event => update("baselineMinutes", parseNumber(event.target.value))} /></label>
      <label>使用后分钟<input aria-label="独立任务使用后分钟" type="number" min={0} max={100000} step="any" value={numberValue(measurement.assistedMinutes)} onChange={event => update("assistedMinutes", parseNumber(event.target.value))} /></label>
      <label>误留候选数<input aria-label="独立任务误留候选数" type="number" min={0} max={100000} value={numberValue(measurement.falseKeeps)} onChange={event => update("falseKeeps", parseNumber(event.target.value))} /></label>
      <label>漏选候选数<input aria-label="独立任务漏选候选数" type="number" min={0} max={100000} value={numberValue(measurement.missedCandidates)} onChange={event => update("missedCandidates", parseNumber(event.target.value))} /></label>
      {save.isError && <p className="form-error" role="alert">{save.error.message}</p>}
      <button className="button-primary" type="submit" disabled={blocked}>{save.isPending ? "正在保存" : "保存本次任务对照"}</button>
    </form>}
  </section>;
}

function TaskMeasurementRow({ item }: { item: TaskMeasurement }) {
  return <article className="task-measurement-row"><div><b>{item.taskDescription}</b><small>{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.originDemandId ? "绑定需求研究" : "独立记录"}</small></div><p>{trialTimeSummary(item)}</p><small>基线 {measurementValue(item.baselineMinutes)} 分钟 · 使用后 {measurementValue(item.assistedMinutes)} 分钟 · 误留 {measurementValue(item.falseKeeps)} · 漏选 {measurementValue(item.missedCandidates)}</small><a className="text-link" href={`/api/v1/task-measurements/${encodeURIComponent(item.id)}/report.md`} download>导出对照</a></article>;
}

