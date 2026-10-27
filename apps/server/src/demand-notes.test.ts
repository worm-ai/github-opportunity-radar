import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Fastify from "fastify";
import { afterEach, expect, it } from "vitest";
import type { DemandSnapshot } from "@radar/analysis";
import type { ResearchNoteInput } from "@radar/contracts";
import { RadarStore } from "@radar/storage";
import { registerResearchNoteRoutes } from "./research-notes.js";

const quote = "state.memory.push(event); state.save();";
const question = "Can this single project persist shared-world memories and resume the simulation?";
const close: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of close.splice(0).reverse()) await fn(); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "radar-demand-notes-"));
  const db = join(directory, "notes.sqlite"), store = new RadarStore(db), app = Fastify();
  const archive = join(directory, "archive"), artifactDirectory = join(archive, "behavior-fixture");
  mkdirSync(artifactDirectory, { recursive: true });
  const artifact = "{\"saved\":false}";
  writeFileSync(join(artifactDirectory, "result.json"), artifact);
  const experiment = { id: "behavior-fixture", title: "Shared world state behavior", question, conclusion: "The original save returned success but failed the fresh-process reload.", executedAt: "2026-10-23T00:00:00Z", environment: "Fixture, no upstream code executed", inputOrigin: "Synthetic test fixture", projectIds: ["1"], sources: [{ repository: "fixture/world", commit: "b".repeat(40) }], checks: [{ label: "Reload", observation: "Fresh-process memory is empty.", outcome: "refuted" }], limitations: ["No full game or external model tested."], nextAction: "Repair persistence before testing autonomous decisions.", artifacts: [{ name: "result.json", label: "Synthetic result", sha256: createHash("sha256").update(artifact).digest("hex") }] };
  const publish = () => writeFileSync(join(artifactDirectory, "record.json"), JSON.stringify(experiment)); publish();
  registerResearchNoteRoutes(app, store, archive);
  const snapshot: DemandSnapshot = { version: "fixture", question, provider: "codex", model: "fixture", stage: "finished", status: "partial", plan: null, searches: [], selections: [], collections: [], projects: [{ id: "1", fullName: "fixture/world", url: "https://github.com/fixture/world", license: "MIT", language: "Python", observedAt: "2026-10-23T00:00:00Z" }, { id: "2", fullName: "fixture/other", url: "https://github.com/fixture/other", license: null, language: null, observedAt: "2026-10-23T00:00:00Z" }], sources: [{ id: "code-1", projectId: "1", field: "code", url: `https://github.com/fixture/world/blob/${"a".repeat(40)}/world.py`, observedAt: "2026-10-23T00:00:00Z", content: quote, path: "world.py", sha: "c".repeat(40), commitSha: "a".repeat(40), notice: "Static code, behavior unverified." }], evaluations: [], reviews: null, recommendedPathId: null, outcome: "insufficient_evidence", warnings: [], error: null, calls: [] };
  const run = store.createDemandRun(randomUUID(), question, null); store.checkpointDemandRun(run.id, snapshot);
  const input = (): ResearchNoteInput => ({ requestId: randomUUID(), author: "assistant", title: "Repair one project before combining", question, originDemandId: run.id, projectIds: ["1"], decision: "continue", conclusion: "Adopt remains unverified; investigate a single-project persistence repair first.", nextAction: "Pass: three agents resume the same world state after reload. Stop if state still disappears.", evidence: [{ ref: { projectId: "1", kind: "demand_source", runId: run.id, sourceId: "code-1" }, quote }] });
  const post = (input: unknown) => app.inject({ method: "POST", url: "/research-notes", payload: input as object });
  close.push(async () => {
    await app.close(); store.close();
    const target = resolve(directory), prefix = `${resolve(tmpdir())}\\radar-demand-notes-`;
    if (!target.startsWith(prefix) && !target.startsWith(`${resolve(tmpdir())}/radar-demand-notes-`)) throw new Error("Unexpected test directory");
    rmSync(target, { recursive: true, force: true });
  });
  return { store, app, archive, artifactDirectory, db, run, snapshot, input, post, experiment, publish };
}

it("records a single-project decision against the exact historical demand source without a current project or new model call", async () => {
  const f = fixture(), before = f.store.getDemandRun(f.run.id);
  const response = await f.post(f.input()); expect(response.statusCode).toBe(201);
  const saved = response.json();
  expect(saved).toMatchObject({ author: "assistant", originDemandId: f.run.id, evidenceStates: ["same"], projectNames: ["fixture/world"], evidence: [{ quote, url: f.snapshot.sources[0]!.url }] });
  expect(saved.evidence[0].notice).toContain("提交 " + "a".repeat(40));
  expect(f.store.getProject("1")).toBeNull();
  expect(f.store.getDemandRun(f.run.id)).toEqual(before);
  expect(f.store.listAnalysisRuns()).toEqual([]);
  const report = await f.app.inject(`/research-notes/${saved.id}/report.md`);
  expect(report.body).toContain(f.run.id); expect(report.body).toContain("待人工复核"); expect(report.body).toContain(quote);
  const reopened = new RadarStore(f.db);
  try { expect(reopened.getResearchNote(saved.id)).toMatchObject({ originDemandId: f.run.id, evidence: saved.evidence }); } finally { reopened.close(); }
});

it("persists an optional task comparison separately from the research decision and exports its limits", async () => {
  const f = fixture();
  const valueMeasurement = { taskDescription: "筛选同一批 Markdown 笔记候选并确定下一步", baselineMethod: "逐个搜索仓库并手工整理", assistedMethod: "使用需求研究结果后核对候选和原文", comparable: true, bothCompleted: true, timing: "measured" as const, tasksCompared: 1, baselineMinutes: 35, assistedMinutes: 18, falseKeeps: 1, missedCandidates: 0 };
  const response = await f.post({ ...f.input(), valueMeasurement });
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({ valueMeasurement });
  const reopened = new RadarStore(f.db);
  try {
    expect(reopened.getResearchNote(response.json().id)).toMatchObject({ valueMeasurement });
  } finally { reopened.close(); }
  const report = await f.app.inject(`/research-notes/${response.json().id}/report.md`);
  expect(report.body).toContain("本次任务对照");
  expect(report.body).toContain("减少 17 分钟");
  expect(report.body).toContain("不能推出普遍省时");
  const invalid = await f.post({ ...f.input(), requestId: randomUUID(), valueMeasurement: { ...valueMeasurement, timing: "unmeasured", baselineMinutes: 1 } });
  expect(invalid.statusCode).toBe(400);
});

it("serves only the selected demand's decisions from one material snapshot", async () => {
  const f = fixture();
  const response = await f.post(f.input()); expect(response.statusCode).toBe(201);
  const notes = await f.app.inject(`/demands/${f.run.id}/research-notes`);
  expect(notes.statusCode).toBe(200);
  expect(notes.json()).toMatchObject([{ id: response.json().id, originDemandId: f.run.id, evidenceStates: ["same"] }]);
});

it("rejects fabricated quotes, foreign projects, cross-run IDs and references without a demand origin", async () => {
  const f = fixture(), good = f.input();
  for (const changed of [
    { evidence: [{ ...good.evidence[0], quote: "This is a fabricated claim with no supporting text." }] },
    { projectIds: ["2"] },
    { evidence: [{ ref: { ...good.evidence[0]!.ref, runId: randomUUID() }, quote }] },
  ]) expect((await f.post({ ...good, ...changed })).statusCode).toBe(422);
  expect((await f.post({ ...good, projectIds: ["outside"] })).statusCode).toBe(400);
  expect((await f.post({ ...good, originDemandId: undefined })).statusCode).toBe(400);
  expect((await f.post({ ...good, originIssue: { projectId: "1", issueNumber: 7 } })).statusCode).toBe(400);
  expect(f.store.listResearchNotes()).toEqual([]);
});

it("retains manual experiment versions and limits and detects changed records or corrupted artifacts without losing saved quotes", async () => {
  const f = fixture();
  const materials = (await f.app.inject(`/demands/${f.run.id}/note-sources`)).json();
  const source = materials.sources.find((source: { ref: { kind: string } }) => source.ref.kind === "experiment");
  expect(source.notice).toContain("b".repeat(40)); expect(source.text).toContain(f.experiment.limitations[0]);
  const input = { ...f.input(), evidence: [{ ref: source.ref, quote: f.experiment.conclusion }] };
  const saved = (await f.post(input)).json(); expect(saved.evidenceStates).toEqual(["same"]);
  expect(saved.evidence[0].notice).toContain(f.experiment.limitations[0]);
  expect((await f.app.inject(`/research-notes/${saved.id}/report.md`)).body).toContain("/experiments#experiment-behavior-fixture");
  f.experiment.limitations.push("This new limit must trigger review."); f.publish();
  expect((await f.app.inject(`/research-notes/${saved.id}`)).json().evidenceStates).toEqual(["changed"]);
  writeFileSync(join(f.artifactDirectory, "result.json"), "corrupted");
  expect((await f.app.inject(`/research-notes/${saved.id}`)).json()).toMatchObject({ evidence: saved.evidence, evidenceStates: ["unavailable"] });
  expect((await f.post({ ...input, requestId: randomUUID() })).statusCode).toBe(422);
  expect((await f.post(input)).json()).toMatchObject({ id: saved.id, evidence: saved.evidence });
  expect((await f.app.inject(`/demands/${f.run.id}/note-sources`)).json().warnings).toHaveLength(1);
});

it("preserves local modification identity in saved evidence and Markdown instead of citing it as original upstream", async () => {
  const f = fixture();
  const modification = { artifact: "result.json", sha256: f.experiment.artifacts[0]!.sha256, description: "Fixture local persistence adapter" };
  Object.assign(f.experiment.sources[0]!, { modification }); f.publish();
  const materials = (await f.app.inject(`/demands/${f.run.id}/note-sources`)).json();
  const source = materials.sources.find((item: { ref: { kind: string } }) => item.ref.kind === "experiment");
  const response = await f.post({ ...f.input(), evidence: [{ ref: source.ref, quote: f.experiment.conclusion }] });
  expect(response.statusCode).toBe(201);
  const saved = response.json();
  for (const detail of ["本地改造版", modification.description, modification.artifact, modification.sha256, "该提交仅为上游基线"]) {
    expect(saved.evidence[0].notice).toContain(detail);
    expect((await f.app.inject(`/research-notes/${saved.id}/report.md`)).body).toContain(detail);
  }
  expect(saved.evidenceStates).toEqual(["same"]);
});

it("never associates an experiment through a project ID or name with the wrong GitHub URL", async () => {
  const f = fixture();
  f.experiment.sources[0]!.repository = "unrelated/world"; f.publish();
  let sources = (await f.app.inject(`/demands/${f.run.id}/note-sources`)).json().sources;
  expect(sources.some((source: { ref: { kind: string } }) => source.ref.kind === "experiment")).toBe(false);
  f.experiment.sources[0]!.repository = "fixture/world"; f.publish();
  const other = f.store.createDemandRun(randomUUID(), question, null);
  f.store.checkpointDemandRun(other.id, { ...f.snapshot, projects: [{ ...f.snapshot.projects[0]!, url: "https://github.com/unrelated/world" }] });
  sources = (await f.app.inject(`/demands/${other.id}/note-sources`)).json().sources;
  expect(sources.some((source: { ref: { kind: string } }) => source.ref.kind === "experiment")).toBe(false);
});

it("preserves the demand origin and immutable earlier evidence when a decision is revised", async () => {
  const f = fixture(), saved = (await f.post(f.input())).json();
  const other = f.store.createDemandRun(randomUUID(), question, null); f.store.checkpointDemandRun(other.id, f.snapshot);
  const revision = { ...f.input(), supersedesId: saved.id, decision: "stop", conclusion: "Stop this route until persistence is repaired and independently rerun." };
  expect((await f.post({ ...revision, originDemandId: other.id })).statusCode).toBe(409);
  expect((await f.post({ ...revision, originDemandId: undefined })).statusCode).toBe(409);
  const next = await f.post(revision); expect(next.statusCode).toBe(201);
  expect((await f.app.inject(`/research-notes/${saved.id}`)).json()).toMatchObject({ supersededBy: next.json().id, evidence: saved.evidence });
  expect((await f.post({ ...revision, requestId: randomUUID() })).statusCode).toBe(409);
});

it("does not accept missing or actively changing demand material as a frozen decision source", async () => {
  const f = fixture(), active = f.store.createDemandRun(randomUUID(), question, null);
  for (const id of [active.id, randomUUID()]) {
    expect((await f.app.inject(`/demands/${id}/note-sources`)).statusCode).toBe(409);
    expect((await f.post({ ...f.input(), originDemandId: id })).statusCode).toBe(409);
  }
});
