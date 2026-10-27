import { afterEach, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { RadarStore } from "@radar/storage";
import { InProcessRuntimeAdapter } from "@radar/runtime";
import { GitHubApiError, type GitHubRepository } from "@radar/sensor-github";
import { registerComponentRoutes } from "./components.js";

const repository: GitHubRepository = {
  id: 77, fullName: "sample/component", description: "An interface for local data workflows", language: "Python", license: "MIT", stars: 20, forks: 1, openIssues: 0,
  createdAt: "2020-01-01T00:00:00Z", pushedAt: "2026-10-20T00:00:00Z", url: "https://github.com/sample/component", readmeExcerpt: "The existing interface accepts local files.",
  releaseTag: "v1", releaseUrl: null, readmeFetchSucceeded: true, releaseFetchSucceeded: true,
  issues: [], issuesFetchSucceeded: true, issuesFetchedAt: "2026-10-20T00:00:00Z", discoveryChannels: ["按需收录"], raw: { id: 77 }, warning: null,
};
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
function setup() {
  const app = Fastify();
  const store = new RadarStore(":memory:");
  const runtime = new InProcessRuntimeAdapter();
  const client = { findRepositories: vi.fn(async (query: string) => ({ query, items: [{ ...repository, archived: false, fork: false }], total: 1, incomplete: false, observedAt: "2026-10-20T00:00:00Z" })), collectRepository: vi.fn(async () => ({ ...repository })) };
  let operation: string | null = null;
  const deps = { store, runtime, client: () => client, busy: () => operation !== null, collection: (value: string | null) => { operation = value; } };
  registerComponentRoutes(app, deps);
  cleanup.push(async () => { await app.close(); store.close(); });
  return { app, store, runtime, client, deps };
}

it("previews external matches without creating projects, analyses or opportunities", async () => {
  const { app, store, runtime } = setup();
  const response = await app.inject({ method: "POST", url: "/components/search", payload: { query: "local data interface" } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ items: [{ collected: false }], total: 1 });
  expect(store.getProjects()).toEqual([]);
  expect(store.listAnalysisRuns()).toEqual([]);
  expect(store.getOpportunities()).toEqual([]);
  expect(runtime.completedExecutions).toBe(1);
});

it("imports real-shaped evidence through W2A storage and refreshes an existing project without a model run", async () => {
  const { app, store, client } = setup();
  const first = await app.inject({ method: "POST", url: "/components/import", payload: { repository: "https://github.com/sample/component.git" } });
  expect(first.statusCode).toBe(200);
  expect(first.json()).toMatchObject({ id: "77", existing: false, warning: null });
  expect(client.collectRepository).toHaveBeenCalledWith("sample/component");
  const project = store.getProject("77")!;
  expect(project).toMatchObject({ readmeExcerpt: repository.readmeExcerpt, discoveryChannels: ["按需收录"] });
  const second = await app.inject({ method: "POST", url: "/components/import", payload: { repository: "sample/component" } });
  expect(second.json().existing).toBe(true);
  expect(store.getProjects()).toHaveLength(1);
  expect(store.listAnalysisRuns()).toEqual([]);
  expect(store.listScanRuns()).toEqual([]);
  const search = await app.inject({ method: "POST", url: "/components/search", payload: { query: "interface" } });
  expect(search.json().items[0].collected).toBe(true);
});

it("reports partial collection while preserving previously fetched evidence", async () => {
  const { app, store, client } = setup();
  await app.inject({ method: "POST", url: "/components/import", payload: { repository: "sample/component" } });
  client.collectRepository.mockResolvedValueOnce({ ...repository, readmeExcerpt: null, readmeFetchSucceeded: false, releaseTag: null, releaseFetchSucceeded: false, warning: "README unavailable" });
  const response = await app.inject({ method: "POST", url: "/components/import", payload: { repository: "sample/component" } });
  expect(response.json().warning).toBe("README unavailable");
  expect(store.getProject("77")?.readmeExcerpt).toBe(repository.readmeExcerpt);
  expect(store.getProject("77")?.releaseTag).toBe("v1");
});

it("rejects invalid input before acquiring a job or calling GitHub", async () => {
  const { app, client, runtime } = setup();
  for (const [url, payload] of [["/components/search", { query: "x" }], ["/components/import", { repository: "https://external.example/a/b" }], ["/components/import", { repository: "sample/component", extra: true }]] as const) {
    expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(400);
  }
  expect(client.findRepositories).not.toHaveBeenCalled();
  expect(client.collectRepository).not.toHaveBeenCalled();
  expect(runtime.completedExecutions).toBe(0);
});

it("holds the shared job slot across the asynchronous collection and releases it after failure", async () => {
  const { app, client } = setup();
  let rejectSearch!: (reason: Error) => void;
  client.findRepositories.mockImplementationOnce(() => new Promise((_, reject) => { rejectSearch = reject; }));
  const first = app.inject({ method: "POST", url: "/components/search", payload: { query: "interface" } });
  const firstResult = first.then((response) => response);
  await vi.waitFor(() => expect(client.findRepositories).toHaveBeenCalledOnce());
  const concurrent = await app.inject({ method: "POST", url: "/components/import", payload: { repository: "sample/component" } });
  expect(concurrent.statusCode).toBe(409);
  rejectSearch(new GitHubApiError("quota exhausted", "rate_limited", "2026-10-20T00:00:00Z"));
  expect((await firstResult).json()).toMatchObject({ error: { code: "rate_limited", retryAt: "2026-10-20T00:00:00Z" } });
  expect((await app.inject({ method: "POST", url: "/components/import", payload: { repository: "sample/component" } })).statusCode).toBe(200);
});

it("preserves upstream not-found and query failures instead of reporting a successful empty result", async () => {
  const { app, client, store } = setup();
  client.collectRepository.mockRejectedValueOnce(new GitHubApiError("not found", "not_found"));
  expect((await app.inject({ method: "POST", url: "/components/import", payload: { repository: "sample/missing" } })).statusCode).toBe(404);
  client.findRepositories.mockRejectedValueOnce(new GitHubApiError("bad query", "bad_query"));
  expect((await app.inject({ method: "POST", url: "/components/search", payload: { query: "bad query" } })).statusCode).toBe(422);
  expect(store.getProjects()).toEqual([]);
});
