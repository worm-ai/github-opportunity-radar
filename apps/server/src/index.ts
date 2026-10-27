import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { experimentArtifact, listExperiments } from "./experiments.js";
import { analysisInputHash, canonicalResearchProfile, extractCapabilities, generateOpportunityDrafts, researchFocusSchema, researchOriginAvailable, researchProfileSchema, scoreProject, type ResearchFocus } from "@radar/analysis";
import { analysisConfiguration } from "./analysis-config.js";
import { createRuntimeAdapter, type RuntimeAdapter } from "@radar/runtime";
import { buildDiscoveryPlan, GitHubClient } from "@radar/sensor-github";
import { RadarStore, type AppSettings, type ScanRun } from "@radar/storage";
import { registerExternalValidationRoutes } from "./external-validation.js";
import { opportunityReport, researchReport } from "./reports.js";
import { registerValidationProgressRoutes } from "./validation-progress.js";
import { nextScanDelay } from "./schedule.js";
import { buildDiscoveryBrief, discoveryProfile } from "./discovery.js";
import { registerComponentRoutes } from "./components.js";
import { registerDemandRoutes } from "./demand.js";
import { registerIssueContextRoute } from "./issue-context.js";
import { registerDocumentationRoute } from "./documentation.js";
import { registerResearchNoteRoutes, relatedResearchNotes } from "./research-notes.js";
import { registerTaskMeasurementRoutes } from "./task-measurements.js";
import { registerMonitoringRoutes } from "./monitoring.js";
import { buildResearchLeads } from "./research-leads.js";
import { runScanPipeline } from "./scan-pipeline.js";
import { createExperimentRunManager, registerExperimentRunRoutes } from "./experiment-runs.js";
import { projectCacheHandoff } from "./project-cache.js";

const workspaceDirectory = fileURLToPath(new URL("../../../", import.meta.url));
loadEnv({ path: resolve(workspaceDirectory, ".env") });
const appHost = process.env.APP_HOST ?? "127.0.0.1";
const appPort = Number(process.env.APP_PORT ?? 4317);
const dataDirectory = resolve(workspaceDirectory, process.env.DATA_DIR ?? ".data");
const store = new RadarStore(resolve(dataDirectory, "opportunity-radar.sqlite"));
store.recoverInterruptedRuns();
const runtime = createRuntimeAdapter(process.env.III_URL, process.env.III_NAMESPACE);
const analysisConfig = analysisConfiguration();
const analysisMode = analysisConfig.mode;
const modelProvider = analysisConfig.provider;
const app = Fastify({ logger: true, bodyLimit: 128 * 1024, requestIdHeader: "x-request-id" });
const experimentDirectory = resolve(dataDirectory, "technical-experiments");
const experimentRuns = createExperimentRunManager({ workspaceRoot: workspaceDirectory, archiveRoot: experimentDirectory, dataDirectory });
const settingsSchema = z.object({
  searchQuery: z.string().trim().min(2).max(256),
  createdWithinDays: z.number().int().min(7).max(365),
  maxResults: z.number().int().min(1).max(60),
  scanIntervalHours: z.number().int().min(6).max(168),
  discoveryMode: z.enum(["balanced", "custom"]).default("balanced"),
  researchProfile: researchProfileSchema.nullable().optional(),
});
const statusSchema = z.object({ status: z.enum(["candidate", "saved", "validating", "dismissed"]) });

let activeRunId: string | null = null;
let scheduleTimer: NodeJS.Timeout | null = null;
let analysisRunning = false;
let evidenceProjectId: string | null = null;
let componentCollection: string | null = null;
let monitoring: ReturnType<typeof registerMonitoringRoutes> | null = null;

function integrationStatus() {
  return {
    runtime: runtime.mode, engineState: runtime.engineState, completedExecutions: runtime.completedExecutions,
    github: {
      tokenConfigured: Boolean(process.env.GITHUB_TOKEN?.trim()),
      caConfigured: Boolean(process.env.RADAR_GITHUB_CA_FILE?.trim()),
    },
    evidence: { running: evidenceProjectId !== null || componentCollection !== null, projectId: evidenceProjectId, operation: componentCollection },
    analysis: { mode: analysisMode, state: analysisConfig.state, model: analysisConfig.model, freeModelsOnly: analysisMode === "opencode", codexFallback: analysisConfig.codexFallback, automaticPaidFallback: false, running: analysisRunning || activeRunId === "analysis", lastRun: store.listAnalysisRuns(1)[0] ?? null },
  };
}

async function analyzeOpportunities(currentIds: Set<string>, focus?: ResearchFocus | null, researchProfile = canonicalResearchProfile(store.getSettings().researchProfile)) {
  if (analysisRunning) throw new Error("Opportunity analysis is already running");
  analysisRunning = true;
  try {
    const projects = focus ? focus.projectIds.map((id) => store.getProject(id)).filter((project) => project !== null).map(analyzeProject) : store.getProjects(200).map(analyzeProject);
    if (focus && projects.length !== focus.projectIds.length) throw new Error("Selected project is no longer available");
    if (analysisMode === "rules") {
      store.saveOpportunities(generateOpportunityDrafts(projects, 5, currentIds));
      return { mode: "rules", cached: false, warnings: [] };
    }
    if (!modelProvider) throw new Error(analysisConfig.missingMessage);
    if (projects.length < 2) return { mode: analysisMode, skipped: "insufficient_projects", warnings: [] };
    const inputHash = analysisInputHash(projects, currentIds, modelProvider.model, focus, modelProvider.provider, researchProfile);
    const cached = store.findCachedModelAnalysis(inputHash);
    const runId = store.createAnalysisRun(inputHash, modelProvider.model, focus, researchProfile);
    try {
      if (cached) {
        const result = { ...cached.result, usage: null, durationMs: 0, reusedFrom: cached.runId };
        store.saveOpportunities(result.drafts, focus, researchProfile);
        store.finishAnalysisRun(runId, result);
        return { mode: analysisMode, cached: true, opportunities: result.drafts.length, warnings: result.selection?.warnings ?? [] };
      }
      const result = await modelProvider.analyze(projects, currentIds, (nextUsage) => {
        store.updateAnalysisUsage(runId, nextUsage);
      }, focus, (snapshot) => store.checkpointAnalysisRun(runId, snapshot), researchProfile);
      store.saveOpportunities(result.drafts, focus, researchProfile);
      store.finishAnalysisRun(runId, result);
      return { mode: analysisMode, cached: false, opportunities: result.drafts.length, rejected: result.rejected, warnings: result.selection?.warnings ?? [] };
    } catch (error) {
      store.failAnalysisRun(runId, error instanceof Error ? error.message : "Model analysis failed");
      throw error;
    }
  } finally {
    analysisRunning = false;
  }
}

function analyzeProject(project: ReturnType<RadarStore["getProjects"]>[number]) {
  const analysis = scoreProject(project);
  return { ...project, score: analysis.score, scoreReasons: analysis.reasons, capabilities: extractCapabilities(project) };
}

function publicProject(project: ReturnType<RadarStore["getProjects"]>[number]) {
  const { raw: _raw, warning: _warning, ...result } = analyzeProject(project);
  return { ...result, discovery: discoveryProfile(project) };
}


function startScan(): ScanRun | null {
  if (activeRunId || analysisRunning) return null;
  if (runtime.mode === "iii" && runtime.engineState !== "connected") {
    throw Object.assign(new Error("iii Engine 未连接，请先运行 corepack pnpm engine:start"), { statusCode: 503 });
  }
  const run = store.createScanRun();
  const researchProfile = canonicalResearchProfile(store.getSettings().researchProfile);
  activeRunId = run.id;
  void runScanPipeline({
    run, store, runtime,
    client: new GitHubClient(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
    analyze: (ids) => analyzeOpportunities(ids, null, researchProfile),
    onAnalysis: () => { activeRunId = "analysis"; },
  })
    .catch((error: unknown) => app.log.error({ runId: run.id, err: error }, "Scan pipeline failed; see collection and analysis records for separate outcomes"))
    .finally(() => {
      if (activeRunId === run.id || activeRunId === "analysis") activeRunId = null;
      scheduleNextScan();
    });
  return run;
}

function scheduleNextScan() {
  if (scheduleTimer) clearTimeout(scheduleTimer);
  const latest = store.listScanRuns(1)[0] ?? null;
  const delay = activeRunId || analysisRunning ? 60_000 : nextScanDelay(latest?.startedAt ?? null, store.getSettings().scanIntervalHours);
  scheduleTimer = setTimeout(() => {
    try { startScan(); } catch (error) { app.log.warn({ err: error }, "Scheduled scan could not start"); }
    // A disconnected engine is retried without erasing the persisted due time.
    if (activeRunId) scheduleNextScan();
    else { scheduleTimer = setTimeout(scheduleNextScan, 60_000); scheduleTimer.unref(); }
  }, delay);
  scheduleTimer.unref();
}

app.register(helmet, { contentSecurityPolicy: false });
app.register(async (api) => {
  registerExperimentRunRoutes(api, experimentRuns);
  registerDemandRoutes(api, {
    store, runtime, transport: analysisConfig.transport, missingMessage: analysisConfig.missingMessage,
    client: () => new GitHubClient(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
    busy: () => Boolean(activeRunId || analysisRunning),
    reserve: id => { activeRunId = id ? `demand:${id}` : null; componentCollection = id ? "需求研究" : null; },
  });
  monitoring = registerMonitoringRoutes(api, {
    store, runtime, client: () => new GitHubClient(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
    busy: () => Boolean(activeRunId || analysisRunning),
    collection: (operation, projectId) => { componentCollection = operation; evidenceProjectId = projectId ?? null; activeRunId = operation ? "monitoring" : null; },
  });
  registerResearchNoteRoutes(api, store, experimentDirectory);
  registerTaskMeasurementRoutes(api, store);
  registerValidationProgressRoutes(api, store);
  registerExternalValidationRoutes(api, store);
  registerDocumentationRoute(api, {
    store, runtime,
    client: () => new GitHubClient(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
    busy: () => Boolean(activeRunId || analysisRunning),
    collection: (projectId) => { activeRunId = projectId ? `evidence:${projectId}` : null; evidenceProjectId = projectId; },
  });
  registerIssueContextRoute(api, {
    store, runtime,
    client: () => new GitHubClient(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
    busy: () => Boolean(activeRunId || analysisRunning),
    collection: (operation) => { componentCollection = operation; activeRunId = operation ? `evidence:${operation}` : null; },
  });
  registerComponentRoutes(api, {
    store, runtime,
    client: () => new GitHubClient(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
    busy: () => Boolean(activeRunId || analysisRunning),
    collection: (operation) => { componentCollection = operation; activeRunId = operation ? `components:${operation}` : null; },
  });
  api.get("/experiments", async () => ({ ...listExperiments(experimentDirectory), runnableIds: experimentRuns.runnableIds() }));
  api.get<{ Params: { id: string; name: string } }>("/experiments/:id/artifacts/:name", async (request, reply) => {
    try {
      const artifact = experimentArtifact(experimentDirectory, request.params.id, request.params.name);
      if (artifact) return reply.header("x-content-type-options", "nosniff").header("content-disposition", `${artifact.type === "image/png" ? "inline" : "attachment"}; filename="${artifact.name}"`).type(artifact.type).send(artifact.bytes);
    } catch { /* Missing, invalid, modified and unlisted files are unavailable. */ }
    return reply.code(404).send({ error: { code: "experiment_artifact_unavailable", message: "实测产物不存在或校验失败", requestId: request.id } });
  });
  api.get("/reports/latest.md", async (_request, reply) => {
    const scan = store.listScanRuns(1)[0] ?? null;
    const analysis = store.listAnalysisRuns(1)[0] ?? null;
    const counts = store.dashboard();
    const drafts = analysis ? store.getAnalysisResult(analysis.id)?.drafts ?? [] : [];
    return reply.header("content-disposition", 'attachment; filename="opportunity-radar-research.md"').type("text/markdown; charset=utf-8").send(researchReport({ scan, analysis, drafts, projectCount: counts.projectCount, issueCount: counts.issueSampleCount }));
  });
  api.get<{ Params: { id: string } }>("/opportunities/:id/report.md", async (request, reply) => {
    const item = store.getOpportunity(request.params.id);
    if (!item) return reply.code(404).send({ error: { code: "opportunity_not_found", message: "Opportunity not found", requestId: request.id } });
    return reply.header("content-disposition", 'attachment; filename="opportunity-validation.md"').type("text/markdown; charset=utf-8").send(opportunityReport(item, { researchNotes: relatedResearchNotes(store, item.projectIds, experimentDirectory), experiments: listExperiments(experimentDirectory).records }));
  });
  api.get("/health/live", async () => ({ live: true }));
  api.get("/health/ready", async (_request, reply) => {
    const ready = runtime.mode === "local" || runtime.engineState === "connected";
    return reply.code(ready ? 200 : 503).send({ ready, database: "sqlite", ...integrationStatus() });
  });

  api.get("/dashboard", async () => ({ ...store.dashboard(), ...integrationStatus() }));
  api.get("/integrations", async () => integrationStatus());
  api.get("/analysis/runs", async () => store.listAnalysisRuns());
  api.get("/research/leads", async () => ({ leads: buildResearchLeads(store.listAnalysisRuns(10)) }));
  api.get<{ Params: { id: string } }>("/analysis/runs/:id/report.md", async (request, reply) => {
    const analysis = store.getAnalysisRun(request.params.id);
    if (!analysis) return reply.code(404).send({ error: { code: "analysis_not_found", message: "Analysis not found", requestId: request.id } });
    const counts = store.dashboard();
    return reply.header("content-disposition", 'attachment; filename="opportunity-radar-research.md"').type("text/markdown; charset=utf-8").send(researchReport({ scan: store.listScanRuns(1)[0] ?? null, analysis, drafts: store.getAnalysisResult(analysis.id)?.drafts ?? [], projectCount: counts.projectCount, issueCount: counts.issueSampleCount }));
  });
  api.post("/analysis", async (request, reply) => {
    const parsed = z.object({ focus: researchFocusSchema.optional() }).strict().safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_research_focus", message: "定向研究需选择 2～3 个不同项目，并填写 12～1200 字符的研究问题", requestId: request.id } });
    const focus = parsed.data.focus;
    if (focus && analysisMode === "rules") return reply.code(400).send({ error: { code: "focused_model_required", message: "定向研究需要配置模型", requestId: request.id } });
    if (focus && focus.projectIds.some((id) => !store.getProject(id))) return reply.code(400).send({ error: { code: "unknown_project", message: "请选择已采集的项目", requestId: request.id } });
    if (focus && !researchOriginAvailable(focus, focus.projectIds.flatMap((id) => store.getProject(id) ?? []))) return reply.code(400).send({ error: { code: "unknown_origin_issue", message: "问题起点必须是所选项目中已采集的 Issue，请重新选择", requestId: request.id } });
    if (activeRunId || analysisRunning) return reply.code(409).send({ error: { code: "job_in_progress", message: "请等待当前扫描或分析完成", requestId: reply.request.id } });
    if (analysisMode !== "rules" && !modelProvider) return reply.code(400).send({ error: { code: "model_not_configured", message: analysisConfig.missingMessage, requestId: reply.request.id } });
    if (runtime.mode === "iii" && runtime.engineState !== "connected") return reply.code(503).send({ error: { code: "engine_unavailable", message: "iii Engine 未连接", requestId: reply.request.id } });
    const ids = new Set(focus?.projectIds ?? store.getProjects(200).map((project) => project.id));
    if (ids.size < 2) return reply.code(400).send({ error: { code: "insufficient_projects", message: "至少需要两个项目才能分析组合机会", requestId: reply.request.id } });
    // Reserve the shared job slot before the first asynchronous engine round trip.
    activeRunId = "analysis";
    const researchProfile = canonicalResearchProfile(store.getSettings().researchProfile);
    void runtime.run(() => analyzeOpportunities(ids, focus, researchProfile), "analyze-opportunities")
      .catch((error: unknown) => app.log.error({ err: error }, "Opportunity analysis failed"))
      .finally(() => { activeRunId = null; });
    return reply.code(202).send({ status: "running" });
  });
  api.get("/settings", async () => store.getSettings());
  api.get("/discovery/plan", async () => buildDiscoveryPlan(store.getSettings(), new Date(), store.getDiscoveryProgress()));
  api.get("/discovery/brief", async () => {
    const scan = store.listScanRuns().find((run) => ["succeeded", "partial"].includes(run.status) && run.found > 0) ?? null;
    return buildDiscoveryBrief(store.getProjects(200), store.getDiscoveryObservations(), scan ? { id: scan.id, startedAt: scan.startedAt, finishedAt: scan.finishedAt } : null);
  });
  api.put<{ Body: AppSettings }>("/settings", async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_settings", message: parsed.error.issues[0]?.message ?? "Invalid settings", requestId: request.id } });
    const previous = store.getSettings();
    const next: AppSettings = {
      ...parsed.data,
      researchProfile: parsed.data.researchProfile === undefined
        ? previous.researchProfile ?? null
        : parsed.data.researchProfile,
    };
    const saved = store.updateSettings(next);
    scheduleNextScan();
    return saved;
  });

  api.get("/projects", async () => store.getProjects(200).map(publicProject));
  api.get("/projects/search", async (request, reply) => {
    const parsed = z.object({ q: z.string().trim().min(1).max(256), limit: z.coerce.number().int().min(1).max(50).default(30), download: z.enum(["true", "false"]).default("false").transform((value) => value === "true"), expand: z.enum(["true", "false"]).default("false").transform((value) => value === "true"), format: z.enum(["json", "markdown"]).default("json") }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_project_search", message: parsed.error.issues[0]?.message ?? "Invalid cached project search", requestId: request.id } });
    try {
      const searched = store.searchProjectsDetailed(parsed.data.q, parsed.data.limit, { expandOnEmpty: parsed.data.expand });
      const items = searched.items.map((project) => ({ ...publicProject(project), matchedFields: project.matchedFields, matchedEvidence: project.matchedEvidence }));
      const observedAt = items.map((item) => item.observedAt).sort().at(-1) ?? null;
      const result = { mode: "local_cache" as const, query: parsed.data.q, observedAt, expandedQueries: searched.expandedQueries, items };
      if (parsed.data.format === "markdown") return reply.header("content-disposition", `attachment; filename="local-cache-${encodeURIComponent(parsed.data.q).replace(/%/g, "_")}.md"`).type("text/markdown; charset=utf-8").send(projectCacheHandoff(result));
      if (parsed.data.download) return reply.header("content-disposition", `attachment; filename="local-cache-${encodeURIComponent(parsed.data.q).replace(/%/g, "_")}.json"`).send(result);
      return result;
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("project_search_query_") ? error.message : "project_search_failed";
      const message = code === "project_search_query_too_long" ? "Search query is too long" : code === "project_search_query_invalid" ? "Search query must contain letters or numbers" : "Cached project search is unavailable";
      return reply.code(400).send({ error: { code, message, requestId: request.id } });
    }
  });
  api.get<{ Params: { id: string } }>("/projects/:id/observations", async (request) => store.getProjectObservations(request.params.id));
  api.get<{ Params: { id: string } }>("/projects/:id", async (request, reply) => {
    const project = store.getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: { code: "project_not_found", message: "Project not found", requestId: request.id } });
    return publicProject(project);
  });
  api.get("/opportunities", async (request, reply) => {
    const parsed = z.object({ view: z.enum(["current", "history"]).default("current") }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_opportunity_view", message: "Unsupported opportunity view", requestId: request.id } });
    return store.getOpportunities(parsed.data.view);
  });
  api.get<{ Params: { id: string } }>("/opportunities/:id", async (request, reply) => {
    const opportunity = store.getOpportunity(request.params.id);
    if (!opportunity) return reply.code(404).send({ error: { code: "opportunity_not_found", message: "Opportunity not found", requestId: request.id } });
    return opportunity;
  });
  api.get<{ Params: { id: string } }>("/opportunities/:id/research-notes", async (request, reply) => {
    const opportunity = store.getOpportunity(request.params.id);
    if (!opportunity) return reply.code(404).send({ error: { code: "opportunity_not_found", message: "Opportunity not found", requestId: request.id } });
    return relatedResearchNotes(store, opportunity.projectIds, experimentDirectory);
  });
  api.patch<{ Params: { id: string }; Body: { status: string } }>("/opportunities/:id", async (request, reply) => {
    const parsed = statusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_status", message: "Unsupported opportunity status", requestId: request.id } });
    const opportunity = store.updateOpportunityStatus(request.params.id, parsed.data.status);
    if (!opportunity) return reply.code(404).send({ error: { code: "opportunity_not_found", message: "Opportunity not found", requestId: request.id } });
    return opportunity;
  });

  api.get("/scans", async () => store.listScanRuns());
  api.post("/scans", async (_request, reply) => {
    const run = startScan();
    if (!run) return reply.code(409).send({ error: { code: "scan_in_progress", message: "A GitHub scan is already running", requestId: reply.request.id } });
    return reply.code(202).send({ id: run.id, status: run.status });
  });
}, { prefix: "/api/v1" });

if (process.env.NODE_ENV === "production") {
  const webDirectory = fileURLToPath(new URL("../../web/dist/", import.meta.url));
  // Serve Vite assets before the SPA fallback; without the wildcard, missing
  // static routes are rewritten to index.html and browsers reject the module.
  app.register(fastifyStatic, { root: resolve(webDirectory), wildcard: true });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: { code: "not_found", message: "Route not found", requestId: request.id } });
    return reply.sendFile("index.html");
  });
}

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "Request failed");
  const candidateStatus = error instanceof Error && "statusCode" in error ? error.statusCode : null;
  const statusCode = typeof candidateStatus === "number" && candidateStatus >= 400 ? candidateStatus : 500;
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return reply.code(statusCode).send({ error: { code: statusCode >= 500 ? "internal_error" : "request_error", message: statusCode >= 500 ? "Unexpected server error" : message, requestId: request.id } });
});

app.addHook("onClose", async () => {
  if (scheduleTimer) clearTimeout(scheduleTimer);
  await monitoring?.stop();
  await runtime.close();
  store.close();
});

await app.listen({ host: appHost, port: appPort });
scheduleNextScan();
app.log.info({ host: appHost, port: appPort, dataDirectory, runtime: runtime.mode }, "Opportunity Radar is ready");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { void app.close(); });
}
