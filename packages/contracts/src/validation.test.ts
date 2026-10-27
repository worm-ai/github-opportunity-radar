import { expect, it } from "vitest";
import { externalValidationSchema, trialMeasurementSchema, trialTimeSummary } from "./validation.js";

const base = { method: "trial", outcome: "inconclusive", note: "试用在任务筛选阶段中断，没有得出可比较的结果。" };
const measurement = {
  taskDescription: "从同一批公开材料中筛选需要继续核查的候选。",
  baselineMethod: "逐条搜索并人工核对来源。",
  assistedMethod: "使用项目雷达筛选后仍需人工复核。",
  comparable: false, bothCompleted: false, timing: "unmeasured" as const, tasksCompared: 1,
  baselineMinutes: null, assistedMinutes: null, falseKeeps: null, missedCandidates: null,
};

it("accepts incomplete trials without converting missing measurements into zero", () => {
  const result = externalValidationSchema.safeParse({ ...base, trialMeasurement: measurement });
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.trialMeasurement).toEqual(measurement);
  expect(trialTimeSummary(measurement)).toContain("任务条件不可比");
  expect(trialTimeSummary({ ...measurement, comparable: true })).toContain("未确认均完成");
});

it("allows qualitative trials and rejects blank-like or contradictory numeric data", () => {
  expect(externalValidationSchema.safeParse(base).success).toBe(true);
  expect(trialMeasurementSchema.safeParse({ ...measurement, baselineMinutes: 0, timing: "unmeasured" }).success).toBe(false);
  expect(trialMeasurementSchema.safeParse({ ...measurement, baselineMinutes: Number.NaN }).success).toBe(false);
  expect(externalValidationSchema.safeParse({ ...base, method: "interview", trialMeasurement: measurement }).success).toBe(false);
});

it("only compares completed, comparable tasks with both times and labels estimates honestly", () => {
  const comparable = { ...measurement, comparable: true, bothCompleted: true, timing: "measured" as const, baselineMinutes: 20, assistedMinutes: 10 };
  expect(trialTimeSummary(comparable)).toContain("实测耗时减少 10 分钟（相对基线 50%）");
  expect(trialTimeSummary({ ...comparable, assistedMinutes: 30 })).toContain("实测耗时增加 10 分钟");
  expect(trialTimeSummary({ ...comparable, baselineMinutes: 0 })).toContain("基线为零，不计算百分比");
  expect(trialTimeSummary({ ...comparable, timing: "estimated" })).toContain("估计耗时减少");
  expect(trialTimeSummary({ ...comparable, assistedMinutes: null })).toContain("未完整记录");
  expect(trialTimeSummary({ ...comparable, assistedMinutes: 20 })).toContain("实测耗时相同");
});
