import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, expect, it } from "vitest";
import { RadarStore } from "@radar/storage";
import { registerTaskMeasurementRoutes } from "./task-measurements.js";

const directories: string[] = [];
const input = (requestId = randomUUID()) => ({
  requestId, originDemandId: null, taskDescription: "Compare three candidate implementations from saved evidence.",
  baselineMethod: "Read each repository page and notes manually", assistedMethod: "Use the current action summary and evidence links",
  comparable: true, bothCompleted: true, timing: "measured", tasksCompared: 1,
  baselineMinutes: 30, assistedMinutes: 12, falseKeeps: 1, missedCandidates: 0,
});

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it("persists an independent task comparison, is idempotent, and survives restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "radar-measurement-")); directories.push(directory);
  const path = join(directory, "measurement.sqlite"), store = new RadarStore(path), app = Fastify(); registerTaskMeasurementRoutes(app, store);
  try {
    const payload = input();
    const first = await app.inject({ method: "POST", url: "/task-measurements", headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
    expect(first.statusCode).toBe(201);
    const saved = first.json();
    expect(saved).toMatchObject({ taskDescription: payload.taskDescription, baselineMinutes: 30, assistedMinutes: 12, originDemandId: null });
    expect((await app.inject({ method: "POST", url: "/task-measurements", headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) })).json()).toEqual(saved);
    expect((await app.inject(`/task-measurements/${saved.id}/report.md`)).body).toContain("不代表普遍省时");
    await app.close(); store.close();
    const restarted = new RadarStore(path); expect(restarted.listTaskMeasurements()).toEqual([saved]); restarted.close();
  } finally { try { await app.close(); } catch {} try { store.close(); } catch {} }
});

it("keeps missing timing explicit and rejects a forged unmeasured value", async () => {
  const store = new RadarStore(":memory:"), app = Fastify(); registerTaskMeasurementRoutes(app, store);
  try {
    const payload = { ...input(), requestId: randomUUID(), timing: "unmeasured", baselineMinutes: 0 };
    expect((await app.inject({ method: "POST", url: "/task-measurements", headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) })).statusCode).toBe(400);
  } finally { await app.close(); store.close(); }
});

