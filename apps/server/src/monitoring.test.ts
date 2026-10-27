import { afterEach, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { RadarStore } from "@radar/storage";
import { createRepositorySignal, createIssueContextSignal, type IssueContext } from "@radar/contracts";
import { InProcessRuntimeAdapter } from "@radar/runtime";
import { GitHubApiError, type GitHubRepository } from "@radar/sensor-github";
import { registerMonitoringRoutes } from "./monitoring.js";
import { registerComponentRoutes } from "./components.js";

const close: Array<() => Promise<void>> = [];
afterEach(async () => { for (const item of close.splice(0)) await item(); });
const baseline = "2026-10-20T00:00:00.000Z";
function context(number = 7): IssueContext {
  return { issue: { id: number, number, title: `Discussion ${number}`, bodyExcerpt: "An existing workflow needs investigation", url: `https://github.com/fixture/component-1/issues/${number}`, state: "open", stateReason: null, closedAt: null, createdAt: baseline, updatedAt: baseline, comments: 0, reactions: 0, authorAssociation: "NONE", bodyTruncated: false }, comments: [], commentsComplete: true, commentsError: null, commentsObservedAt: baseline, observedAt: baseline };
}
function repository(id = 1): GitHubRepository {
  return { id, fullName: `fixture/component-${id}`, description: "A local data interface", language: "Python", license: "MIT", stars: 10, forks: 1, openIssues: 0, createdAt: baseline, pushedAt: baseline, url: `https://github.com/fixture/component-${id}`, readmeExcerpt: "Accepts local CSV files", releaseTag: "v1", releaseUrl: null, raw: { id }, warning: null, readmeFetchSucceeded: true, releaseFetchSucceeded: true, issuesFetchSucceeded: true, issues: [7, 8, 9, 10].map((number) => context(number).issue), issuesFetchedAt: baseline };
}
function setup() {
  const store = new RadarStore(":memory:"), runtime = new InProcessRuntimeAdapter(), app = Fastify();
  for (const id of [1, 2, 3]) { const item = repository(id); store.saveRepository(item, createRepositorySignal({ repositoryId: id, ...item }), 0, [], [], baseline); }
  let busy = false, clock = "2026-10-20T12:00:00.000Z";
  const client = { collectRepository: vi.fn(async (name: string): Promise<GitHubRepository> => ({ ...repository(Number(name.split("-").at(-1))), stars: 15, releaseTag: "v2" })), collectIssueContext: vi.fn(async (_name: string, number: number): Promise<IssueContext> => context(number)), findRepositories: vi.fn(async () => ({ query: "fixture", items: [], total: 0, incomplete: false, observedAt: clock })) };
  const deps = { store, runtime, client: () => client, busy: () => busy, collection: (value: string | null) => { busy = value !== null; }, now: () => new Date(clock), scheduled: false };
  const manager = registerMonitoringRoutes(app, deps); registerComponentRoutes(app, deps);
  close.push(async () => { await manager.stop(); await app.close(); store.close(); });
  return { app, store, client, manager, runtime, setBusy: (value: boolean) => { busy = value; }, setTime: (value: string) => { clock = value; } };
}
const put = (app: ReturnType<typeof Fastify>, id = "1", enabled = true) => app.inject({ method: "PUT", url: `/projects/${id}/monitor`, payload: { enabled } });
const refresh = (app: ReturnType<typeof Fastify>, id = "1") => app.inject({ method: "POST", url: `/projects/${id}/refresh`, payload: {} });
it("does not enroll projects implicitly, and validates opt-in without contacting GitHub", async () => {
  const { app, client, manager, store } = setup();
  expect((await manager.runDue()).attempted).toBe(0); expect((await app.inject("/monitoring")).json().items).toEqual([]);
  expect((await put(app)).json()).toMatchObject({ enabled: true, status: "idle" });
  expect((await put(app)).statusCode).toBe(200); expect(store.listProjectMonitors()).toHaveLength(1);
  expect((await app.inject({ method: "PUT", url: "/projects/1/monitor", payload: { enabled: "yes" } })).statusCode).toBe(400);
  expect((await put(app, "999")).statusCode).toBe(404); expect(client.collectRepository).not.toHaveBeenCalled();
});
it("refreshes followed projects independently of discovery, with a two-project budget and no model or scan", async () => {
  const { app, manager, store, runtime, client } = setup(); for (const id of ["1", "2", "3"]) await put(app, id);
  expect(await manager.runDue()).toEqual({ attempted: 2 });
  expect(store.getProject("1")?.stars).toBe(15); expect(store.getProject("3")?.stars).toBe(10);
  expect(store.getProjectMonitor("1")).toMatchObject({ status: "succeeded", nextDueAt: "2026-10-21T12:00:00.000Z", changes: { stars: 5, releaseBefore: "v1", releaseAfter: "v2" } });
  expect(await manager.runDue()).toEqual({ attempted: 1 }); expect(await manager.runDue()).toEqual({ attempted: 0 });
  expect(client.collectRepository).toHaveBeenCalledTimes(3); expect(runtime.completedExecutions).toBe(3);
  expect(store.listAnalysisRuns()).toEqual([]); expect(store.listScanRuns()).toEqual([]); expect(store.getOpportunities()).toEqual([]);
});
it("manual refresh works without enabling automatic monitoring", async () => {
  const { app, store } = setup(); expect((await refresh(app)).statusCode).toBe(200);
  expect(store.getProjectMonitor("1")).toMatchObject({ enabled: false, status: "succeeded" }); expect(store.listProjectMonitors()).toEqual([]);
  expect((await app.inject({ method: "POST", url: "/projects/1/refresh", payload: { url: "https://elsewhere.invalid" } })).statusCode).toBe(400);
});
it("retains evidence after a partial fetch and schedules an earlier retry", async () => {
  const { app, store, client } = setup(); await put(app);
  client.collectRepository.mockResolvedValueOnce({ ...repository(), stars: 15, releaseTag: null, readmeExcerpt: null, readmeFetchSucceeded: false, releaseFetchSucceeded: false, warning: "README and release fetch failed" });
  expect((await refresh(app)).json()).toMatchObject({ status: "partial", nextDueAt: "2026-10-20T13:00:00.000Z", changes: { releaseBefore: "v1", releaseAfter: "v1", readmeChanged: false } });
  expect(store.getProject("1")).toMatchObject({ readmeExcerpt: repository().readmeExcerpt, releaseTag: "v1", stars: 15 });
});
it("keeps a failed target visible, releases the slot and preserves old evidence", async () => {
  const { app, store, client } = setup(); await put(app); const before = store.getProject("1");
  client.collectRepository.mockRejectedValueOnce(new GitHubApiError("not found", "not_found"));
  expect((await refresh(app)).statusCode).toBe(404); expect(store.getProject("1")).toEqual(before);
  expect(store.getProjectMonitor("1")).toMatchObject({ status: "failed", enabled: true, errorCode: "not_found", nextDueAt: "2026-10-20T13:00:00.000Z" });
  expect((await refresh(app)).statusCode).toBe(200);
});
it("holds the shared slot while fetching and cancellation does not get undone by completion", async () => {
  const { app, store, client, manager, setBusy } = setup(); await put(app);
  setBusy(true); expect(await manager.runDue()).toEqual({ attempted: 0 }); expect((await refresh(app)).statusCode).toBe(409); setBusy(false);
  let finish!: (value: GitHubRepository) => void; client.collectRepository.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  const request = Promise.resolve(refresh(app)); await vi.waitFor(() => expect(client.collectRepository).toHaveBeenCalledOnce());
  expect((await app.inject({ method: "POST", url: "/components/search", payload: { query: "fixture" } })).statusCode).toBe(409);
  await put(app, "1", false); finish(repository()); expect((await request).statusCode).toBe(200); expect(store.getProjectMonitor("1")?.enabled).toBe(false);
});
it("respects one shared persisted rate-limit pause and stops the remaining batch", async () => {
  const { app, store, client, manager, setTime } = setup(); await put(app); await put(app, "2");
  client.collectRepository.mockRejectedValueOnce(new GitHubApiError("quota exhausted", "rate_limited", "2026-10-20T13:30:00.000Z"));
  expect(await manager.runDue()).toEqual({ attempted: 1 }); expect(await manager.runDue()).toEqual({ attempted: 0 });
  expect((await refresh(app, "2")).statusCode).toBe(429); expect(client.collectRepository).toHaveBeenCalledTimes(1);
  expect(store.monitoringPausedUntil("2026-10-20T12:05:00.000Z")).toBe("2026-10-20T13:30:00.000Z");
  await put(app, "1", false); await put(app, "1", true);
  expect(store.monitoringPausedUntil("2026-10-20T12:05:00.000Z")).toBe("2026-10-20T13:30:00.000Z");
  expect(await manager.runDue()).toEqual({ attempted: 0 });
  setTime("2026-10-20T13:31:00.000Z"); expect(await manager.runDue()).toEqual({ attempted: 2 });
});
it("rejects an old repository name being reused for a different repository ID", async () => {
  const { app, store, client } = setup(); const before = store.getProject("1");
  client.collectRepository.mockResolvedValueOnce({ ...repository(999), fullName: repository().fullName });
  expect((await refresh(app)).statusCode).toBe(502); expect(store.getProject("1")).toEqual(before); expect(store.getProject("999")).toBeNull();
});

const watch = (app: ReturnType<typeof Fastify>, number = 7, enabled = true) => app.inject({ method: "PUT", url: `/projects/1/monitor/issues/${number}`, payload: { enabled } });
const acknowledge = (app: ReturnType<typeof Fastify>, changeId: string) => app.inject({ method: "POST", url: "/projects/1/monitor/issues/7/acknowledge", payload: { changeId } });
it("requires a separate project opt-in, only accepts collected discussions, and bounds explicit selections", async () => {
  const { app, store, client, manager } = setup();
  expect((await watch(app)).json()).toMatchObject({ enabled: false, issues: [{ number: 7, status: "pending", fingerprint: null }] });
  expect(await manager.runDue()).toEqual({ attempted: 0 }); expect(client.collectIssueContext).not.toHaveBeenCalled();
  await watch(app); await watch(app, 8); await watch(app, 9);
  expect((await watch(app, 10)).statusCode).toBe(409); expect((await watch(app, 999)).statusCode).toBe(400);
  expect(store.getProjectMonitor("1")?.issues).toHaveLength(3);
  await watch(app, 8, false); expect((await watch(app, 10)).statusCode).toBe(200);
  expect(store.listProjectMonitors()).toEqual([]); expect(store.listAnalysisRuns()).toEqual([]);
});
it("establishes the first remote baseline and ignores observation time or newly available empty PR metadata", async () => {
  const { app, store, client } = setup(); await watch(app); await refresh(app);
  expect(store.getProjectMonitor("1")?.issues[0]).toMatchObject({ status: "baseline", unreadChange: false });
  client.collectIssueContext.mockResolvedValueOnce({ ...context(), observedAt: "2026-10-21T00:00:00.000Z", commentsObservedAt: "2026-10-21T00:00:00.000Z", commentSampling: "all", referencedPullRequests: { checkedNumbers: [], notFoundNumbers: [], omitted: 0, items: [], errors: [] } });
  await refresh(app); expect(store.getProjectMonitor("1")?.issues[0]).toMatchObject({ status: "unchanged", unreadChange: false });
  expect(client.collectIssueContext).toHaveBeenCalledWith(repository().fullName, 7, { throwOnRateLimit: true });
});
it("compares to a previously collected closed or open discussion, retains unread changes across checks and disabling, and rejects stale acknowledgements", async () => {
  const { app, store, client } = setup(); const original = context();
  store.saveIssueContext("1", original, createIssueContextSignal("1", repository().fullName, original)); await watch(app); await put(app);
  const changed: IssueContext = { ...original, issue: { ...original.issue, state: "closed", stateReason: "completed", closedAt: "2026-10-20T12:00:00.000Z" } };
  client.collectIssueContext.mockResolvedValue(changed); await refresh(app);
  const first = store.getProjectMonitor("1")!.issues[0]!;
  expect(first).toMatchObject({ status: "changed", unreadChange: true, changeDescription: "状态 open → closed" });
  await refresh(app); expect(store.getProjectMonitor("1")?.issues[0]).toMatchObject({ status: "unchanged", unreadChange: true, changeId: first.changeId });
  await put(app, "1", false); expect((await app.inject("/monitoring")).json().discussionChanges).toHaveLength(1);
  client.collectIssueContext.mockResolvedValue({ ...changed, issue: { ...changed.issue, reactions: 3 } }); await refresh(app);
  expect((await acknowledge(app, first.changeId!)).statusCode).toBe(409);
  const latest = store.getProjectMonitor("1")!.issues[0]!; expect((await acknowledge(app, latest.changeId!)).statusCode).toBe(200);
  expect((await app.inject("/monitoring")).json().discussionChanges).toEqual([]);
  expect(store.getProject("1")?.issueContexts?.["7"]?.issue.state).toBe("closed"); expect(store.listAnalysisRuns()).toEqual([]);
});
it("keeps a failed discussion and its comparison baseline visible, retries partial fetches, and detects recovery changes", async () => {
  const { app, store, client } = setup(); await watch(app); await refresh(app);
  const before = store.getProject("1")?.issueContexts?.["7"], fingerprint = store.getProjectMonitor("1")!.issues[0]!.fingerprint;
  client.collectIssueContext.mockRejectedValueOnce(new GitHubApiError("discussion deleted", "not_found"));
  expect((await refresh(app)).json()).toMatchObject({ status: "partial", nextDueAt: "2026-10-20T13:00:00.000Z" });
  expect(store.getProject("1")?.issueContexts?.["7"]).toEqual(before);
  expect(store.getProjectMonitor("1")?.issues[0]).toMatchObject({ status: "failed", fingerprint, unreadChange: false });
  client.collectIssueContext.mockResolvedValueOnce({ ...context(), commentsError: "comments timed out", commentsComplete: false }); await refresh(app);
  expect(store.getProjectMonitor("1")?.issues[0]).toMatchObject({ status: "partial", fingerprint, unreadChange: false });
  client.collectIssueContext.mockResolvedValueOnce({ ...context(), referencedPullRequests: { checkedNumbers: [55], omitted: 0, notFoundNumbers: [], items: [], errors: [{ number: 55, message: "PR timed out" }] } }); await refresh(app);
  expect(store.getProjectMonitor("1")?.issues[0]).toMatchObject({ status: "partial", fingerprint, unreadChange: false });
  client.collectIssueContext.mockResolvedValueOnce({ ...context(), issue: { ...context().issue, bodyExcerpt: "The implementation now exists; investigate remaining work." } }); await refresh(app);
  expect(store.getProjectMonitor("1")?.issues[0]).toMatchObject({ status: "changed", unreadChange: true, error: null });
});
it("stops the shared queue on a discussion rate limit after saving the successfully refreshed repository", async () => {
  const { app, store, client, manager } = setup(); await watch(app); await put(app); await put(app, "2");
  client.collectIssueContext.mockRejectedValueOnce(new GitHubApiError("quota exhausted", "rate_limited", "2026-10-20T14:00:00.000Z"));
  expect(await manager.runDue()).toEqual({ attempted: 1 }); expect(client.collectRepository).toHaveBeenCalledTimes(1);
  expect(store.getProject("1")?.stars).toBe(15); expect(store.getProjectMonitor("1")).toMatchObject({ status: "failed", errorCode: "rate_limited" });
  expect(store.getProjectMonitor("1")?.issues[0]).toMatchObject({ status: "failed", unreadChange: false });
  await watch(app, 8); expect((await refresh(app, "2")).statusCode).toBe(429);
  expect(store.monitoringPausedUntil("2026-10-20T12:00:00.000Z")).toBe("2026-10-20T14:00:00.000Z");
});
it("does not start selected discussions after cancellation during the repository request", async () => {
  const { app, client, store } = setup(); await watch(app); await put(app);
  let finish!: (item: GitHubRepository) => void;
  client.collectRepository.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  const request = Promise.resolve(refresh(app)); await vi.waitFor(() => expect(client.collectRepository).toHaveBeenCalledOnce());
  await put(app, "1", false); finish(repository()); await request;
  expect(client.collectIssueContext).not.toHaveBeenCalled(); expect(store.getProjectMonitor("1")?.enabled).toBe(false);
});
it("does not let an in-flight result overwrite a removed and re-added discussion subscription", async () => {
  const { app, client, store } = setup(); await watch(app);
  let finish!: (item: IssueContext) => void;
  client.collectIssueContext.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  const request = Promise.resolve(refresh(app)); await vi.waitFor(() => expect(client.collectIssueContext).toHaveBeenCalledOnce());
  const oldId = store.getProjectMonitor("1")!.issues[0]!.id; await watch(app, 7, false); await watch(app);
  finish(context()); await request;
  const selected = store.getProjectMonitor("1")!.issues[0]!;
  expect(selected.id).not.toBe(oldId); expect(selected).toMatchObject({ status: "pending", lastCheckedAt: null, unreadChange: false });
});
