import { expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createRepositorySignal, type IssueContext } from "@radar/contracts";
import { GitHubApiError } from "@radar/sensor-github";
import { RadarStore } from "@radar/storage";
import { InProcessRuntimeAdapter } from "@radar/runtime";
import { registerIssueContextRoute, selectedIssueNumber } from "./issue-context.js";

it("restricts explicit selection to a positive number or the same repository Issue URL", () => {
  for (const value of [18, "18", "#18", "https://github.com/SAMPLE/editor/issues/18#issuecomment-9"]) expect(selectedIssueNumber(value, "sample/editor")).toBe(18);
  for (const value of [0, -1, 1.5, "9007199254740992", "https://github.com/other/editor/issues/18", "https://github.com/sample/editor/pull/18", "http://127.0.0.1/issues/18", "https://github.com.evil.test/sample/editor/issues/18", "https://user@github.com/sample/editor/issues/18", "file:///sample/editor/issues/18"]) expect(selectedIssueNumber(value, "sample/editor")).toBeNull();
});

it("collects a closed discussion beyond the recent sample, survives resampling and preserves the selection on refresh", async () => {
  const app = Fastify(), store = new RadarStore(":memory:"), runtime = new InProcessRuntimeAdapter();
  const item = { id: 42, fullName: "sample/editor", description: null, url: "https://github.com/sample/editor", language: "Rust", license: "MIT", stars: 0, forks: 0, openIssues: 1, createdAt: "2026-10-01T00:00:00Z", pushedAt: null, readmeExcerpt: null, releaseTag: null, releaseUrl: null, raw: { id: 42 }, warning: null };
  const issue = { id: 18, number: 18, title: "Split a recurring merchant order across categories", bodyExcerpt: "Every month I manually split the items on many orders.", url: `${item.url}/issues/18`, state: "closed" as const, createdAt: item.createdAt, updatedAt: item.createdAt, comments: 0, reactions: 0, authorAssociation: "NONE" };
  store.saveRepository({ ...item, issues: [], issuesFetchSucceeded: true }, createRepositorySignal({ repositoryId: 42, ...item, issues: [] }), 0, [], [], item.createdAt);
  const context: IssueContext = { issue: { ...issue, bodyTruncated: false, stateReason: "completed", closedAt: issue.updatedAt }, comments: [], commentsComplete: true, commentsError: null, commentsObservedAt: item.createdAt, observedAt: "2026-10-20T00:00:00Z" };
  let operation: string | null = null;
  const client = { collectIssueContext: vi.fn(async (_name: string, number: number) => { expect(operation).toBe(`issue:42:${number}`); if (number === 19) throw new GitHubApiError("Missing Issue", "not_found"); return context; }) };
  registerIssueContextRoute(app, { store, runtime, client: () => client, busy: () => operation !== null, collection: (value) => { operation = value; } });
  const collect = (payload: { issue: string | number; force?: boolean }) => app.inject({ method: "POST", url: "/projects/42/issues/import", payload });
  try {
    expect((await collect({ issue: "https://github.com/other/editor/issues/18" })).statusCode).toBe(400);
    expect((await collect({ issue: 18, force: true })).statusCode).toBe(400);
    expect(client.collectIssueContext).not.toHaveBeenCalled();
    operation = "scan"; expect((await collect({ issue: 18 })).statusCode).toBe(409); operation = null;
    expect((await collect({ issue: "#18" })).json()).toMatchObject({ selectedForResearch: true, issue: { number: 18, state: "closed" } });
    expect(store.getProject("42")?.issues?.map((issue) => issue.number)).toEqual([18]);
    expect(store.dashboard().issueSampleCount).toBe(1);
    const latest = { ...item, issues: [{ ...issue, id: 20, number: 20 }], issuesFetchSucceeded: true };
    store.saveRepository(latest, createRepositorySignal({ repositoryId: 42, ...latest }), 0, [], [], "2026-10-21T00:00:00Z");
    expect(store.getProject("42")?.issues?.map((issue) => issue.number)).toEqual([20, 18]);
    expect((await app.inject({ method: "POST", url: "/projects/42/issues/18/context", payload: {} })).statusCode).toBe(200);
    expect(store.getProject("42")?.issueContexts?.["18"]?.selectedForResearch).toBe(true);
    await collect({ issue: 18 });
    expect(store.getProject("42")?.issues?.map((issue) => issue.number)).toEqual([20, 18]);
    expect(store.dashboard().issueSampleCount).toBe(2);
    expect((await collect({ issue: 19 })).statusCode).toBe(404);
    expect(operation).toBeNull();
    expect(store.getProject("42")?.issues?.map((issue) => issue.number)).toEqual([20, 18]);
    expect(store.listAnalysisRuns()).toEqual([]);
  } finally { await app.close(); store.close(); }
});

it("validates sampled issue identity before collection, holds the task slot and saves a partial snapshot without model analysis", async () => {
  const app = Fastify(), store = new RadarStore(":memory:"), runtime = new InProcessRuntimeAdapter();
  const item = { id: 42, fullName: "sample/editor", description: null, url: "https://github.com/sample/editor", language: "Rust", license: "MIT", stars: 0, forks: 0, openIssues: 1, createdAt: "2026-10-01T00:00:00Z", pushedAt: null, readmeExcerpt: null, releaseTag: null, releaseUrl: null, raw: { id: 42 }, warning: null };
  const issue = { id: 7, number: 7, title: "Keep depth when returning an image", bodyExcerpt: "The image must retain its depth.", url: `${item.url}/issues/7`, state: "open" as const, createdAt: item.createdAt, updatedAt: item.createdAt, comments: 1, reactions: 0, authorAssociation: "NONE" };
  store.saveRepository({ ...item, issues: [issue], issuesFetchSucceeded: true }, createRepositorySignal({ repositoryId: 42, ...item, issues: [issue] }), 0, [], [], item.createdAt);
  const context: IssueContext = { issue: { ...issue, bodyTruncated: false, stateReason: null, closedAt: null }, comments: [], commentsComplete: false, commentsError: "unavailable", commentsObservedAt: null, observedAt: "2026-10-20T00:00:00Z" };
  let operation: string | null = null;
  const client = { collectIssueContext: vi.fn(async () => { expect(operation).toBe("issue:42:7"); return context; }) };
  registerIssueContextRoute(app, { store, runtime, client: () => client, busy: () => operation !== null, collection: (value) => { operation = value; } });
  try {
    for (const [url, payload] of [["/projects/42/issues/8/context", {}], ["/projects/42/issues/7/context", { force: true }], ["/projects/42/issues/0/context", {}]] as const) expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(400);
    expect(client.collectIssueContext).not.toHaveBeenCalled();
    operation = "scan";
    expect((await app.inject({ method: "POST", url: "/projects/42/issues/7/context", payload: {} })).statusCode).toBe(409);
    operation = null;
    const result = await app.inject({ method: "POST", url: "/projects/42/issues/7/context", payload: {} });
    expect(result.statusCode).toBe(200);
    expect(result.json().commentsError).toBe("unavailable");
    expect(store.getProject("42")?.issueContexts?.["7"]).toEqual(context);
    expect(operation).toBeNull();
    expect(store.listAnalysisRuns()).toEqual([]);
    expect(runtime.completedExecutions).toBe(1);
  } finally { await app.close(); store.close(); }
});
