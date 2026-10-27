import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { externalValidationSchema, measurementValue, trialTimeSummary } from "@radar/contracts/validation";
import { api, type Opportunity } from "./api";

const optionalNumber = (value: string) => value.trim() === "" ? null : Number(value);
const timingLabels = { measured: "实测", estimated: "估计", unmeasured: "未计时" };

export function ExternalValidation({ opportunity }: { opportunity: Opportunity }) {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<"interview" | "trial" | "payment">("interview");
  const [outcome, setOutcome] = useState<"supports" | "refutes" | "inconclusive">("inconclusive");
  const [note, setNote] = useState("");
  const [includeMeasurement, setIncludeMeasurement] = useState(false);
  const [task, setTask] = useState("");
  const [baselineMethod, setBaselineMethod] = useState("");
  const [assistedMethod, setAssistedMethod] = useState("");
  const [tasks, setTasks] = useState("1");
  const [baseline, setBaseline] = useState("");
  const [assisted, setAssisted] = useState("");
  const [falseKeeps, setFalseKeeps] = useState("");
  const [missed, setMissed] = useState("");
  const [comparable, setComparable] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [timing, setTiming] = useState<"measured" | "estimated" | "unmeasured">("unmeasured");
  const parsed = externalValidationSchema.safeParse({ method, outcome, note,
    ...(method === "trial" && includeMeasurement ? { trialMeasurement: {
      taskDescription: task, baselineMethod, assistedMethod, comparable, bothCompleted: completed,
      timing, tasksCompared: Number(tasks), baselineMinutes: optionalNumber(baseline), assistedMinutes: optionalNumber(assisted),
      falseKeeps: optionalNumber(falseKeeps), missedCandidates: optionalNumber(missed),
    } } : {}),
  });
  const save = useMutation({ mutationFn: async () => {
    if (!parsed.success) throw new Error("请检查任务说明、方法和数值范围。");
    const value = parsed.data;
    return api.recordValidation(opportunity.id, value.method, value.outcome, value.note, value.trialMeasurement);
  }, onSuccess: () => {
    setNote(""); setTask(""); setBaselineMethod(""); setAssistedMethod(""); setTasks("1");
    setBaseline(""); setAssisted(""); setFalseKeeps(""); setMissed("");
    setComparable(false); setCompleted(false); setTiming("unmeasured"); setIncludeMeasurement(false);
    void queryClient.invalidateQueries();
  } });
  return <>
    {opportunity.validationRecords.map((record, index) => <div className="validation-record" key={`${record.recordedAt}-${index}`}>
      <b>外部验证 · {{ interview: "用户访谈", trial: "试用", payment: "付费承诺" }[record.method]} · {{ supports: "支持假设", refutes: "反驳假设", inconclusive: "尚不确定" }[record.outcome]}</b>
      <p>{record.note}</p>
      {record.trialMeasurement && <div className="trial-measurement">
        <p>任务：{record.trialMeasurement.taskDescription}</p>
        <p>基线方法：{record.trialMeasurement.baselineMethod}；使用后方法：{record.trialMeasurement.assistedMethod}</p>
        <p>{record.trialMeasurement.comparable ? "任务可比" : "任务不可比"} · {record.trialMeasurement.bothCompleted ? "前后均完成" : "前后未均完成或未确认"} · {timingLabels[record.trialMeasurement.timing]} · 任务数 {record.trialMeasurement.tasksCompared}</p>
        <p>基线分钟：{measurementValue(record.trialMeasurement.baselineMinutes)}；使用后分钟：{measurementValue(record.trialMeasurement.assistedMinutes)}；误留候选数：{measurementValue(record.trialMeasurement.falseKeeps)}；漏选候选数：{measurementValue(record.trialMeasurement.missedCandidates)}</p>
        <p>{trialTimeSummary(record.trialMeasurement)}</p>
      </div>}
      <small>{new Date(record.recordedAt).toLocaleString("zh-CN")}</small>
    </div>)}
    {opportunity.status === "validating" && <form className="validation-entry" onSubmit={(event) => { event.preventDefault(); if (parsed.success && !save.isPending) save.mutate(); }}>
      <label htmlFor="validation-method">验证方式</label>
      <select id="validation-method" value={method} onChange={(event) => setMethod(event.target.value as typeof method)}><option value="interview">用户访谈</option><option value="trial">试用</option><option value="payment">付费承诺</option></select>
      <label htmlFor="validation-outcome">结果对假设的影响</label>
      <select id="validation-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}><option value="supports">支持假设</option><option value="refutes">反驳假设</option><option value="inconclusive">尚不确定</option></select>
      {method === "trial" && <>
        <label className="trial-check"><input type="checkbox" checked={includeMeasurement} onChange={(event) => setIncludeMeasurement(event.target.checked)} />记录任务对照数据</label>
        <small>失败、中断或未计时的试用也可以记录。未测量的数值留空，零表示已确认没有。</small>
        {includeMeasurement && <fieldset className="trial-measurement"><legend>任务对照数据</legend>
          <label htmlFor="trial-task">任务描述（不要填写个人身份信息）</label><input id="trial-task" value={task} onChange={(event) => setTask(event.target.value)} minLength={10} maxLength={500} required placeholder="例如：从同一批报价材料中筛选可继续研究的候选" />
          <label>基线方法<input value={baselineMethod} onChange={(event) => setBaselineMethod(event.target.value)} minLength={2} maxLength={300} required placeholder="例如：逐条搜索并人工核对" /></label>
          <label>使用后方法<input value={assistedMethod} onChange={(event) => setAssistedMethod(event.target.value)} minLength={2} maxLength={300} required placeholder="记录使用了什么，以及仍需人工处理的步骤" /></label>
          <label className="trial-check"><input type="checkbox" checked={comparable} onChange={(event) => setComparable(event.target.checked)} />前后任务条件可比</label>
          <label className="trial-check"><input type="checkbox" checked={completed} onChange={(event) => setCompleted(event.target.checked)} />前后任务均已完成</label>
          <label>计时类型<select value={timing} onChange={(event) => setTiming(event.target.value as typeof timing)}><option value="unmeasured">未计时</option><option value="measured">实测</option><option value="estimated">估计</option></select></label>
          <small>耗时填写这一批任务的总分钟数，包含人工复核和纠错。不可比或未完成时不计算收益。</small>
          <div className="trial-number-grid">
            <label>参与任务数<input type="number" min="1" max="1000" step="1" required value={tasks} onChange={(event) => setTasks(event.target.value)} /></label>
            <label>基线分钟<input type="number" min="0" max="100000" step="any" value={baseline} onChange={(event) => setBaseline(event.target.value)} /></label>
            <label>使用后分钟<input type="number" min="0" max="100000" step="any" value={assisted} onChange={(event) => setAssisted(event.target.value)} /></label>
            <label>误留候选数<input type="number" min="0" max="100000" step="1" value={falseKeeps} onChange={(event) => setFalseKeeps(event.target.value)} /></label>
            <label>漏选候选数<input type="number" min="0" max="100000" step="1" value={missed} onChange={(event) => setMissed(event.target.value)} /></label>
          </div>
        </fieldset>}
      </>}
      <label htmlFor="validation-note">外部结果记录</label><textarea id="validation-note" rows={3} minLength={15} maxLength={1200} required value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录实际对象、方法、停止步骤与观察结果；不要填写姓名或联系方式" />
      <button className="button-secondary" type="submit" disabled={!parsed.success || save.isPending}><Check size={14} />记录验证结果</button>
      {includeMeasurement && method === "trial" && !parsed.success && <small className="form-error">请填写任务、前后方法、任务数和观察；数值可留空，填写耗时后需选择实测或估计。</small>}
      {save.isError && <small className="form-error">{save.error.message}</small>}
    </form>}
  </>;
}
