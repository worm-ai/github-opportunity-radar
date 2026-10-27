import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { RadarStore } from "@radar/storage";
import { buildDiscoveryPlan, type GitHubClient, type GitHubRepository } from "@radar/sensor-github";
import { InProcessRuntimeAdapter, type RuntimeTask } from "@radar/runtime";
import { runScanPipeline } from "./scan-pipeline.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture(warnings: string[] = []) {
  const directory = mkdtempSync(join(tmpdir(), "radar-pipeline-"));
  directories.push(directory);
  const store = new RadarStore(join(directory, "test.sqlite"));
  const run = store.createScanRun();
  const repository: GitHubRepository = {
    id: 42, fullName: "fixture/component", url: "https://github.com/fixture/component",
    description: "Reusable document transformation CLI", language: "TypeScript", license: "MIT",
    stars: 50, forks: 2, openIssues: 0, createdAt: "2026-10-01T00:00:00Z", pushedAt: null,
    readmeExcerpt: "Accepts JSON and generates editable documents.", releaseTag: null, releaseUrl: null,
    raw: { id: 42 }, warning: null,
  };
  const tracks = buildDiscoveryPlan(store.getSettings()).map((track) => ({ ...track, searchComplete: true, hasMore: true }));
  const client: Pick<GitHubClient, "discover"> = { discover: vi.fn(async () => ({ repositories: [repository], tracks, warnings })) };
  return { store, run, client, runtime: new InProcessRuntimeAdapter(), onAnalysis: vi.fn() };
}

it("commits collection before analysis, crosses the Engine sequentially, and survives a restart during analysis", async () => {
  const f = fixture();
  const tasks: RuntimeTask[] = [];
  let inCallback = false;
  f.runtime.run = async <T>(handler: () => Promise<T>, task: RuntimeTask = "scan") => {
    expect(inCallback).toBe(false);
    tasks.push(task);
    inCallback = true;
    try { return JSON.parse(JSON.stringify(await handler())) as T; }
    finally { inCallback = false; }
  };
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const pipeline = runScanPipeline({ ...f, analyze: async (ids) => {
    expect([...ids]).toEqual(["42"]);
    f.store.createAnalysisRun("waiting-review", "fixture");
    entered();
    await waiting;
    return null;
  } });
  try {
    await started;
    const collected = f.store.getScanRun(f.run.id);
    expect(collected).toMatchObject({ status: "succeeded", found: 1, inserted: 1, duplicates: 0, error: null });
    expect(collected?.finishedAt).not.toBeNull();
    expect(f.store.getProject("42")).not.toBeNull();
    expect(tasks).toEqual(["scan", "analyze-opportunities"]);
    expect(f.onAnalysis).toHaveBeenCalledOnce();
    f.store.recoverInterruptedRuns();
    expect(f.store.getScanRun(f.run.id)).toEqual(collected);
    expect(f.store.listAnalysisRuns()[0]?.status).toBe("failed");
  } finally { release(); await pipeline; f.store.close(); }
});

it.each([{ warnings: [] as string[] }, { warnings: ["fixture: incomplete README"] }])("keeps collection outcomes after model timeout: %j", async ({ warnings }) => {
  const f = fixture(warnings);
  const timeout = new Error("Model timed out");
  try {
    await expect(runScanPipeline({ ...f, analyze: async () => { throw timeout; } })).rejects.toBe(timeout);
    expect(f.store.getScanRun(f.run.id)).toMatchObject({ status: warnings.length ? "partial" : "succeeded", found: 1, inserted: 1, warnings, error: null });
    expect(f.store.getProject("42")).not.toBeNull();
  } finally { f.store.close(); }
});

it("records a collection failure without starting analysis or advancing discovery", async () => {
  const f = fixture();
  const tracks = buildDiscoveryPlan(f.store.getSettings()).map((track) => ({ ...track, error: "connection failed" }));
  const error = Object.assign(new Error("GitHub unavailable"), { tracks });
  f.client.discover = vi.fn(async () => { throw error; });
  const analyze = vi.fn();
  try {
    await expect(runScanPipeline({ ...f, analyze })).rejects.toBe(error);
    expect(f.store.getScanRun(f.run.id)).toMatchObject({ status: "failed", error: error.message, tracks });
    expect(f.store.getDiscoveryProgress()).toEqual({});
    expect(analyze).not.toHaveBeenCalled();
    expect(f.onAnalysis).not.toHaveBeenCalled();
  } finally { f.store.close(); }
});

it("preserves a committed collection when the Engine loses the reply", async () => {
  const f = fixture();
  const lostReply = new Error("Engine reply timed out");
  f.runtime.run = async (handler) => { await handler(); throw lostReply; };
  const analyze = vi.fn();
  try {
    await expect(runScanPipeline({ ...f, analyze })).rejects.toBe(lostReply);
    expect(f.store.getScanRun(f.run.id)).toMatchObject({ status: "succeeded", found: 1, inserted: 1, error: null });
    expect(analyze).not.toHaveBeenCalled();
    expect(f.store.getProject("42")).not.toBeNull();
  } finally { f.store.close(); }
});
