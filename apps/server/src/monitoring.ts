import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { extractCapabilities, scoreProject } from "@radar/analysis";
import { createRepositorySignal, createIssueContextSignal } from "@radar/contracts";
import { GitHubApiError, type GitHubClient } from "@radar/sensor-github";
import type { RuntimeAdapter } from "@radar/runtime";
import type { RadarStore, MonitorChanges } from "@radar/storage";

type Dependencies = {
  store: RadarStore; runtime: RuntimeAdapter;
  client: () => Pick<GitHubClient, "collectRepository" | "collectIssueContext">;
  busy: () => boolean; collection: (operation: string | null, projectId?: string | null) => void;
  now?: () => Date; scheduled?: boolean;
};
const limit = 20, batchLimit = 2, pollMs = 60_000;
export function registerMonitoringRoutes(app: FastifyInstance, dependencies: Dependencies) {
  const { store, runtime } = dependencies, now = () => (dependencies.now?.() ?? new Date()).toISOString();
  store.recoverInterruptedMonitors(now());
  let closed = false, timer: NodeJS.Timeout | null = null, inFlight: Promise<unknown> | null = null;
  const later = (time: string, hours: number) => new Date(Date.parse(time) + hours * 3_600_000).toISOString();
  const error = (reply: FastifyReply, status: number, code: string, message: string, retryAt?: string | null) => reply.code(status).send({ error: { code, message, ...(retryAt ? { retryAt } : {}) } });
  function unavailable(reply?: FastifyReply) {
    if (dependencies.busy()) return reply ? error(reply, 409, "job_in_progress", "请等待当前采集或分析完成") : true;
    if (runtime.mode === "iii" && runtime.engineState !== "connected") return reply ? error(reply, 503, "engine_unavailable", "iii Engine 未连接") : true;
    const pause = store.monitoringPausedUntil(now());
    if (pause) return reply ? error(reply, 429, "rate_limited", "GitHub 限流中，关注刷新将在配额恢复后重试", pause) : true;
    return null;
  }
  async function refresh(id: string) {
    const before = store.getProject(id)!;
    const wasEnabled = store.getProjectMonitor(id)?.enabled ?? false;
    const startedAt = now();
    store.beginMonitorAttempt(id, startedAt, later(startedAt, store.getSettings().scanIntervalHours));
    let changes: MonitorChanges | undefined;
    try {
      const warnings: string[] = [];
      await runtime.run(async () => {
        const repository = await dependencies.client().collectRepository(before.fullName);
        if (String(repository.id) !== id) throw new GitHubApiError("仓库地址对应的项目身份已变化，拒绝覆盖原资料", "upstream_error");
        const observedAt = now(), score = scoreProject({ ...repository, id, observedAt });
        store.saveRepository(repository, createRepositorySignal({ repositoryId: repository.id, ...repository }), score.score, score.reasons, extractCapabilities(repository), observedAt);
        const after = store.getProject(id)!;
        if (repository.warning) warnings.push(repository.warning);
        changes = { stars: after.stars - before.stars, releaseBefore: before.releaseTag, releaseAfter: after.releaseTag, readmeChanged: before.readmeExcerpt !== after.readmeExcerpt };
      }, "collect-evidence");
      const monitor = store.getProjectMonitor(id)!;
      for (const watched of monitor.issues) {
        // Manual refresh can check a configured discussion while automatic monitoring is off.
        // Cancelling an active subscription stops its remaining work at the next network boundary.
        const latest = store.getProjectMonitor(id)!;
        if (closed || (wasEnabled && !latest.enabled)) break;
        if (!latest.issues.some((item) => item.id === watched.id)) continue;
        try {
          await runtime.run(async () => {
            const context = { ...await dependencies.client().collectIssueContext(before.fullName, watched.number, { throwOnRateLimit: true }), selectedForResearch: true };
            if (context.issue.number !== watched.number) throw new GitHubApiError("讨论编号与关注项不一致", "upstream_error");
            store.saveIssueContext(id, context, createIssueContextSignal(id, before.fullName, context));
            store.recordMonitoredIssueCheck(id, watched.id, now(), { context });
            const result = store.getProjectMonitor(id)?.issues.find((item) => item.id === watched.id);
            if (result?.error) warnings.push(`#${watched.number}: ${result.error}`);
          }, "collect-evidence");
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "讨论核查失败";
          store.recordMonitoredIssueCheck(id, watched.id, now(), { error: message });
          if (cause instanceof GitHubApiError && cause.code === "rate_limited") throw cause;
          warnings.push(`#${watched.number}: ${message}`);
        }
      }
      const warning = warnings.join("; ") || null, finishedAt = now();
      store.finishMonitorAttempt(id, { status: warning ? "partial" : "succeeded", finishedAt, nextDueAt: later(finishedAt, warning ? Math.min(1, store.getSettings().scanIntervalHours) : store.getSettings().scanIntervalHours), warning, ...(changes ? { changes } : {}) });
      return { http: 200, monitor: store.getProjectMonitor(id)! };
    } catch (cause) {
      const finishedAt = now(), upstream = cause instanceof GitHubApiError ? cause : null;
      const retry = upstream?.retryAt && Date.parse(upstream.retryAt) > Date.parse(finishedAt) ? upstream.retryAt : later(finishedAt, 1);
      const code = upstream?.code ?? "refresh_failed", message = upstream?.message ?? "仓库刷新失败，既有资料保留";
      const monitor = store.finishMonitorAttempt(id, { status: "failed", finishedAt, nextDueAt: retry, error: message, errorCode: code, ...(changes ? { changes } : {}) });
      return { http: code === "rate_limited" ? 429 : code === "not_found" ? 404 : 502, monitor };
    }
  }
  async function runDue() {
    if (closed || unavailable()) return { attempted: 0 };
    const due = store.dueProjectMonitors(now(), batchLimit);
    if (!due.length) return { attempted: 0 };
    dependencies.collection("monitor_refresh");
    let attempted = 0;
    try {
      for (const item of due) {
        if (closed) break;
        if (!store.getProjectMonitor(item.projectId)?.enabled) continue;
        const result = await refresh(item.projectId); attempted += 1;
        if (result.http === 429) break;
      }
      return { attempted };
    } finally { dependencies.collection(null); }
  }
  function schedule(delay = pollMs) {
    if (inFlight) return;
    if (timer) clearTimeout(timer);
    if (closed || dependencies.scheduled === false) return;
    timer = setTimeout(() => {
      inFlight = runDue().catch((cause: unknown) => app.log.error({ err: cause }, "Followed project refresh failed"));
      void inFlight.finally(() => { inFlight = null; schedule(); });
    }, delay);
    timer.unref();
  }
  app.get("/monitoring", async () => ({ limit, batchLimit, issueLimit: 3, intervalHours: store.getSettings().scanIntervalHours, pausedUntil: store.monitoringPausedUntil(now()), items: store.listProjectMonitors(), discussionChanges: store.listMonitorIssueChanges() }));
  app.get<{ Params: { id: string } }>("/projects/:id/monitor", async (request, reply) => {
    if (!store.getProject(request.params.id)) return error(reply, 404, "project_not_found", "项目不存在");
    return store.getProjectMonitor(request.params.id) ?? { projectId: request.params.id, enabled: false, status: "idle" };
  });
  app.put<{ Params: { id: string }; Body: unknown }>("/projects/:id/monitor", async (request, reply) => {
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "invalid_monitor", "请明确指定是否持续关注");
    try { const monitor = store.setProjectMonitor(request.params.id, parsed.data.enabled, now(), limit); schedule(1_000); return monitor; }
    catch (cause) {
      if (cause instanceof Error && cause.message === "unknown_monitor_project") return error(reply, 404, "project_not_found", "项目不存在");
      if (cause instanceof Error && cause.message === "monitor_limit") return error(reply, 409, "monitor_limit", `最多持续关注 ${limit} 个项目，请先取消其他关注`);
      throw cause;
    }
  });
  app.put<{ Params: { id: string; number: string }; Body: unknown }>("/projects/:id/monitor/issues/:number", async (request, reply) => {
    const number = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).safeParse(request.params.number);
    const body = z.object({ enabled: z.boolean() }).strict().safeParse(request.body);
    if (!number.success || !body.success) return error(reply, 400, "invalid_issue_monitor", "请指定有效讨论编号及是否跟进");
    try { const result = store.setMonitoredIssue(request.params.id, number.data, body.data.enabled, now()); schedule(1_000); return result; }
    catch (cause) {
      if (cause instanceof Error && cause.message === "unknown_monitor_project") return error(reply, 404, cause.message, "项目不存在");
      if (cause instanceof Error && cause.message === "unknown_monitor_issue") return error(reply, 400, cause.message, "请先按编号收录这条讨论");
      if (cause instanceof Error && cause.message === "monitor_issue_limit") return error(reply, 409, cause.message, "每个项目最多跟进三条讨论，请先取消其他条目");
      throw cause;
    }
  });
  app.post<{ Params: { id: string; number: string }; Body: unknown }>("/projects/:id/monitor/issues/:number/acknowledge", async (request, reply) => {
    const number = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).safeParse(request.params.number);
    const body = z.object({ changeId: z.string().uuid() }).strict().safeParse(request.body);
    if (!number.success || !body.success) return error(reply, 400, "invalid_change_acknowledgement", "请确认当前这次变化");
    try { return store.acknowledgeMonitoredIssue(request.params.id, number.data, body.data.changeId); }
    catch (cause) {
      if (cause instanceof Error && cause.message === "unknown_monitor_issue") return error(reply, 404, cause.message, "未跟进这条讨论");
      if (cause instanceof Error && cause.message === "monitor_change_conflict") return error(reply, 409, cause.message, "讨论又有新变化，请刷新并核对后确认");
      throw cause;
    }
  });
  app.post<{ Params: { id: string }; Body: unknown }>("/projects/:id/refresh", async (request, reply) => {
    if (!z.object({}).strict().safeParse(request.body).success) return error(reply, 400, "invalid_refresh", "刷新请求只接受空对象");
    if (!store.getProject(request.params.id)) return error(reply, 404, "project_not_found", "项目不存在");
    const blocked = unavailable(reply); if (blocked) return blocked;
    dependencies.collection("monitor_refresh", request.params.id);
    try { const result = await refresh(request.params.id); return reply.code(result.http).send(result.http === 200 ? result.monitor : { error: { code: result.monitor.errorCode, message: result.monitor.error, retryAt: result.monitor.nextDueAt } }); }
    finally { dependencies.collection(null); }
  });
  app.addHook("onReady", async () => schedule(1_000));
  async function stop() { closed = true; if (timer) clearTimeout(timer); await inFlight; }
  return { runDue, stop };
}
