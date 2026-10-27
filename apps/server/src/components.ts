import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { extractCapabilities, scoreProject } from "@radar/analysis";
import { createRepositorySignal } from "@radar/contracts";
import { GitHubApiError, repositoryName, type GitHubClient } from "@radar/sensor-github";
import type { RuntimeAdapter } from "@radar/runtime";
import type { RadarStore } from "@radar/storage";

type Dependencies = {
  store: RadarStore;
  runtime: RuntimeAdapter;
  client: () => Pick<GitHubClient, "findRepositories" | "collectRepository">;
  busy: () => boolean;
  collection: (operation: string | null) => void;
};

export function registerComponentRoutes(app: FastifyInstance, dependencies: Dependencies) {
  const { store, runtime } = dependencies;
  app.post<{ Body: unknown }>("/components/search", async (request, reply) => {
    const input = z.object({ query: z.string().trim().min(2).max(256) }).strict().safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: { code: "invalid_component_query", message: "请输入 2～256 字符的 GitHub 搜索条件" } });
    return collect("search", reply, async () => {
      const result = await dependencies.client().findRepositories(input.data.query);
      return { ...result, items: result.items.map((item) => ({ ...item, collected: Boolean(store.getProject(String(item.id))) })) };
    });
  });
  app.post<{ Body: unknown }>("/components/import", async (request, reply) => {
    const input = z.object({ repository: z.string().trim().max(240).transform(repositoryName).refine((name) => name !== null) }).strict().safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: { code: "invalid_repository", message: "请填写 owner/repository 或 GitHub 仓库首页地址" } });
    return collect("import", reply, async () => {
      const repository = await dependencies.client().collectRepository(input.data.repository!);
      const observedAt = new Date().toISOString();
      const signal = createRepositorySignal({ repositoryId: repository.id, ...repository });
      const analysis = scoreProject({ ...repository, id: String(repository.id), observedAt });
      const capabilities = extractCapabilities(repository);
      const existing = Boolean(store.getProject(String(repository.id)));
      store.saveRepository(repository, signal, analysis.score, analysis.reasons, capabilities, observedAt);
      return { id: String(repository.id), fullName: repository.fullName, existing, warning: repository.warning, observedAt };
    });
  });

  async function collect<T>(operation: string, reply: import("fastify").FastifyReply, handler: () => Promise<T>) {
    if (dependencies.busy()) return reply.code(409).send({ error: { code: "job_in_progress", message: "请等待当前采集或分析完成" } });
    if (runtime.mode === "iii" && runtime.engineState !== "connected") return reply.code(503).send({ error: { code: "engine_unavailable", message: "iii Engine 未连接" } });
    dependencies.collection(operation);
    try { return await runtime.run(handler, "collect-evidence"); }
    catch (error) {
      if (!(error instanceof GitHubApiError)) throw error;
      const status = error.code === "rate_limited" ? 429 : error.code === "bad_query" ? 422 : error.code === "not_found" ? 404 : 502;
      return reply.code(status).send({ error: { code: error.code, message: error.message, retryAt: error.retryAt } });
    } finally { dependencies.collection(null); }
  }
}
