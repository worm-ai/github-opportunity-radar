import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import type { DemandSnapshot } from "@radar/analysis";
import { RadarStore } from "./index.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() { const directory = mkdtempSync(join(tmpdir(), "radar-demand-")); directories.push(directory); return join(directory, "test.sqlite"); }
function snapshot(): DemandSnapshot { return { version: "demand-research-v1", question: "A shared agent world", provider: "codex", model: "fixture", stage: "collecting", status: "running", plan: null, searches: [], selections: [], collections: [], projects: [], sources: [{ id: "1:description:0", projectId: "1", field: "description", url: "https://github.com/sample/world", observedAt: "2026-10-23T00:00:00Z", content: "Agents act in a persistent shared world.", path: null, sha: null, commitSha: null, notice: "Documentation only" }], evaluations: [], reviews: null, recommendedPathId: null, outcome: "insufficient_evidence", warnings: [], error: null, calls: [] }; }

it("persists stage evidence, marks restart interruption, and retries as a new immutable history entry", () => {
  const file = fixture(), store = new RadarStore(file), requestId = randomUUID();
  const run = store.createDemandRun(requestId, "A shared agent world", null), material = snapshot();
  store.checkpointDemandRun(run.id, material);
  expect(store.createDemandRun(requestId, run.question, null).id).toBe(run.id);
  expect(() => store.createDemandRun(requestId, "Another question", null)).toThrow("demand_request_conflict");
  store.close();
  const reopened = new RadarStore(file);
  expect(reopened.getDemandRun(run.id)?.snapshot).toEqual(material);
  reopened.recoverInterruptedRuns();
  const interrupted = reopened.getDemandRun(run.id)!;
  expect(interrupted).toMatchObject({ status: "interrupted", snapshot: material });
  expect(interrupted.finishedAt).not.toBeNull();
  const retry = reopened.createDemandRun(randomUUID(), run.question, run.id);
  expect(retry.retryOf).toBe(run.id);
  reopened.checkpointDemandRun(run.id, { ...material, status: "succeeded" });
  reopened.failDemandRun(run.id, "late failure");
  expect(reopened.getDemandRun(run.id)).toEqual(interrupted);
  reopened.failDemandRun(retry.id, "connection lost");
  expect(reopened.getDemandRun(retry.id)?.status).toBe("failed");
  reopened.close();
});

it("retains terminal sources and does not mutate completed runs during recovery", () => {
  const store = new RadarStore(fixture()), run = store.createDemandRun(randomUUID(), "A shared agent world", null);
  store.checkpointDemandRun(run.id, { ...snapshot(), stage: "finished", status: "partial" });
  const before = store.getDemandRun(run.id);
  store.recoverInterruptedRuns(); store.failDemandRun(run.id, "late error");
  expect(store.getDemandRun(run.id)).toEqual(before);
  expect(() => store.createDemandRun(randomUUID(), run.question, randomUUID())).toThrow("unknown_demand_parent");
  store.close();
});

it("migrates schema 13 without losing existing settings or creating research work", () => {
  const file = fixture(), original = new RadarStore(file), settings = original.getSettings(); original.close();
  const old = new DatabaseSync(file); old.exec("DROP TABLE demand_runs; PRAGMA user_version=13;"); old.close();
  const upgraded = new RadarStore(file);
  expect(upgraded.getSettings()).toEqual(settings);
  expect(upgraded.listDemandRuns()).toEqual([]);
  expect(upgraded.listAnalysisRuns()).toEqual([]);
  upgraded.close();
  const db = new DatabaseSync(file); try { expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(16); } finally { db.close(); }
});

it("upgrades schema 14 with immutable parent links and distinct idempotency for retries and source continuations", () => {
  const file = fixture(), original = new RadarStore(file), parent = original.createDemandRun(randomUUID(), "A shared agent world", null);
  original.checkpointDemandRun(parent.id, { ...snapshot(), status: "succeeded", stage: "finished" });
  const before = original.getDemandRun(parent.id); original.close();
  const old = new DatabaseSync(file);
  old.exec("ALTER TABLE demand_runs DROP COLUMN continuation_of; ALTER TABLE demand_runs DROP COLUMN continuation_json; PRAGMA user_version=14;"); old.close();
  const store = new RadarStore(file), requestId = randomUUID(), input = { projectIds: ["2", "1"], capabilityIds: ["memory"] };
  expect(store.getDemandRun(parent.id)).toEqual(before);
  const child = store.createSourceDemandRun(requestId, parent.id, input);
  expect(child).toMatchObject({ continuationOf: parent.id, continuationInput: { projectIds: ["1", "2"], capabilityIds: ["memory"] }, retryOf: null });
  expect(store.createSourceDemandRun(requestId, parent.id, { ...input, projectIds: ["1", "2"] }).id).toBe(child.id);
  expect(() => store.createDemandRun(requestId, parent.question, null)).toThrow("demand_request_conflict");
  expect(() => store.createSourceDemandRun(parent.requestId, parent.id, input)).toThrow("demand_request_conflict");
  expect(() => store.createSourceDemandRun(requestId, parent.id, { ...input, capabilityIds: ["action"] })).toThrow("demand_request_conflict");
  store.recoverInterruptedRuns();
  expect(store.getDemandRun(child.id)?.status).toBe("interrupted");
  expect(store.getDemandRun(parent.id)).toEqual(before);
  store.close();
});

