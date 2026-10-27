import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEMAND_VERSION, demandInputSchema, researchDemand, validateDemandEvaluationResume, validateDemandGapResume, validateDemandSelectionResume, researchDemandSources, sourceStudyInputSchema, validateSourceStudyParent, validateSourceStudyResume, scoreProject, extractCapabilities, type CompletionTransport } from "@radar/analysis";
import { createRepositorySignal } from "@radar/contracts";
import { GitHubApiError, type GitHubClient } from "@radar/sensor-github";
import type { RadarStore } from "@radar/storage";
import type { RuntimeAdapter } from "@radar/runtime";

type Dependencies = {
  store: RadarStore; runtime: RuntimeAdapter; transport: CompletionTransport | null; missingMessage: string;
  client: () => Pick<GitHubClient, "checkSearchAccess" | "findRepositories" | "collectRepository"> & Partial<Pick<GitHubClient, "sourceInventory" | "sourceText">>;
  busy: () => boolean; reserve: (runId: string | null) => void;
};
export function registerDemandRoutes(app: FastifyInstance, dependencies: Dependencies) {
  const { store, runtime, transport } = dependencies;
  const running = new Set<Promise<void>>();
  app.get("/demands/features", async () => ({ sourceStudy: true, sourceResume: true, evaluationResume: true, fallbackEvaluationResume: true, gapResume: true, selectionResume: true, researchNotes: true, researchVersion: DEMAND_VERSION }));
  app.addHook("onClose", async () => {
    // A pending preflight may hand off to research while shutdown is waiting.
    while (running.size) await Promise.allSettled([...running]);
  });
  app.get("/demands", async () => {
    // The homepage needs to distinguish a merely recent partial scan from a
    // study that already has a durable, reviewable decision. Keep this as a
    // summary field so the list route never exposes snapshots or source text.
    const activeNoteCounts = new Map<string, number>();
    for (const note of store.listResearchNotes()) {
      if (note.originDemandId && !note.supersededBy) activeNoteCounts.set(note.originDemandId, (activeNoteCounts.get(note.originDemandId) ?? 0) + 1);
    }
    return store.listDemandRuns().map(({ snapshot, ...run }) => ({ ...run, stage: snapshot?.stage ?? null, outcome: snapshot?.outcome ?? null, researchNoteCount: activeNoteCounts.get(run.id) ?? 0 }));
  });
  app.get<{ Params: { id: string } }>("/demands/:id", async (request, reply) => {
    const run = store.getDemandRun(request.params.id);
    return run ?? reply.code(404).send({ error: { code: "demand_not_found", message: "研究任务不存在" } });
  });
  app.get<{ Params: { id: string } }>("/demands/:id/report.json", async (request, reply) => {
    const run = store.getDemandRun(request.params.id);
    if (!run) return reply.code(404).send({ error: { code: "demand_not_found", message: "研究任务不存在" } });
    return reply.header("content-disposition", 'attachment; filename="implementation-research.json"').send(run);
  });
  app.post("/demands", async (request, reply) => {
    const parsed = demandInputSchema.extend({ requestId: z.string().uuid(), retryOf: z.string().uuid().nullable().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_demand", message: "请填写 12～4000 字符的可读需求和有效请求标识" } });
    const { question, requestId } = parsed.data, retryOf = parsed.data.retryOf ?? null;
    let previous;
    try { previous = store.demandRunForRequest(requestId, question, retryOf); }
    catch { return reply.code(409).send({ error: { code: "demand_request_conflict", message: "此请求标识已用于其他需求，请重新提交" } }); }
    if (previous?.snapshot?.evaluationResume || previous?.snapshot?.selectionResume) return reply.code(409).send({ error: { code: "demand_request_conflict", message: "此请求标识已用于恢复研究，请重新提交" } });
    if (previous) return reply.code(previous.status === "running" ? 202 : 200).send(previous);
    const duplicate = store.listDemandRuns(100).find(run => run.status === "running" && !run.continuationOf && run.question === question);
    if (duplicate) return reply.code(202).send(duplicate);
    if (retryOf && !store.getDemandRun(retryOf)) return reply.code(404).send({ error: { code: "demand_not_found", message: "原研究任务不存在" } });
    if (!transport) return reply.code(503).send({ error: { code: "model_unavailable", message: dependencies.missingMessage } });
    if (dependencies.busy()) return reply.code(409).send({ error: { code: "job_in_progress", message: "请等待当前采集或分析完成" } });
    if (runtime.mode === "iii" && runtime.engineState !== "connected") return reply.code(503).send({ error: { code: "engine_unavailable", message: "iii Engine 未连接，尚未开始研究" } });
    const client = dependencies.client();
    // Reserve before the first await so preflight cannot race another collector.
    // No durable study or model invocation exists until this gate succeeds.
    dependencies.reserve(requestId);
    const checking = Promise.resolve().then(() => runtime.run(() => client.checkSearchAccess(), "collect-evidence"));
    running.add(checking);
    try {
      await checking;
    } catch (error) {
      dependencies.reserve(null);
      const certificate = error instanceof GitHubApiError && error.message.startsWith("GitHub certificate verification failed (");
      const limited = error instanceof GitHubApiError && error.code === "rate_limited";
      const reason = certificate ? "GitHub 的 HTTPS 证书校验失败。请检查网络证书与系统时间；如企业代理需要额外信任链，请让管理员通过可信渠道提供 PEM CA bundle 并设置 RADAR_GITHUB_CA_FILE，同时保留证书校验。不要使用失败连接中的叶证书，也不要关闭 TLS 校验。" : limited ? "GitHub 请求额度暂不可用，请稍后重试。" : "暂时无法确认 GitHub 搜索可用，请检查网络连接后重试。";
      return reply.code(503).send({ error: { code: "github_preflight_failed", message: `${reason}尚未创建研究任务或调用模型，你的需求可以保留后重新提交。`, retryAt: limited ? error.retryAt : null } });
    } finally { running.delete(checking); }
    const run = store.createDemandRun(requestId, question, retryOf);
    dependencies.reserve(run.id);
    // Keep the durable orchestration local; route individual bounded IO stages through iii.
    // A multi-stage study must not outlive one 90-second collection invocation.
    const work = researchDemand(question, {
      transport: { provider: transport.provider, model: transport.model, complete: (system, input, schema) => runtime.run(() => transport.complete(system, input, schema), "analyze-opportunities") },
      search: query => runtime.run(() => client.findRepositories(query), "collect-evidence"),
      collect: fullName => runtime.run(async () => {
        const repository = await client.collectRepository(fullName);
        const observedAt = new Date().toISOString();
        const project = { ...repository, id: String(repository.id), observedAt };
        const score = scoreProject(project);
        store.saveRepository(repository, createRepositorySignal({ repositoryId: repository.id, ...repository }), score.score, score.reasons, extractCapabilities(project), observedAt);
        // Use this acquisition, not possibly retained older fields, as current evidence.
        return project;
      }, "collect-evidence"),
      checkpoint: snapshot => { store.checkpointDemandRun(run.id, snapshot); },
    }).then(() => undefined).catch(error => {
      store.failDemandRun(run.id, error instanceof Error ? error.message : "研究执行失败");
      app.log.error({ err: error, demandId: run.id }, "Demand research failed");
    }).finally(() => { dependencies.reserve(null); running.delete(work); });
    running.add(work);
    return reply.code(202).send(store.getDemandRun(run.id));
  });
  app.post<{ Params: { id: string } }>("/demands/:id/resume-evaluation", async (request, reply) => {
    const parsed = z.object({ requestId: z.string().uuid() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_evaluation_resume", message: "请提供有效请求标识；恢复评估不能修改原需求和范围" } });
    const saved = store.getDemandRun(request.params.id);
    if (!saved) return reply.code(404).send({ error: { code: "demand_not_found", message: "待恢复的研究不存在" } });
    const snapshot = saved.snapshot ? { ...saved.snapshot, status: saved.status === "interrupted" ? "failed" as const : saved.status } : null;
    try {
      if (!snapshot || saved.continuationOf || !["failed", "interrupted", "partial"].includes(saved.status) || snapshot.question !== saved.question) throw new Error("请选择已采材料且评估失败、中断或模型降级的需求研究");
      validateDemandEvaluationResume(snapshot);
    } catch (error) { return reply.code(400).send({ error: { code: "invalid_evaluation_resume", message: error instanceof Error ? error.message : "已存材料不可恢复" } }); }
    let previous;
    try {
      previous = store.demandRunForRequest(parsed.data.requestId, saved.question, saved.id);
      if (previous && previous.snapshot?.evaluationResume?.fromRunId !== saved.id) throw new Error("different_action");
    } catch { return reply.code(409).send({ error: { code: "demand_request_conflict", message: "此请求标识已用于其他操作" } }); }
    if (previous) return reply.code(previous.status === "running" ? 202 : 200).send(previous);
    const duplicate = store.listDemandRuns(100).find(run => run.status === "running" && !run.continuationOf && run.retryOf === saved.id && run.snapshot?.evaluationResume?.fromRunId === saved.id);
    if (duplicate) return reply.code(202).send(duplicate);
    if (!transport) return reply.code(503).send({ error: { code: "model_unavailable", message: dependencies.missingMessage } });
    if (dependencies.busy()) return reply.code(409).send({ error: { code: "job_in_progress", message: "请等待当前采集或分析完成" } });
    if (runtime.mode === "iii" && runtime.engineState !== "connected") return reply.code(503).send({ error: { code: "engine_unavailable", message: "iii Engine 未连接，尚未恢复评估" } });
    const client = dependencies.client();
    const run = store.createDemandRun(parsed.data.requestId, saved.question, saved.id);
    dependencies.reserve(run.id);
    const work = researchDemand(saved.question, {
      transport: { provider: transport.provider, model: transport.model, complete: (system, data, schema) => runtime.run(() => transport.complete(system, data, schema), "analyze-opportunities") },
      // Evaluation recovery is a durable checkpoint. If the recovered model
      // identifies an explicit gap, continue with the normal bounded GitHub
      // search and collection stages before the final review.
      search: query => runtime.run(() => client.findRepositories(query), "collect-evidence"),
      collect: fullName => runtime.run(async () => {
        const repository = await client.collectRepository(fullName);
        const observedAt = new Date().toISOString();
        const project = { ...repository, id: String(repository.id), observedAt };
        const score = scoreProject(project);
        store.saveRepository(repository, createRepositorySignal({ repositoryId: repository.id, ...repository }), score.score, score.reasons, extractCapabilities(project), observedAt);
        return project;
      }, "collect-evidence"),
      reuse: { runId: saved.id, snapshot }, checkpoint: state => { store.checkpointDemandRun(run.id, state); },
    }).then(() => undefined).catch(error => {
      store.failDemandRun(run.id, error instanceof Error ? error.message : "恢复评估失败");
      app.log.error({ err: error, demandId: run.id }, "Demand evaluation resume failed");
    }).finally(() => { dependencies.reserve(null); running.delete(work); });
    running.add(work);
    return reply.code(202).send(store.getDemandRun(run.id));
  });
  app.post<{ Params: { id: string } }>("/demands/:id/resume-gaps", async (request, reply) => {
    const parsed = z.object({ requestId: z.string().uuid() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_gap_resume", message: "请提供有效请求标识；补搜续跑不能修改原需求和范围" } });
    const saved = store.getDemandRun(request.params.id);
    if (!saved) return reply.code(404).send({ error: { code: "demand_not_found", message: "待续跑的研究不存在" } });
    try {
      if (!saved.snapshot || saved.continuationOf || saved.question !== saved.snapshot.question) throw new Error("缺少可续跑的原始需求材料");
      validateDemandGapResume(saved.snapshot);
    } catch (error) { return reply.code(400).send({ error: { code: "invalid_gap_resume", message: error instanceof Error ? error.message : "已存材料不可续跑" } }); }
    let previous;
    try {
      previous = store.demandRunForRequest(parsed.data.requestId, saved.question, saved.id);
      if (previous && previous.snapshot?.gapResume?.fromRunId !== saved.id) throw new Error("different_action");
    } catch { return reply.code(409).send({ error: { code: "demand_request_conflict", message: "此请求标识已用于其他操作" } }); }
    if (previous) return reply.code(previous.status === "running" ? 202 : 200).send(previous);
    const duplicate = store.listDemandRuns(100).find(run => run.status === "running" && run.retryOf === saved.id && run.snapshot?.gapResume?.fromRunId === saved.id);
    if (duplicate) return reply.code(202).send(duplicate);
    if (!transport) return reply.code(503).send({ error: { code: "model_unavailable", message: dependencies.missingMessage } });
    if (dependencies.busy()) return reply.code(409).send({ error: { code: "job_in_progress", message: "请等待当前采集或分析完成" } });
    if (runtime.mode === "iii" && runtime.engineState !== "connected") return reply.code(503).send({ error: { code: "engine_unavailable", message: "iii Engine 未连接，尚未开始补搜" } });
    const client = dependencies.client();
    const run = store.createDemandRun(parsed.data.requestId, saved.question, saved.id);
    dependencies.reserve(run.id);
    const work = researchDemand(saved.question, {
      transport: { provider: transport.provider, model: transport.model, complete: (system, data, schema) => runtime.run(() => transport.complete(system, data, schema), "analyze-opportunities") },
      search: query => runtime.run(() => client.findRepositories(query), "collect-evidence"),
      collect: fullName => runtime.run(async () => {
        const repository = await client.collectRepository(fullName);
        const observedAt = new Date().toISOString();
        const project = { ...repository, id: String(repository.id), observedAt };
        const score = scoreProject(project);
        store.saveRepository(repository, createRepositorySignal({ repositoryId: repository.id, ...repository }), score.score, score.reasons, extractCapabilities(project), observedAt);
        return project;
      }, "collect-evidence"),
      resumeGaps: { runId: saved.id, snapshot: saved.snapshot! }, checkpoint: state => { store.checkpointDemandRun(run.id, state); },
    }).then(() => undefined).catch(error => {
      store.failDemandRun(run.id, error instanceof Error ? error.message : "缺口补搜续跑失败");
      app.log.error({ err: error, demandId: run.id }, "Demand gap resume failed");
    }).finally(() => { dependencies.reserve(null); running.delete(work); });
    running.add(work);
    return reply.code(202).send(store.getDemandRun(run.id));
  });
  app.post<{ Params: { id: string } }>("/demands/:id/resume-selection", async (request, reply) => {
    const parsed = z.object({ requestId: z.string().uuid() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_selection_resume", message: "请提供有效请求标识；恢复筛选不能修改原需求" } });
    const saved = store.getDemandRun(request.params.id);
    if (!saved) return reply.code(404).send({ error: { code: "demand_not_found", message: "待恢复的研究不存在" } });
    const snapshot = saved.snapshot ? { ...saved.snapshot, status: saved.status === "interrupted" ? "failed" as const : saved.status } : null;
    try {
      if (!snapshot || saved.continuationOf || !["failed", "interrupted"].includes(saved.status) || snapshot.question !== saved.question) throw new Error("请选择候选筛选失败且计划和搜索预览已保存的需求研究");
      validateDemandSelectionResume(snapshot);
    } catch (error) { return reply.code(400).send({ error: { code: "invalid_selection_resume", message: error instanceof Error ? error.message : "已存材料不可恢复" } }); }
    let previous;
    try {
      previous = store.demandRunForRequest(parsed.data.requestId, saved.question, saved.id);
      if (previous && previous.snapshot?.selectionResume?.fromRunId !== saved.id) throw new Error("different_action");
    } catch { return reply.code(409).send({ error: { code: "demand_request_conflict", message: "此请求标识已用于其他操作" } }); }
    if (previous) return reply.code(previous.status === "running" ? 202 : 200).send(previous);
    const duplicate = store.listDemandRuns(100).find(run => run.status === "running" && !run.continuationOf && run.retryOf === saved.id && run.snapshot?.selectionResume?.fromRunId === saved.id);
    if (duplicate) return reply.code(202).send(duplicate);
    if (!transport) return reply.code(503).send({ error: { code: "model_unavailable", message: dependencies.missingMessage } });
    if (dependencies.busy()) return reply.code(409).send({ error: { code: "job_in_progress", message: "请等待当前采集或分析完成" } });
    if (runtime.mode === "iii" && runtime.engineState !== "connected") return reply.code(503).send({ error: { code: "engine_unavailable", message: "iii Engine 未连接，尚未恢复候选筛选" } });
    const client = dependencies.client();
    const run = store.createDemandRun(parsed.data.requestId, saved.question, saved.id);
    dependencies.reserve(run.id);
    const work = researchDemand(saved.question, {
      transport: { provider: transport.provider, model: transport.model, complete: (system, data, schema) => runtime.run(() => transport.complete(system, data, schema), "analyze-opportunities") },
      search: async () => { throw new Error("恢复候选筛选禁止重新搜索"); },
      collect: fullName => runtime.run(async () => {
        const repository = await client.collectRepository(fullName);
        const observedAt = new Date().toISOString();
        const project = { ...repository, id: String(repository.id), observedAt };
        const score = scoreProject(project);
        store.saveRepository(repository, createRepositorySignal({ repositoryId: repository.id, ...repository }), score.score, score.reasons, extractCapabilities(project), observedAt);
        return project;
      }, "collect-evidence"),
      resumeSelection: { runId: saved.id, snapshot }, checkpoint: state => { store.checkpointDemandRun(run.id, state); },
    }).then(() => undefined).catch(error => {
      store.failDemandRun(run.id, error instanceof Error ? error.message : "恢复候选筛选失败");
      app.log.error({ err: error, demandId: run.id }, "Demand selection resume failed");
    }).finally(() => { dependencies.reserve(null); running.delete(work); });
    running.add(work);
    return reply.code(202).send(store.getDemandRun(run.id));
  });
  app.post<{ Params: { id: string } }>("/demands/:id/continue", async (request, reply) => {
    const parsed = sourceStudyInputSchema.extend({ requestId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_source_study", message: "请选择 1～2 个候选及 1～3 项能力" } });
    const { requestId, ...input } = parsed.data;
    let previous;
    try { previous = store.sourceDemandForRequest(requestId, request.params.id, input); }
    catch { return reply.code(409).send({ error: { code: "demand_request_conflict", message: "此请求标识已用于其他研究" } }); }
    if (previous) return reply.code(previous.status === "running" ? 202 : 200).send(previous);
    const parent = store.getDemandRun(request.params.id);
    if (!parent) return reply.code(404).send({ error: { code: "demand_not_found", message: "原研究任务不存在" } });
    // Recovery terminates the durable run while preserving its last in-flight snapshot verbatim.
    const sourceParent = parent.snapshot ? { ...parent.snapshot, status: parent.status === "interrupted" ? "partial" as const : parent.status } : null;
    try {
      if (parent.status === "running" || parent.continuationOf || !parent.snapshot) throw new Error("请选择已有需求拆解与候选的原始终态任务");
      validateSourceStudyParent(sourceParent!, input);
    } catch (error) { return reply.code(400).send({ error: { code: "invalid_source_parent", message: error instanceof Error ? error.message : "原任务不可续研" } }); }
    const duplicate = store.listDemandRuns(100).find(run => run.status === "running" && !run.retryOf && run.continuationOf === parent.id && JSON.stringify(run.continuationInput) === JSON.stringify({ projectIds: [...input.projectIds].sort(), capabilityIds: [...input.capabilityIds].sort() }));
    if (duplicate) return reply.code(202).send(duplicate);
    if (!transport) return reply.code(503).send({ error: { code: "model_unavailable", message: dependencies.missingMessage } });
    if (dependencies.busy()) return reply.code(409).send({ error: { code: "job_in_progress", message: "请等待当前采集或分析完成" } });
    if (runtime.mode === "iii" && runtime.engineState !== "connected") return reply.code(503).send({ error: { code: "engine_unavailable", message: "iii Engine 未连接，尚未开始续研" } });
    const client = dependencies.client();
    if (!client.sourceInventory || !client.sourceText) return reply.code(503).send({ error: { code: "source_unavailable", message: "当前采集通道不支持源码续研" } });
    const previouslyRead = store.listDemandRuns(100).filter(candidate => candidate.continuationOf === parent.id && candidate.snapshot?.sourceStudy)
      .flatMap(candidate => candidate.snapshot!.sourceStudy!.inventories.flatMap(item => {
        const ranges = candidate.snapshot!.sources.filter(source => source.field === "code" && source.projectId === item.projectId
          && source.commitSha === item.inventory?.commitSha && source.path !== null
          && candidate.snapshot!.sourceStudy!.files.some(file => file.projectId === item.projectId && file.path === source.path && file.status === "succeeded"))
          .map(source => ({ path: source.path!, startLine: source.startLine ?? 1, endLine: source.endLine ?? 0, complete: source.truncated === false }));
        return item.status === "succeeded" && item.inventory && ranges.length ? [{ projectId: item.projectId, commitSha: item.inventory.commitSha, ranges }] : [];
      }));
    const run = store.createSourceDemandRun(requestId, parent.id, input);
    dependencies.reserve(run.id);
    const work = researchDemandSources(parent.id, sourceParent!, input, {
      transport: { provider: transport.provider, model: transport.model, complete: (system, data, schema) => runtime.run(() => transport.complete(system, data, schema), "analyze-opportunities") },
      inventory: name => runtime.run(() => client.sourceInventory!(name), "collect-evidence"),
      read: (inventory, path, maxChars, startLine) => runtime.run(() => client.sourceText!(inventory, path, maxChars, startLine), "collect-evidence"),
      previouslyRead,
      checkpoint: snapshot => { store.checkpointDemandRun(run.id, snapshot); },
    }).then(() => undefined).catch(error => {
      store.failDemandRun(run.id, error instanceof Error ? error.message : "源码续研失败");
      app.log.error({ err: error, demandId: run.id }, "Demand source research failed");
    }).finally(() => { dependencies.reserve(null); running.delete(work); });
    running.add(work);
    return reply.code(202).send(store.getDemandRun(run.id));
  });
  app.post<{ Params: { id: string } }>("/demands/:id/resume-source", async (request, reply) => {
    const parsed = z.object({ requestId: z.string().uuid() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_source_resume", message: "请提供有效请求标识；恢复分析不能修改原范围" } });
    const saved = store.getDemandRun(request.params.id);
    if (!saved) return reply.code(404).send({ error: { code: "demand_not_found", message: "待恢复的任务不存在" } });
    const parent = saved.continuationOf ? store.getDemandRun(saved.continuationOf) : null, input = saved.continuationInput;
    const snapshot = saved.snapshot ? { ...saved.snapshot, status: saved.status === "interrupted" ? "partial" as const : saved.status } : null;
    const sourceParent = parent?.snapshot ? { ...parent.snapshot, status: parent.status === "interrupted" ? "partial" as const : parent.status } : null;
    if (!parent || !input || !snapshot || !sourceParent || !["failed", "interrupted"].includes(saved.status)) return reply.code(400).send({ error: { code: "invalid_source_resume", message: "请选择已保存源码且重评失败或中断的续研任务" } });
    let previous;
    try { previous = store.sourceDemandForRequest(parsed.data.requestId, parent.id, input, saved.id); }
    catch { return reply.code(409).send({ error: { code: "demand_request_conflict", message: "此请求标识已用于其他研究" } }); }
    if (previous) return reply.code(previous.status === "running" ? 202 : 200).send(previous);
    try { validateSourceStudyResume(parent.id, sourceParent, input, snapshot); }
    catch (error) { return reply.code(400).send({ error: { code: "invalid_source_resume", message: error instanceof Error ? error.message : "已存材料不可恢复" } }); }
    const duplicate = store.listDemandRuns(100).find(run => run.status === "running" && run.retryOf === saved.id && run.continuationOf === parent.id);
    if (duplicate) return reply.code(202).send(duplicate);
    if (!transport) return reply.code(503).send({ error: { code: "model_unavailable", message: dependencies.missingMessage } });
    if (dependencies.busy()) return reply.code(409).send({ error: { code: "job_in_progress", message: "请等待当前采集或分析完成" } });
    if (runtime.mode === "iii" && runtime.engineState !== "connected") return reply.code(503).send({ error: { code: "engine_unavailable", message: "iii Engine 未连接，尚未恢复分析" } });
    const run = store.createSourceDemandRun(parsed.data.requestId, parent.id, input, saved.id);
    dependencies.reserve(run.id);
    const work = researchDemandSources(parent.id, sourceParent, input, {
      transport: { provider: transport.provider, model: transport.model, complete: (system, data, schema) => runtime.run(() => transport.complete(system, data, schema), "analyze-opportunities") },
      inventory: async () => { throw new Error("恢复分析不应重新采集目录"); },
      read: async () => { throw new Error("恢复分析不应重新读取文件"); },
      reuse: { runId: saved.id, snapshot }, checkpoint: state => { store.checkpointDemandRun(run.id, state); },
    }).then(() => undefined).catch(error => {
      store.failDemandRun(run.id, error instanceof Error ? error.message : "恢复源码分析失败");
      app.log.error({ err: error, demandId: run.id }, "Demand source resume failed");
    }).finally(() => { dependencies.reserve(null); running.delete(work); });
    running.add(work);
    return reply.code(202).send(store.getDemandRun(run.id));
  });
}
