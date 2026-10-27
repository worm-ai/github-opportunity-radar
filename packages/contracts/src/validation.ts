import { z } from "zod";

const minutes = z.number().finite().min(0).max(100000).nullable();
const count = z.number().int().min(0).max(100000).nullable();

// Null means unmeasured or not applicable. Never turn a blank into zero.
export const trialMeasurementSchema = z.object({
  taskDescription: z.string().trim().min(10).max(500),
  baselineMethod: z.string().trim().min(2).max(300),
  assistedMethod: z.string().trim().min(2).max(300),
  comparable: z.boolean(),
  bothCompleted: z.boolean(),
  timing: z.enum(["measured", "estimated", "unmeasured"]),
  tasksCompared: z.number().int().min(1).max(1000),
  baselineMinutes: minutes,
  assistedMinutes: minutes,
  falseKeeps: count,
  missedCandidates: count,
}).strict().superRefine((value, context) => {
  if (value.timing === "unmeasured" && (value.baselineMinutes !== null || value.assistedMinutes !== null)) {
    context.addIssue({ code: "custom", path: ["timing"], message: "填写耗时后请选择实际计时或估计；未记录的耗时请留空。" });
  }
});

export const externalValidationSchema = z.object({
  method: z.enum(["interview", "trial", "payment"]),
  outcome: z.enum(["supports", "refutes", "inconclusive"]),
  note: z.string().trim().min(15).max(1200),
  trialMeasurement: trialMeasurementSchema.optional(),
}).strict().refine((value) => !value.trialMeasurement || value.method === "trial", {
  path: ["trialMeasurement"], message: "任务对照数据只能附在试用记录中。",
});

export type TrialMeasurement = z.infer<typeof trialMeasurementSchema>;
/** A standalone record of one real task comparison, independent of a research note. */
export type TaskMeasurement = TrialMeasurement & { id: string; createdAt: string; originDemandId: string | null };
export type ExternalValidationInput = z.infer<typeof externalValidationSchema>;
export type ValidationRecord = ExternalValidationInput & { recordedAt: string };

const number = (value: number) => Number(value.toFixed(2)).toString();
export const measurementValue = (value: number | null) => value === null ? "未记录" : number(value);

export function trialTimeSummary(value: TrialMeasurement): string {
  if (!value.comparable) return "任务条件不可比，不计算耗时收益。";
  if (!value.bothCompleted) return "前后任务未确认均完成，不计算耗时收益。";
  if (value.timing === "unmeasured" || value.baselineMinutes === null || value.assistedMinutes === null) return "前后耗时未完整记录，不计算耗时收益。";
  const delta = value.baselineMinutes - value.assistedMinutes;
  const label = value.timing === "estimated" ? "估计耗时" : "实测耗时";
  if (delta === 0) return `${label}相同；样本 ${value.tasksCompared} 项，不代表质量或市场结论。`;
  const percent = value.baselineMinutes > 0 ? `（相对基线 ${number(Math.abs(delta) / value.baselineMinutes * 100)}%）` : "（基线为零，不计算百分比）";
  return `${label}${delta > 0 ? "减少" : "增加"} ${number(Math.abs(delta))} 分钟${percent}；样本 ${value.tasksCompared} 项，质量与市场结论另行判断。`;
}
