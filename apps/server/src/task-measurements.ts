import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RadarStore } from "@radar/storage";
import type { TaskMeasurement } from "@radar/contracts/validation";
import { measurementValue, trialTimeSummary } from "@radar/contracts/validation";

const minutes = z.number().finite().min(0).max(100000).nullable();
const count = z.number().int().min(0).max(100000).nullable();
const taskMeasurementSchema = z.object({
  requestId: z.string().uuid(),
  originDemandId: z.string().uuid().nullable().optional(),
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

function report(measurement: TaskMeasurement) {
  const lines = [
    "# 独立任务对照",
    "",
    `- 编号：${measurement.id}`,
    `- 保存时间：${measurement.createdAt}`,
    `- 原需求研究：${measurement.originDemandId ?? "未绑定"}`,
    "",
    "## 任务",
    "",
    measurement.taskDescription,
    "",
    `- 基线方法：${measurement.baselineMethod}`,
    `- 使用后方法：${measurement.assistedMethod}`,
    `- 条件可比：${measurement.comparable ? "是" : "否"}`,
    `- 前后均完成：${measurement.bothCompleted ? "是" : "否"}`,
    `- 计时方式：${measurement.timing}`,
    `- 对比任务数：${measurement.tasksCompared}`,
    `- 基线分钟：${measurementValue(measurement.baselineMinutes)}`,
    `- 使用后分钟：${measurementValue(measurement.assistedMinutes)}`,
    `- 误留候选：${measurementValue(measurement.falseKeeps)}`,
    `- 漏选候选：${measurementValue(measurement.missedCandidates)}`,
    "",
    `## 解释\n\n${trialTimeSummary(measurement)}`,
    "",
    "这份记录只描述本次任务，不代表普遍省时、正确率、市场需求或付费意愿。",
  ];
  return lines.join("\n");
}

export function registerTaskMeasurementRoutes(app: FastifyInstance, store: RadarStore) {
  app.get("/task-measurements", async () => store.listTaskMeasurements());
  app.get<{ Params: { id: string } }>("/task-measurements/:id/report.md", async (request, reply) => {
    const measurement = store.getTaskMeasurement(request.params.id);
    if (!measurement) return reply.code(404).send({ error: { code: "task_measurement_not_found", message: "任务对照不存在", requestId: request.id } });
    return reply.header("content-disposition", 'attachment; filename="task-measurement.md"').type("text/markdown; charset=utf-8").send(report(measurement));
  });
  app.post("/task-measurements", async (request, reply) => {
    const parsed = taskMeasurementSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_task_measurement", message: "请填写完整的本次任务对照；未记录的耗时请留空", requestId: request.id } });
    const input = parsed.data;
    if (input.originDemandId && !store.getDemandRun(input.originDemandId)) return reply.code(400).send({ error: { code: "unknown_task_measurement_demand", message: "关联的需求研究不存在，请留空或选择当前研究", requestId: request.id } });
    const requestJson = JSON.stringify(input);
    try {
      const existing = store.taskMeasurementForRequest(input.requestId, requestJson);
      if (existing) return existing;
      const measurement: TaskMeasurement = {
        id: randomUUID(), createdAt: new Date().toISOString(), originDemandId: input.originDemandId ?? null,
        taskDescription: input.taskDescription, baselineMethod: input.baselineMethod, assistedMethod: input.assistedMethod,
        comparable: input.comparable, bothCompleted: input.bothCompleted, timing: input.timing, tasksCompared: input.tasksCompared,
        baselineMinutes: input.baselineMinutes, assistedMinutes: input.assistedMinutes, falseKeeps: input.falseKeeps, missedCandidates: input.missedCandidates,
      };
      return reply.code(201).send(store.saveTaskMeasurement(measurement, input.requestId, requestJson));
    } catch (error) {
      if (error instanceof Error && error.message === "task_measurement_request_conflict") return reply.code(409).send({ error: { code: error.message, message: "此请求标识已用于其他任务对照，请重新提交", requestId: request.id } });
      throw error;
    }
  });
}

