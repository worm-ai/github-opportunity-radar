import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { RadarStore } from "@radar/storage";

const progressSchema = z.object({
  step: z.string().min(1).max(10000),
  status: z.enum(["pending", "completed", "skipped"]),
  note: z.string().trim().max(1200),
}).strict().refine((value) => value.status === "pending" || value.note.length >= 5, { message: "请记录实际结果或跳过理由（至少 5 个字符）" });

export function registerValidationProgressRoutes(api: FastifyInstance, store: RadarStore) {
  api.put<{ Params: { id: string; index: string } }>("/opportunities/:id/steps/:index", async (request, reply) => {
    const parsed = progressSchema.safeParse(request.body);
    const index = Number(request.params.index);
    if (!parsed.success || !/^\d+$/.test(request.params.index) || !Number.isSafeInteger(index)) return reply.code(400).send({ error: { code: "invalid_validation_progress", message: "请选择步骤状态，并填写实际结果或跳过理由", requestId: request.id } });
    const opportunity = store.getOpportunity(request.params.id);
    if (!opportunity) return reply.code(404).send({ error: { code: "opportunity_not_found", message: "机会不存在", requestId: request.id } });
    if (opportunity.validationSteps[index] !== parsed.data.step) return reply.code(409).send({ error: { code: "validation_step_changed", message: "验证步骤已变化，请刷新页面后重新核对", requestId: request.id } });
    return store.updateValidationStep(request.params.id, index, parsed.data.status, parsed.data.note);
  });
}
