import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createIssueContextSignal } from "@radar/contracts";
import { GitHubApiError, type GitHubClient } from "@radar/sensor-github";
import type { RuntimeAdapter } from "@radar/runtime";
import type { RadarStore } from "@radar/storage";

export function selectedIssueNumber(input: string | number, fullName: string): number | null {
  let value = String(input).trim().replace(/^#/, "");
  if (!/^\d+$/.test(value)) {
    try {
      const url = new URL(value);
      const match = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/.exec(url.pathname);
      if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || !match || `${match[1]}/${match[2]}`.toLowerCase() !== fullName.toLowerCase()) return null;
      value = match[3]!;
    } catch { return null; }
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function registerIssueContextRoute(app: FastifyInstance, dependencies: {
  store: RadarStore; runtime: RuntimeAdapter; client: () => Pick<GitHubClient, "collectIssueContext">;
  busy: () => boolean; collection: (operation: string | null) => void;
}) {
  const { store, runtime } = dependencies;
  app.post<{ Params: { id: string }; Body: unknown }>("/projects/:id/issues/import", async (request, reply) => {
    const parsed = z.object({ issue: z.union([z.string().trim().min(1).max(300), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]) }).strict().safeParse(request.body);
    const project = store.getProject(request.params.id);
    const error = (status: number, code: string, message: string) => reply.code(status).send({ error: { code, message, requestId: request.id } });
    if (!parsed.success) return error(400, "invalid_issue_selection", "请输入 Issue 编号或当前仓库的 GitHub Issue 地址");
    if (!project) return error(404, "project_not_found", "项目不存在");
    const number = selectedIssueNumber(parsed.data.issue, project.fullName);
    if (!number) return error(400, "invalid_issue_selection", "仅支持正整数编号或当前仓库的 https://github.com/owner/repo/issues/编号 地址");
    if (dependencies.busy()) return error(409, "job_in_progress", "请等待当前采集或分析完成");
    if (runtime.mode === "iii" && runtime.engineState !== "connected") return error(503, "engine_unavailable", "iii Engine 未连接");
    dependencies.collection(`issue:${project.id}:${number}`);
    try {
      return await runtime.run(async () => {
        const context = { ...await dependencies.client().collectIssueContext(project.fullName, number), selectedForResearch: true };
        return store.saveIssueContext(project.id, context, createIssueContextSignal(project.id, project.fullName, context));
      }, "collect-evidence");
    } catch (cause) {
      if (!(cause instanceof GitHubApiError)) throw cause;
      return error(cause.code === "not_found" ? 404 : cause.code === "rate_limited" ? 429 : cause.code === "bad_query" ? 422 : 502, cause.code, cause.message);
    } finally { dependencies.collection(null); }
  });
  app.post<{ Params: { id: string; number: string }; Body: unknown }>("/projects/:id/issues/:number/context", async (request, reply) => {
    const number = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).safeParse(request.params.number);
    const project = store.getProject(request.params.id);
    const error = (status: number, code: string, message: string) => reply.code(status).send({ error: { code, message, requestId: request.id } });
    if (!number.success || !z.object({}).strict().safeParse(request.body ?? {}).success) return error(400, "invalid_issue_request", "请使用有效 Issue 编号和空请求体");
    if (!project) return error(404, "project_not_found", "项目不存在");
    if (!project.issues?.some((issue) => issue.number === number.data)) return error(400, "unknown_origin_issue", "请从已采集的 Issue 样本中选择讨论");
    if (dependencies.busy()) return error(409, "job_in_progress", "请等待当前采集或分析完成");
    if (runtime.mode === "iii" && runtime.engineState !== "connected") return error(503, "engine_unavailable", "iii Engine 未连接");
    dependencies.collection(`issue:${project.id}:${number.data}`);
    try {
      return await runtime.run(async () => {
        const context = await dependencies.client().collectIssueContext(project.fullName, number.data);
        return store.saveIssueContext(project.id, context, createIssueContextSignal(project.id, project.fullName, context));
      }, "collect-evidence");
    } catch (cause) {
      if (!(cause instanceof GitHubApiError)) throw cause;
      return error(cause.code === "not_found" ? 404 : cause.code === "rate_limited" ? 429 : cause.code === "bad_query" ? 422 : 502, cause.code, cause.message);
    } finally { dependencies.collection(null); }
  });
}
