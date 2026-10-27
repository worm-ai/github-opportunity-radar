import type { FastifyInstance } from "fastify";
import type { RadarStore } from "@radar/storage";
import { externalValidationSchema } from "@radar/contracts/validation";

export function registerExternalValidationRoutes(api: FastifyInstance, store: RadarStore) {
  api.post<{ Params: { id: string } }>("/opportunities/:id/validation", async (request, reply) => {
    const parsed = externalValidationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_validation", message: parsed.error.issues[0]?.message ?? "请填写验证方式、结果和实际观察。", requestId: request.id } });
    const opportunity = store.recordExternalValidation(request.params.id, parsed.data);
    if (!opportunity) return reply.code(404).send({ error: { code: "opportunity_not_found", message: "机会不存在", requestId: request.id } });
    return opportunity;
  });
}
