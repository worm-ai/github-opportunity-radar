import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createDocumentationSignal } from "@radar/contracts";
import { documentationPath, documentationRef, GitHubApiError, type GitHubClient } from "@radar/sensor-github";
import type { RuntimeAdapter } from "@radar/runtime";
import type { RadarStore } from "@radar/storage";

export function registerDocumentationRoute(app: FastifyInstance, dependencies: {
  store: RadarStore; runtime: RuntimeAdapter; client: () => Pick<GitHubClient, "collectDocumentation">;
  busy: () => boolean; collection: (projectId: string | null) => void;
}) {
  const { store, runtime } = dependencies;
  app.post<{ Params: { id: string }; Body: unknown }>("/projects/:id/documentation", async (request, reply) => {
    const error = (status: number, code: string, message: string) => reply.code(status).send({ error: { code, message, requestId: request.id } });
    const project = store.getProject(request.params.id);
    if (!project) return error(404, "project_not_found", "项目不存在");
    const parsed = z.object({
      paths: z.array(z.string().refine((path) => documentationPath(path) !== null)).max(2).optional(),
      ref: z.string().refine((ref) => documentationRef(ref) !== null).optional(),
    }).strict().safeParse(request.body ?? {});
    if (!parsed.success) return error(400, "invalid_document_request", "最多填写两个同仓库文本文件路径；版本请填写有效 tag、分支或 commit，不能填写网址");
    if (dependencies.busy()) return error(409, "job_in_progress", "请等待当前采集或分析完成");
    if (runtime.mode === "iii" && runtime.engineState !== "connected") return error(503, "engine_unavailable", "iii Engine 未连接");
    dependencies.collection(project.id);
    try {
      return await runtime.run(async () => {
        const report = await dependencies.client().collectDocumentation(project.fullName, parsed.data.paths, parsed.data.ref);
        return store.saveDocumentation(project.id, report, createDocumentationSignal(project.id, project.fullName, report));
      }, "collect-evidence");
    } catch (cause) {
      if (!(cause instanceof GitHubApiError)) throw cause;
      return error(cause.code === "not_found" ? 404 : cause.code === "rate_limited" ? 429 : cause.code === "bad_query" ? 422 : 502, cause.code, cause.message);
    } finally { dependencies.collection(null); }
  });
}
