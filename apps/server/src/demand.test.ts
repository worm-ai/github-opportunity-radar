import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { RadarStore } from "@radar/storage";
import { InProcessRuntimeAdapter, type RuntimeAdapter } from "@radar/runtime";
import type { CompletionTransport } from "@radar/analysis";
import { registerDemandRoutes } from "./demand.js";
import { GitHubApiError, GitHubClient } from "@radar/sensor-github";

const question = "Build a persistent shared world with interacting autonomous agents.";
const plan = { summary: "Research a shared agent world", capabilities: [{ id: "world", description: "A shared persistent agent world", required: true, origin: "user" }], constraints: [], assumptions: [], questions: [], queries: [{ query: "agent world simulation", reason: "Find complete shared world implementations" }] };
const repository = { id: 77, fullName: "sample/world", description: "Agents remember actions in a persistent shared world.", language: "Python", license: "MIT", stars: 20, forks: 1, openIssues: 0, createdAt: "2020-01-01T00:00:00Z", pushedAt: "2026-10-20T00:00:00Z", url: "https://github.com/sample/world", readmeExcerpt: "Configure three agents and run the documented example.", releaseTag: "v1", releaseUrl: null, readmeFetchSucceeded: true, releaseFetchSucceeded: true, issues: [], issuesFetchSucceeded: true, issuesFetchedAt: "2026-10-20T00:00:00Z", discoveryChannels: ["按需收录"], raw: { id: 77 }, warning: null };
const response = (content: unknown) => ({ content: JSON.stringify(content), finishReason: "stop", promptTokens: 10, completionTokens: 20 });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
function setup(options: { configured?: boolean; busy?: boolean; runtime?: RuntimeAdapter } = {}) {
  const app = Fastify(), store = new RadarStore(":memory:"), runtime = options.runtime ?? new InProcessRuntimeAdapter();
  const complete = vi.fn<CompletionTransport["complete"]>().mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response({ selected: [{ fullName: repository.fullName, reason: "Closest shared world implementation" }], skipped: [] })).mockResolvedValueOnce(response({ paths: [], gapQueries: [], conclusion: "Collected material is insufficient to recommend an implementation." }));
  const transport: CompletionTransport = { provider: "codex", model: "fixture", complete };
  const client = { checkSearchAccess: vi.fn(async (): Promise<void> => {}), findRepositories: vi.fn(async (query: string) => ({ query, items: [{ ...repository, archived: false, fork: false }], total: 1, incomplete: false, observedAt: "2026-10-20T00:00:00Z" })), collectRepository: vi.fn(async () => repository),
    sourceInventory: vi.fn(async () => ({ fullName: repository.fullName, commitSha: "a".repeat(40), observedAt: "2026-10-23T00:00:00Z", complete: true, warnings: [], files: [{ path: "engine.py", sha: "b".repeat(40), size: 25 }] })),
    sourceText: vi.fn(async (_inventory, path = "engine.py", _maxChars, startLine = 1) => ({ path, sha: "b".repeat(40), commitSha: "a".repeat(40), observedAt: "2026-10-23T00:00:00Z", content: "state.memory.push(event);", startLine, endLine: startLine, totalLines: startLine, truncated: false, url: "https://github.com/sample/world/blob/" + "a".repeat(40) + "/" + path })) };
  let slot: string | null = options.busy ? "other-job" : null;
  registerDemandRoutes(app, { store, runtime, transport: options.configured === false ? null : transport, missingMessage: "Model needs configuration", client: () => client, busy: () => Boolean(slot), reserve: value => { slot = value; } });
  cleanups.push(async () => { await app.close(); await runtime.close(); store.close(); });
  const post = (payload: object = { question, requestId: randomUUID() }) => app.inject({ method: "POST", url: "/demands", payload });
  return { app, store, client, complete, post, slot: () => slot };
}

it("returns a durable task, stores actual sources, exposes history and export without generating old opportunities", async () => {
  const { app, store, post, slot } = setup();
  const started = await post(); expect(started.statusCode).toBe(202);
  const id = started.json().id as string;
  await vi.waitFor(() => expect(store.getDemandRun(id)?.status).toBe("succeeded"));
  expect(slot()).toBeNull();
  const detail = (await app.inject(`/demands/${id}`)).json();
  expect(detail.snapshot).toMatchObject({ outcome: "insufficient_evidence", sources: expect.arrayContaining([expect.objectContaining({ content: repository.description })]) });
  const history = (await app.inject("/demands")).json();
  expect(history[0]).toMatchObject({ id, stage: "finished", outcome: "insufficient_evidence", researchNoteCount: 0 });
  expect(history[0].snapshot).toBeUndefined();
  const report = await app.inject(`/demands/${id}/report.json`);
  expect(report.headers["content-disposition"]).toContain("attachment");
  expect(report.json()).toEqual(detail);
  expect(store.getProjects()).toHaveLength(1);
  expect(store.getOpportunities()).toEqual([]);
  expect(store.listAnalysisRuns()).toEqual([]);
  expect(store.listScanRuns()).toEqual([]);
});

it("deduplicates in-flight retries before the shared busy check, rejects UUID reuse and keeps explicit retry history", async () => {
  const { post, complete, store, slot } = setup();
  let resolve!: (value: ReturnType<typeof response>) => void;
  complete.mockReset().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(response(plan));
  const requestId = randomUUID();
  const first = await post({ question, requestId }), id = first.json().id;
  expect(slot()).toBe(id);
  expect((await post({ question, requestId })).json().id).toBe(id);
  expect((await post({ question, requestId: randomUUID() })).json().id).toBe(id);
  expect((await post({ question: `${question} With player controls.`, requestId })).statusCode).toBe(409);
  expect((await post({ question: `${question} With player controls.`, requestId: randomUUID() })).statusCode).toBe(409);
  expect(complete).toHaveBeenCalledOnce();
  resolve(response(plan));
  await vi.waitFor(() => expect(store.getDemandRun(id)?.status).toBe("failed"));
  expect(slot()).toBeNull();
  const original = store.getDemandRun(id);
  complete.mockReset().mockRejectedValue(new Error("explicit retry failure"));
  const retry = await post({ question, requestId: randomUUID(), retryOf: id });
  await vi.waitFor(() => expect(store.getDemandRun(retry.json().id)?.status).toBe("failed"));
  expect(store.getDemandRun(retry.json().id)?.retryOf).toBe(id);
  expect(store.getDemandRun(id)).toEqual(original);
});

it("preserves collected sources on model failure and releases the lock", async () => {
  const { post, store, complete, slot } = setup();
  complete.mockReset().mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response({ selected: [{ fullName: repository.fullName, reason: "A promising complete world candidate" }], skipped: [] })).mockRejectedValueOnce(new Error("model timed out"));
  const id = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(id)?.status).toBe("failed"));
  expect(store.getDemandRun(id)).toMatchObject({ error: "model timed out", snapshot: { sources: expect.arrayContaining([expect.objectContaining({ content: repository.description })]), recommendedPathId: null } });
  expect(slot()).toBeNull();
});

it("persists certificate failures without selecting, collecting or recommending candidates", async () => {
  const { app, post, store, complete, client, slot } = setup();
  const queries = ["generative_agents", '"generative agents"', "ai-town", '"social simulation" game'];
  complete.mockReset().mockResolvedValueOnce(response({ ...plan, queries: queries.map(query => ({ query, reason: "Find an existing social simulation implementation" })) }));
  const cause = Object.assign(new Error("certificate rejected"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
  const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
  const sensor = new GitHubClient({ fetcher });
  client.findRepositories.mockImplementation(async query => {
    await sensor.findRepositories(query);
    throw new Error("Certificate fixture unexpectedly succeeded");
  });
  const id = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(id)?.status).toBe("partial"));
  const detail = (await app.inject(`/demands/${id}`)).json();
  expect(detail.snapshot).toMatchObject({
    stage: "finished", status: "partial", projects: [], sources: [], selections: [], evaluations: [],
    recommendedPathId: null, outcome: "insufficient_evidence",
  });
  expect(detail.snapshot.searches.map((item: { query: string }) => item.query)).toEqual(queries);
  for (const search of detail.snapshot.searches) expect(search).toMatchObject({
    status: "failed", items: [], total: null,
    error: "GitHub certificate verification failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE); automatic retries stopped",
  });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(complete).toHaveBeenCalledOnce();
  expect(client.collectRepository).not.toHaveBeenCalled();
  expect(slot()).toBeNull();
  expect((await app.inject(`/demands/${id}/report.json`)).json()).toEqual(detail);
});

it("recovers evaluation idempotently and continues any recorded gap without changing the parent", async () => {
  const { app, post, store, complete, client, slot } = setup();
  complete.mockReset().mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response({ selected: [{ fullName: repository.fullName, reason: "A complete application candidate" }], skipped: [] })).mockRejectedValueOnce(new Error("evaluation timeout"));
  const failedId = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(failedId)?.status).toBe("failed"));
  const before = store.getDemandRun(failedId), requestId = randomUUID();
  let resolve!: (value: ReturnType<typeof response>) => void;
  complete.mockReset().mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const replacement = { ...repository, id: 88, fullName: "sample/new-world", description: "New world events are persisted for agents.", url: "https://github.com/sample/new-world" };
  client.findRepositories.mockResolvedValue({ query: "world events", items: [{ ...replacement, archived: false, fork: false }], total: 1, incomplete: false, observedAt: "2026-10-26T00:00:00Z" });
  client.collectRepository.mockResolvedValueOnce(replacement);
  client.findRepositories.mockClear(); client.collectRepository.mockClear(); client.sourceInventory.mockClear(); client.sourceText.mockClear();
  const send = (key = requestId) => app.inject({ method: "POST", url: `/demands/${failedId}/resume-evaluation`, payload: { requestId: key } });
  const first = await send(); expect(first.statusCode).toBe(202);
  const id = first.json().id;
  expect(slot()).toBe(id);
  expect((await send()).json().id).toBe(id);
  expect((await send(randomUUID())).json().id).toBe(id);
  expect((await post({ question, requestId, retryOf: failedId })).statusCode).toBe(409);
  expect(complete).toHaveBeenCalledOnce();
  resolve(response({ paths: [], gapQueries: [{ query: "world events", reason: "Need more evidence before a recommendation", capabilityIds: ["world"] }], conclusion: "Existing evidence cannot establish a usable implementation" }));
  complete.mockResolvedValueOnce(response({ selected: [{ fullName: replacement.fullName, reason: "New candidate for the explicit gap" }], skipped: [] }))
    .mockResolvedValueOnce(response({ paths: [{ id: "new-world", title: "Use the new world", kind: "adopt", projectIds: ["88"], coverage: [{ capabilityId: "world", status: "supported", reason: "Collected description states that events persist", evidence: [{ sourceId: "88:description:0", quote: replacement.description }] }], constraintsFit: "compatible", constraintReason: "No conflicting constraint was recorded", roles: [{ projectId: "88", responsibility: "Runs the world", input: "Agent events", output: "Persistent world state" }], integration: "Use the project as the world runtime", remainingWork: ["Run the documented scenario"], risks: ["Runtime remains unverified"], experiment: { input: "Three agents and one event", steps: ["Run the example"], pass: "The event persists", fail: "The event is lost" } }], gapQueries: [], conclusion: "New evidence provides a candidate path" }))
    .mockResolvedValueOnce(response({ reviews: [{ pathId: "new-world", verdict: "keep", reason: "Evidence is grounded but runtime remains unverified", risks: ["Runtime remains unverified"], checks: { capabilitiesGrounded: true, constraintsRespected: true, singleProjectCompared: true, integrationHonest: true, experimentFalsifiable: true } }], recommendedPathId: "new-world", conclusion: "Test the candidate before adoption" }));
  await vi.waitFor(() => expect(store.getDemandRun(id)?.status).not.toBe("running"));
  expect(store.getDemandRun(id)?.snapshot?.reviews?.recommendedPathId).toBe("new-world");
  expect((await send()).statusCode).toBe(200);
  const resumed = store.getDemandRun(id)!;
  expect(resumed).toMatchObject({ retryOf: failedId, continuationOf: null, snapshot: { evaluationResume: { fromRunId: failedId }, calls: [expect.objectContaining({ stage: "evaluation", status: "succeeded" }), expect.objectContaining({ stage: "selection", status: "succeeded" }), expect.objectContaining({ stage: "evaluation", status: "succeeded" }), expect.objectContaining({ stage: "review", status: "succeeded" })], reviews: { recommendedPathId: "new-world" }, projects: expect.arrayContaining([expect.objectContaining({ id: "88" })]) } });
  expect(store.getDemandRun(failedId)).toEqual(before);
  expect(client.findRepositories).toHaveBeenCalledWith("world events"); expect(client.collectRepository).toHaveBeenCalledWith(replacement.fullName);
  expect(client.sourceInventory).not.toHaveBeenCalled(); expect(client.sourceText).not.toHaveBeenCalled();
  expect(slot()).toBeNull();
  expect((await app.inject(`/demands/${id}/report.json`)).json()).toEqual(resumed);
  expect((await app.inject("/demands/features")).json()).toMatchObject({ evaluationResume: true, researchVersion: "demand-research-v5" });
});

it("replans a model-fallback study and reuses its captured sources without replacing the parent", async () => {
  const { app, post, store, complete, client } = setup();
  complete.mockReset().mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response({ selected: [{ fullName: repository.fullName, reason: "A complete implementation candidate" }], skipped: [] }))
    .mockResolvedValueOnce({ ...response({ paths: [], gapQueries: [], conclusion: "Fallback acquisition did not evaluate these sources" }), model: "rules/evidence-only" });
  const parentId = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(parentId)?.status).toBe("partial"));
  const parent = store.getDemandRun(parentId)!;
  const degraded = structuredClone(parent.snapshot!);
  degraded.status = "partial"; degraded.stage = "finished"; degraded.recommendedPathId = null; degraded.reviews = null;
  degraded.calls = [{ stage: "evaluation", model: "rules/evidence-only", promptTokens: null, completionTokens: null, status: "succeeded" }];
  degraded.warnings.push("模型不可用，已进入证据优先降级模式");
  store.checkpointDemandRun(parentId, degraded);
  const before = store.getDemandRun(parentId);
  const replanned = { ...plan, capabilities: [{ id: "persistent-world", description: "Persistent world state", required: true, origin: "user" }] };
  complete.mockReset().mockResolvedValueOnce(response(replanned)).mockResolvedValueOnce(response({ paths: [], gapQueries: [], conclusion: "Saved sources do not establish a suitable implementation" }));
  client.findRepositories.mockClear(); client.collectRepository.mockClear();
  const requestId = randomUUID();
  const resumedResponse = await app.inject({ method: "POST", url: `/demands/${parentId}/resume-evaluation`, payload: { requestId } });
  expect(resumedResponse.statusCode).toBe(202); const childId = resumedResponse.json().id as string;
  await vi.waitFor(() => expect(store.getDemandRun(childId)?.status).toBe("partial"));
  const child = store.getDemandRun(childId)!;
  expect(child.snapshot).toMatchObject({ evaluationResume: { fromRunId: parentId, replanned: true }, plan: { capabilities: [{ id: "persistent-world" }] }, sources: before!.snapshot!.sources });
  expect(child.snapshot!.warnings.join(" " )).toContain("旧降级拆解、筛选理由和评估不作为新判断依据");
  expect(complete).toHaveBeenCalledTimes(2); expect(client.findRepositories).not.toHaveBeenCalled(); expect(client.collectRepository).not.toHaveBeenCalled();
  expect(store.getDemandRun(parentId)).toEqual(before);
  expect((await app.inject("/demands/features")).json()).toMatchObject({ fallbackEvaluationResume: true });
});

it("recovers a failed candidate selection from saved GitHub previews without replanning or repeating initial searches", async () => {
  const { app, post, store, complete, client, slot } = setup();
  complete.mockReset().mockResolvedValueOnce(response(plan)).mockRejectedValueOnce(new Error("selection process exited"));
  const failedId = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(failedId)?.status).toBe("failed"));
  const before = store.getDemandRun(failedId);
  expect(before?.snapshot).toMatchObject({ stage: "failed", searches: [expect.objectContaining({ status: "succeeded", items: [expect.objectContaining({ fullName: repository.fullName })] })], calls: [expect.objectContaining({ stage: "plan", status: "succeeded" }), expect.objectContaining({ stage: "selection", status: "failed" })] });
  client.findRepositories.mockClear(); client.collectRepository.mockClear();
  complete.mockReset().mockResolvedValueOnce(response({ selected: [{ fullName: repository.fullName, reason: "The saved preview is the closest complete candidate" }], skipped: [] })).mockResolvedValueOnce(response({ paths: [], gapQueries: [], conclusion: "Repository material still needs implementation verification" }));
  const requestId = randomUUID(), send = () => app.inject({ method: "POST", url: `/demands/${failedId}/resume-selection`, payload: { requestId } });
  const first = await send(); expect(first.statusCode).toBe(202);
  const id = first.json().id;
  expect(slot()).toBe(id);
  expect((await send()).json().id).toBe(id);
  expect((await send()).json().id).toBe(id);
  await vi.waitFor(() => expect(store.getDemandRun(id)?.status).toBe("partial"));
  const resumed = store.getDemandRun(id)!;
  expect(resumed).toMatchObject({ retryOf: failedId, continuationOf: null, snapshot: { selectionResume: { fromRunId: failedId }, searches: before!.snapshot!.searches, selections: [{ round: 1 }], projects: [expect.objectContaining({ fullName: repository.fullName })] } });
  expect(complete).toHaveBeenCalledTimes(2);
  expect(client.findRepositories).not.toHaveBeenCalled(); expect(client.collectRepository).toHaveBeenCalledOnce();
  expect(store.getDemandRun(failedId)).toEqual(before); expect(slot()).toBeNull();
  expect((await app.inject("/demands/features")).json()).toMatchObject({ selectionResume: true, researchVersion: "demand-research-v5" });
});

it("resumes a partial evaluation by performing the recorded gap search and preserving the parent", async () => {
  const { app, post, store, complete, client, slot } = setup();
  const gap = { paths: [], gapQueries: [{ query: "agent events", reason: "Find evidence for the missing world behavior", capabilityIds: ["world"] }], conclusion: "The saved material leaves the world behavior unresolved" };
  complete.mockReset().mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response({ selected: [{ fullName: repository.fullName, reason: "Initial candidate" }], skipped: [] })).mockResolvedValueOnce(response(gap));
  client.findRepositories.mockImplementation(async query => query === "agent events"
    ? { query, items: [], total: 0, incomplete: false, observedAt: "2026-10-20T00:00:00Z" }
    : { query, items: [{ ...repository, archived: false, fork: false }], total: 1, incomplete: false, observedAt: "2026-10-20T00:00:00Z" });
  const parentId = (await post()).json().id as string;
  await vi.waitFor(() => expect(store.getDemandRun(parentId)?.status).toBe("partial"));
  const parent = store.getDemandRun(parentId)!;
  expect(parent.snapshot?.evaluations.at(-1)?.gapQueries).toEqual(gap.gapQueries);
  const original = structuredClone(parent);
  const replacement = { ...repository, id: 88, fullName: "sample/new-world", description: "New world events are persisted for agents.", url: "https://github.com/sample/new-world" };
  client.findRepositories.mockImplementation(async query => ({ query, items: [{ ...replacement, archived: false, fork: false }], total: 1, incomplete: false, observedAt: "2026-10-26T00:00:00Z" }));
  client.collectRepository.mockResolvedValueOnce(replacement);
  complete.mockReset().mockResolvedValueOnce(response({ selected: [{ fullName: replacement.fullName, reason: "New gap candidate" }], skipped: [] })).mockResolvedValueOnce(response({ paths: [{ id: "new", title: "Use the new world", kind: "adopt", projectIds: ["88"], coverage: [{ capabilityId: "world", status: "supported", reason: "The collected description names persisted events", evidence: [{ sourceId: "88:description:0", quote: replacement.description }] }], constraintsFit: "compatible", constraintReason: "No conflicting constraint was recorded", roles: [{ projectId: "88", responsibility: "Runs the world", input: "Agent events", output: "Persisted world state" }], integration: "Use the project as the world runtime", remainingWork: ["Run the documented scenario"], risks: ["Runtime remains unverified"], experiment: { input: "Three agents and one event", steps: ["Run the example"], pass: "The event persists", fail: "The event is lost" } }], gapQueries: [], conclusion: "The new candidate addresses the recorded gap" })).mockResolvedValueOnce(response({ reviews: [{ pathId: "new", verdict: "keep", reason: "The evidence is grounded but runtime remains to be tested", risks: ["Runtime remains unverified"], checks: { capabilitiesGrounded: true, constraintsRespected: true, singleProjectCompared: true, integrationHonest: true, experimentFalsifiable: true } }], recommendedPathId: "new", conclusion: "Test the new candidate" }));
  const requestId = randomUUID();
  const started = await app.inject({ method: "POST", url: `/demands/${parentId}/resume-gaps`, payload: { requestId } });
  expect(started.statusCode).toBe(202);
  const resumedId = started.json().id as string;
  expect((await app.inject({ method: "POST", url: `/demands/${parentId}/resume-gaps`, payload: { requestId } })).json().id).toBe(resumedId);
  await vi.waitFor(() => expect(store.getDemandRun(resumedId)?.status).toBe("partial"));
  const resumed = store.getDemandRun(resumedId)!;
  expect(resumed.status).toBe("partial");
  expect(resumed).toMatchObject({ retryOf: parentId, snapshot: { gapResume: { fromRunId: parentId }, projects: expect.arrayContaining([expect.objectContaining({ id: "77" }), expect.objectContaining({ id: "88" })]), reviews: { recommendedPathId: "new" } } });
  expect(client.findRepositories).toHaveBeenCalledWith("agent events");
  expect(client.collectRepository).toHaveBeenCalledWith(replacement.fullName);
  expect(store.getDemandRun(parentId)).toEqual(original);
  expect(slot()).toBeNull();
});

it("rejects changed scope and non-evaluation recovery without creating a run, and keeps a second timeout", async () => {
  const { app, post, store, complete } = setup();
  complete.mockReset().mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response({ selected: [{ fullName: repository.fullName, reason: "A complete application candidate" }], skipped: [] })).mockRejectedValueOnce(new Error("first timeout"));
  const failedId = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(failedId)?.status).toBe("failed"));
  const before = store.getDemandRun(failedId);
  expect((await app.inject({ method: "POST", url: `/demands/${failedId}/resume-evaluation`, payload: { requestId: randomUUID(), question: "A different goal must not be accepted" } })).statusCode).toBe(400);
  expect((await app.inject({ method: "POST", url: `/demands/${randomUUID()}/resume-evaluation`, payload: { requestId: randomUUID() } })).statusCode).toBe(404);
  expect(store.listDemandRuns()).toHaveLength(1);
  complete.mockReset().mockRejectedValueOnce(new Error("second timeout"));
  const next = await app.inject({ method: "POST", url: `/demands/${failedId}/resume-evaluation`, payload: { requestId: randomUUID() } });
  await vi.waitFor(() => expect(store.getDemandRun(next.json().id)?.status).toBe("failed"));
  expect(store.getDemandRun(next.json().id)).toMatchObject({ error: "second timeout", snapshot: { sources: before!.snapshot!.sources, recommendedPathId: null } });
  expect(store.getDemandRun(failedId)).toEqual(before);
  complete.mockReset().mockRejectedValueOnce(new Error("planning timeout"));
  const planning = (await post({ question: `${question} Different scenario.`, requestId: randomUUID() })).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(planning)?.status).toBe("failed"));
  const count = store.listDemandRuns().length;
  expect((await app.inject({ method: "POST", url: `/demands/${planning}/resume-evaluation`, payload: { requestId: randomUUID() } })).statusCode).toBe(400);
  expect(store.listDemandRuns()).toHaveLength(count);
});

it("recovers an interrupted evaluation with the running receipt retained in the original task", async () => {
  const { app, post, store, complete } = setup();
  complete.mockReset().mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response({ selected: [{ fullName: repository.fullName, reason: "A complete application candidate" }], skipped: [] })).mockRejectedValueOnce(new Error("timeout"));
  const failedId = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(failedId)?.status).toBe("failed"));
  const interrupted = store.createDemandRun(randomUUID(), question, null), state = structuredClone(store.getDemandRun(failedId)!.snapshot!);
  state.status = "running"; state.stage = "evaluating"; state.calls.at(-1)!.status = "running";
  store.checkpointDemandRun(interrupted.id, state); store.recoverInterruptedRuns();
  const before = store.getDemandRun(interrupted.id);
  complete.mockReset().mockResolvedValueOnce(response({ paths: [], gapQueries: [], conclusion: "No recommendation can be grounded in the saved evidence" }));
  const result = await app.inject({ method: "POST", url: `/demands/${interrupted.id}/resume-evaluation`, payload: { requestId: randomUUID() } });
  expect(result.statusCode).toBe(202);
  await vi.waitFor(() => expect(store.getDemandRun(result.json().id)?.status).toBe("partial"));
  expect(store.getDemandRun(interrupted.id)).toEqual(before);
});

it.each([{ configured: false, code: 503 }, { busy: true, code: 409 }])("checks recovery dependencies before creating work ($code)", async options => {
  const original = setup();
  original.complete.mockReset().mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response({ selected: [{ fullName: repository.fullName, reason: "A complete application candidate" }], skipped: [] })).mockRejectedValueOnce(new Error("timeout"));
  const failedId = (await original.post()).json().id;
  await vi.waitFor(() => expect(original.store.getDemandRun(failedId)?.status).toBe("failed"));
  const target = setup(options), saved = target.store.createDemandRun(randomUUID(), question, null);
  target.store.checkpointDemandRun(saved.id, original.store.getDemandRun(failedId)!.snapshot!);
  expect((await target.app.inject({ method: "POST", url: `/demands/${saved.id}/resume-evaluation`, payload: { requestId: randomUUID() } })).statusCode).toBe(options.code);
  expect(target.store.listDemandRuns()).toHaveLength(1); expect(target.complete).not.toHaveBeenCalled();
  expect(target.client.findRepositories).not.toHaveBeenCalled();
});

it.each([{ configured: false, code: 503 }, { busy: true, code: 409 }, { runtime: { ...new InProcessRuntimeAdapter(), mode: "iii", engineState: "disconnected" } as unknown as RuntimeAdapter, code: 503 }])("rejects unavailable dependencies before creating a task ($code)", async options => {
  // Use a real close method because spreading a class does not retain prototype methods.
  if (options.runtime) options.runtime.close = async () => {};
  const { post, store, client, complete } = setup(options);
  expect((await post()).statusCode).toBe(options.code);
  expect(store.listDemandRuns()).toEqual([]);
  expect(client.findRepositories).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});

it("reports invalid input and missing history without creating work", async () => {
  const { app, post, store } = setup();
  expect((await post({ question: "?????????????????", requestId: randomUUID() })).statusCode).toBe(400);
  expect((await post({ question, requestId: randomUUID(), retryOf: randomUUID() })).statusCode).toBe(404);
  expect((await app.inject(`/demands/${randomUUID()}`)).statusCode).toBe(404);
  expect(store.listDemandRuns()).toEqual([]);
});

it("checks real sensor certificate errors before spending model calls and allows an explicit retry", async () => {
  const { post, store, client, complete, slot } = setup();
  const cause = Object.assign(new Error("secret-token must not escape"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
  const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
  const sensor = new GitHubClient({ fetcher });
  client.checkSearchAccess.mockImplementation(() => sensor.checkSearchAccess());
  const payload = { question, requestId: randomUUID() };
  const rejected = await post(payload);
  expect(rejected.statusCode).toBe(503);
  expect(rejected.json()).toMatchObject({ error: { code: "github_preflight_failed", message: expect.stringContaining("保留证书校验") } });
  expect(rejected.body).not.toContain("secret-token");
  expect(rejected.json().error.message).toContain("RADAR_GITHUB_CA_FILE");
  expect(store.listDemandRuns()).toEqual([]);
  expect(complete).not.toHaveBeenCalled();
  expect(client.findRepositories).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(slot()).toBeNull();
  client.checkSearchAccess.mockResolvedValue(undefined);
  const accepted = await post(payload);
  expect(accepted.statusCode).toBe(202);
  await vi.waitFor(() => expect(store.getDemandRun(accepted.json().id)?.status).toBe("succeeded"));
  expect((await post(payload)).json().id).toBe(accepted.json().id);
  expect(client.checkSearchAccess).toHaveBeenCalledTimes(2);
});

it("reserves the shared slot during preflight and releases it on failure", async () => {
  const { post, client, complete, store, slot } = setup();
  let reject!: (reason: unknown) => void;
  client.checkSearchAccess.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const requestId = randomUUID();
  const first = post({ question, requestId });
  const pending = first.then(value => value);
  await vi.waitFor(() => expect(slot()).toBe(requestId));
  expect(store.listDemandRuns()).toEqual([]);
  expect((await post({ question, requestId })).statusCode).toBe(409);
  expect((await post({ question: `${question} Player intervention.`, requestId: randomUUID() })).statusCode).toBe(409);
  reject(new Error("network unavailable"));
  expect((await pending).statusCode).toBe(503);
  expect(client.checkSearchAccess).toHaveBeenCalledOnce();
  expect(complete).not.toHaveBeenCalled();
  expect(slot()).toBeNull();
});

it("keeps quota retry information and does not require network for saved evaluation recovery", async () => {
  const { post, app, store, client, complete } = setup();
  complete.mockReset().mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response({ selected: [{ fullName: repository.fullName, reason: "A complete application candidate" }], skipped: [] })).mockRejectedValueOnce(new Error("timeout"));
  const id = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(id)?.status).toBe("failed"));
  const previous = store.getDemandRun(id);
  const retryAt = "2026-10-24T02:00:00.000Z";
  client.checkSearchAccess.mockRejectedValue(new GitHubApiError("quota exhausted", "rate_limited", retryAt));
  expect((await post()).json()).toMatchObject({ error: { code: "github_preflight_failed", retryAt } });
  expect(store.listDemandRuns()).toHaveLength(1);
  client.checkSearchAccess.mockClear();
  complete.mockReset().mockResolvedValueOnce(response({ paths: [], gapQueries: [], conclusion: "No recommendation can be grounded in the saved evidence" }));
  const resumed = await app.inject({ method: "POST", url: `/demands/${id}/resume-evaluation`, payload: { requestId: randomUUID() } });
  expect(resumed.statusCode).toBe(202);
  await vi.waitFor(() => expect(store.getDemandRun(resumed.json().id)?.status).toBe("partial"));
  expect(client.checkSearchAccess).not.toHaveBeenCalled();
  expect(store.getDemandRun(id)).toEqual(previous);
});

it("drains in-flight research before closing a parent-owned store and runtime", async () => {
  const app = Fastify(), store = new RadarStore(":memory:"), runtime = new InProcessRuntimeAdapter();
  let resolve!: (value: ReturnType<typeof response>) => void;
  let slot: string | null = null;
  const complete = vi.fn<CompletionTransport["complete"]>().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValueOnce(response({ queries: [{ query: "broader world", reason: "Broaden the empty initial repository search" }] }));
  await app.register(async child => { registerDemandRoutes(child, { store, runtime, transport: { provider: "codex", model: "fixture", complete }, missingMessage: "", client: () => ({ checkSearchAccess: async () => {}, findRepositories: async () => ({ items: [], total: 0, incomplete: false, observedAt: new Date().toISOString(), query: "agent world simulation" }), collectRepository: async () => repository }), busy: () => Boolean(slot), reserve: value => { slot = value; } }); }, { prefix: "/api/v1" });
  let saved: unknown;
  app.addHook("onClose", async () => { saved = store.listDemandRuns()[0]; await runtime.close(); store.close(); });
  await app.inject({ method: "POST", url: "/api/v1/demands", payload: { question, requestId: randomUUID() } });
  const closing = app.close();
  resolve(response(plan));
  await closing;
  expect(saved).toMatchObject({ status: "partial", snapshot: { stage: "finished" } });
});

it("drains preflight and the research it starts before closing the parent store", async () => {
  const app = Fastify(), store = new RadarStore(":memory:"), runtime = new InProcessRuntimeAdapter();
  let finishCheck!: () => void;
  let slot: string | null = null;
  const checked = vi.fn(() => new Promise<void>(resolve => { finishCheck = resolve; }));
  const complete = vi.fn<CompletionTransport["complete"]>().mockResolvedValueOnce(response(plan)).mockResolvedValueOnce(response({ queries: [{ query: "broader world", reason: "Broaden the empty initial repository search" }] }));
  await app.register(async child => {
    registerDemandRoutes(child, { store, runtime, transport: { provider: "codex", model: "fixture", complete }, missingMessage: "", client: () => ({ checkSearchAccess: checked, findRepositories: async () => ({ items: [], total: 0, incomplete: false, observedAt: new Date().toISOString(), query: "agent world" }), collectRepository: async () => repository }), busy: () => Boolean(slot), reserve: value => { slot = value; } });
  }, { prefix: "/api/v1" });
  let saved: unknown;
  app.addHook("onClose", async () => { saved = store.listDemandRuns()[0]; await runtime.close(); store.close(); });
  const submitting = app.inject({ method: "POST", url: "/api/v1/demands", payload: { question, requestId: randomUUID() } }).then(value => value);
  await vi.waitFor(() => expect(checked).toHaveBeenCalledOnce());
  const closing = app.close();
  finishCheck();
  expect((await submitting).statusCode).toBe(202);
  await closing;
  expect(saved).toMatchObject({ status: "partial", snapshot: { stage: "finished" } });
  expect(slot).toBeNull();
});

it("continues a completed task with shared locking, canonical idempotency, new usage and immutable parent history", async () => {
  const { app, post, store, complete, client, slot } = setup();
  const parentId = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(parentId)?.status).toBe("succeeded"));
  const original = store.getDemandRun(parentId), requestId = randomUUID();
  let resolve!: (value: ReturnType<typeof response>) => void;
  complete.mockReset().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockRejectedValueOnce(new Error("Assessment unavailable"));
  const payload = { requestId, projectIds: ["77"], capabilityIds: ["world"] };
  const send = (body = payload) => app.inject({ method: "POST", url: `/demands/${parentId}/continue`, payload: body });
  const started = await send(); expect(started.statusCode).toBe(202);
  const childId = started.json().id;
  expect(slot()).toBe(childId);
  expect((await send()).json().id).toBe(childId);
  expect((await send({ ...payload, requestId: randomUUID() })).json().id).toBe(childId);
  expect((await send({ ...payload, capabilityIds: ["other"] })).statusCode).toBe(409);
  expect((await post()).statusCode).toBe(409);
  resolve(response({ files: [{ projectId: "77", path: "engine.py", reason: "Inspect actual world state mutations" }] }));
  await vi.waitFor(() => expect(store.getDemandRun(childId)?.status).toBe("failed"));
  expect(slot()).toBeNull(); expect(complete).toHaveBeenCalledTimes(2);
  expect(client.findRepositories).toHaveBeenCalledOnce();
  expect(client.sourceInventory).toHaveBeenCalledOnce(); expect(client.sourceText).toHaveBeenCalledOnce();
  const detail = (await app.inject(`/demands/${childId}`)).json();
  expect(detail).toMatchObject({ continuationOf: parentId, retryOf: null, error: "Assessment unavailable", snapshot: { sourceStudy: { parentId }, sources: expect.arrayContaining([expect.objectContaining({ field: "code", path: "engine.py" })]) } });
  expect((await app.inject(`/demands/${childId}/report.json`)).json()).toEqual(detail);
  expect(store.getDemandRun(parentId)).toEqual(original);
  expect((await app.inject({ method: "POST", url: `/demands/${childId}/continue`, payload: { ...payload, requestId: randomUUID() } })).statusCode).toBe(400);
  expect((await send()).statusCode).toBe(200);
  expect((await app.inject("/demands/features")).json()).toEqual({ sourceStudy: true, sourceResume: true, evaluationResume: true, fallbackEvaluationResume: true, gapResume: true, selectionResume: true, researchNotes: true, researchVersion: "demand-research-v5" });
});

it("refuses invalid continuation scope before acquiring files or calling the model", async () => {
  const { app, post, store, client, complete } = setup(), parentId = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(parentId)?.status).toBe("succeeded"));
  const calls = complete.mock.calls.length;
  for (const scope of [{ projectIds: ["unknown"], capabilityIds: ["world"] }, { projectIds: ["77"], capabilityIds: ["unknown"] }, { projectIds: ["77", "77"], capabilityIds: ["world"] }]) {
    const result = await app.inject({ method: "POST", url: `/demands/${parentId}/continue`, payload: { ...scope, requestId: randomUUID() } });
    expect(result.statusCode).toBe(400);
  }
  expect(store.listDemandRuns()).toHaveLength(1);
  expect(complete.mock.calls).toHaveLength(calls); expect(client.sourceInventory).not.toHaveBeenCalled();
});

it("allows a truncated source path to be read again while excluding a fully read path", async () => {
  const { app, post, store, complete, client } = setup(), parentId = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(parentId)?.status).toBe("succeeded"));
  const parent = store.getDemandRun(parentId)!;
  const prior = store.createSourceDemandRun(randomUUID(), parentId, { projectIds: ["77"], capabilityIds: ["world"] });
  const commitSha = "a".repeat(40), sha = "b".repeat(40), base = parent.snapshot!;
  store.checkpointDemandRun(prior.id, {
    ...base, version: "demand-source-v1", status: "succeeded", stage: "finished",
    sourceStudy: { parentId, input: { projectIds: ["77"], capabilityIds: ["world"] }, charsRead: 2, findings: [],
      inventories: [{ projectId: "77", status: "succeeded", error: null, inventory: { fullName: repository.fullName, commitSha, observedAt: "2026-10-23T00:00:00Z", complete: true, warnings: [], files: [{ path: "engine.py", sha, size: 20 }, { path: "complete.py", sha, size: 20 }] } }],
      files: [{ projectId: "77", path: "engine.py", reason: "Read prefix", status: "succeeded", error: null }, { projectId: "77", path: "complete.py", reason: "Read full file", status: "succeeded", error: null }] },
    sources: [...base.sources,
      { id: "77:code:1", projectId: "77", field: "code", path: "engine.py", sha, commitSha, url: "https://github.com/sample/world", observedAt: "2026-10-23T00:00:00Z", content: "prefix", notice: "truncated", startLine: 1, endLine: 1, totalLines: 2, truncated: true },
      { id: "77:code:2", projectId: "77", field: "code", path: "complete.py", sha, commitSha, url: "https://github.com/sample/world", observedAt: "2026-10-23T00:00:00Z", content: "complete", notice: "complete", startLine: 1, endLine: 1, totalLines: 1, truncated: false }],
  });
  client.sourceInventory.mockResolvedValueOnce({ fullName: repository.fullName, commitSha, observedAt: "2026-10-23T00:00:00Z", complete: true, warnings: [], files: [{ path: "engine.py", sha, size: 20 }, { path: "complete.py", sha, size: 20 }] });
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "77", path: "engine.py", reason: "Read the previously truncated remainder" }] })).mockRejectedValueOnce(new Error("Assessment unavailable"));

  const result = await app.inject({ method: "POST", url: `/demands/${parentId}/continue`, payload: { requestId: randomUUID(), projectIds: ["77"], capabilityIds: ["world"] } });
  expect(result.statusCode).toBe(202);
  await vi.waitFor(() => expect(store.getDemandRun(result.json().id)?.status).toBe("failed"));
  expect(store.getDemandRun(result.json().id)?.error).toBe("Assessment unavailable");
  const selection = complete.mock.calls[0]![1] as { previouslyRead: string[] };
  expect(selection.previouslyRead).toContain("77:complete.py");
  expect(selection.previouslyRead).not.toContain("77:engine.py");
  expect(client.sourceText).toHaveBeenCalledOnce();
  expect(client.sourceText).toHaveBeenCalledWith(expect.anything(), "engine.py", expect.any(Number), 2);
  expect(store.getDemandRun(result.json().id)?.snapshot?.sourceStudy?.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: "engine.py", status: "succeeded" })]));
});

it("resumes captured source analysis once, preserves both histories and rejects conflicting requests", async () => {
  const { app, post, store, complete, client } = setup(), parentId = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(parentId)?.status).toBe("succeeded"));
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "77", path: "engine.py", reason: "Inspect actual state writes" }] })).mockRejectedValueOnce(new Error("Assessment timeout"));
  const failedId = (await app.inject({ method: "POST", url: `/demands/${parentId}/continue`, payload: { requestId: randomUUID(), projectIds: ["77"], capabilityIds: ["world"] } })).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(failedId)?.status).toBe("failed"));
  const original = store.getDemandRun(parentId), failed = store.getDemandRun(failedId);
  let releaseAssessment!: () => void;
  const assessmentGate = new Promise<void>(resolve => { releaseAssessment = resolve; });
  complete.mockReset().mockImplementationOnce(async () => {
    await assessmentGate;
    return response({ findings: [{ projectId: "77", capabilityId: "world", conclusion: "Only the source prefix was read, behavior remains uncertain.", chain: ["definition", "write", "decision", "action", "persistence"].map(step => ({ step, status: "not_read", note: "No complete behavioral chain verified.", evidence: [] })) }] });
  })
    .mockResolvedValueOnce(response({ evaluation: { paths: [], gapQueries: [], conclusion: "Still insufficient evidence for a recommendation." }, review: { reviews: [], recommendedPathId: null, conclusion: "Test actual world actions and save/restore before adoption." } }));
  client.sourceInventory.mockClear(); client.sourceText.mockClear(); client.findRepositories.mockClear();
  const requestId = randomUUID(), send = (id: string = requestId) => app.inject({ method: "POST", url: `/demands/${failedId}/resume-source`, payload: { requestId: id } });
  const resumed = await send(); expect(resumed.statusCode).toBe(202);
  const id = resumed.json().id;
  expect((await send()).json().id).toBe(id);
  const deduplicated = await send(randomUUID());
  expect(deduplicated.statusCode).toBe(202); expect(deduplicated.json().id).toBe(id);
  expect(store.getDemandRun(id)?.status).toBe("running");
  expect((await app.inject({ method: "POST", url: "/demands", payload: { requestId: randomUUID(), question } })).statusCode).toBe(409);
  expect((await send(original!.requestId)).statusCode).toBe(409);
  expect((await app.inject({ method: "POST", url: `/demands/${parentId}/resume-source`, payload: { requestId: randomUUID() } })).statusCode).toBe(400);
  releaseAssessment();
  await vi.waitFor(() => expect(store.getDemandRun(id)?.status).toBe("succeeded"));
  expect(store.getDemandRun(id)).toMatchObject({ continuationOf: parentId, retryOf: failedId, snapshot: { sourceStudy: { resumedFrom: failedId }, calls: [expect.objectContaining({ stage: "source_assessment", status: "succeeded" }), expect.objectContaining({ stage: "source_synthesis", status: "succeeded" })] } });
  expect(complete).toHaveBeenCalledTimes(2); expect(client.sourceInventory).not.toHaveBeenCalled(); expect(client.sourceText).not.toHaveBeenCalled(); expect(client.findRepositories).not.toHaveBeenCalled();
  expect(store.getDemandRun(parentId)).toEqual(original); expect(store.getDemandRun(failedId)).toEqual(failed);
  expect((await send()).statusCode).toBe(200);
});

it("can continue an interrupted task without rewriting its last running snapshot", async () => {
  const { app, post, store, complete } = setup(), successfulId = (await post()).json().id;
  await vi.waitFor(() => expect(store.getDemandRun(successfulId)?.status).toBe("succeeded"));
  const interrupted = store.createDemandRun(randomUUID(), question, null);
  store.checkpointDemandRun(interrupted.id, { ...store.getDemandRun(successfulId)!.snapshot!, stage: "reviewing", status: "running" });
  store.recoverInterruptedRuns(); const original = store.getDemandRun(interrupted.id);
  complete.mockReset().mockRejectedValueOnce(new Error("Selection failed"));
  const result = await app.inject({ method: "POST", url: `/demands/${interrupted.id}/continue`, payload: { requestId: randomUUID(), projectIds: ["77"], capabilityIds: ["world"] } });
  expect(result.statusCode).toBe(202);
  await vi.waitFor(() => expect(store.getDemandRun(result.json().id)?.status).toBe("failed"));
  expect(store.getDemandRun(interrupted.id)).toEqual(original);
});
