import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { RadarStore } from "@radar/storage";
import { registerValidationProgressRoutes } from "./validation-progress.js";
import { opportunityReport } from "./reports.js";

it("migrates old opportunities and restores execution notes after restart without inventing market validation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "radar-validation-progress-"));
  const path = join(directory, "radar.sqlite");
  let store = new RadarStore(path);
  const draft = { id: "progress-test", combinationKey: "test:progress", title: "Test validation execution", targetUser: "Developers", jobToBeDone: "Preserve comments in real workflows", hypothesis: "A hypothesis requiring actual user evidence", projectIds: ["1", "2"], projectNames: ["fixture/a", "fixture/b"], score: 50, supportingEvidence: [], counterEvidence: [], validationSteps: ["Observe a real user's current process", "Compare one authorized document"], successMetric: "User saves time with no loss", failureMetric: "Existing tools meet the need" };
  store.saveOpportunities([draft]);
  store.close();
  const old = new DatabaseSync(path);
  old.exec("DROP TABLE demand_runs; ALTER TABLE opportunities DROP COLUMN validation_progress_json; PRAGMA user_version=12;");
  old.close();
  store = new RadarStore(path);
  const app = Fastify();
  registerValidationProgressRoutes(app, store);
  const put = (index: string, payload: Record<string, unknown>) => app.inject({ method: "PUT", url: `/opportunities/${draft.id}/steps/${index}`, headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
  try {
    expect(store.getOpportunity(draft.id)).toMatchObject({ validationProgress: [], marketStatus: "unvalidated", validationRecords: [] });
    const complete = { step: draft.validationSteps[0], status: "completed", note: "Observed one workflow; its repeat frequency remains unknown." };
    const completed = await put("0", complete);
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ status: "candidate", marketStatus: "unvalidated", validationRecords: [], validationProgress: [{ ...complete, index: 0 }] });
    expect((await put("1", { step: draft.validationSteps[1], status: "skipped", note: "No authorized document available yet." })).statusCode).toBe(200);
    for (const index of ["-1", "1.5", "NaN", "9007199254740992"]) expect((await put(index, complete)).statusCode).toBe(400);
    for (const payload of [{ ...complete, status: "validated" }, { ...complete, note: " " }, { ...complete, note: "x".repeat(1201) }, { ...complete, extra: true }]) expect((await put("0", payload)).statusCode).toBe(400);
    expect((await put("9", complete)).statusCode).toBe(409);
    expect((await app.inject({ method: "PUT", url: "/opportunities/missing/steps/0", headers: { "content-type": "application/json" }, payload: JSON.stringify(complete) })).statusCode).toBe(404);
    // A later model run can revise a step at the same position. Existing work
    // belongs to its original text and must not silently complete the new step.
    store.saveOpportunities([{ ...draft, validationSteps: ["Measure the existing alternative first", draft.validationSteps[1]!] }]);
    expect((await put("0", complete)).statusCode).toBe(409);
    expect(store.getOpportunity(draft.id)?.validationProgress?.[0]?.step).toBe(draft.validationSteps[0]);
    const report = opportunityReport(store.getOpportunity(draft.id)!);
    expect(report).toContain("原步骤已变化，请重新核对");
    expect(report).toContain(complete.note);
    expect(report).toContain("No authorized document available yet.");
    const revised = { step: "Measure the existing alternative first", status: "completed", note: "Compared against the existing tool; no advantage established." };
    expect((await put("0", revised)).statusCode).toBe(200);
    expect(store.getOpportunity(draft.id)?.validationProgress).toHaveLength(3);
    expect((await put("0", { ...revised, status: "pending", note: "" })).statusCode).toBe(200);
    expect(store.getOpportunity(draft.id)?.validationProgress?.[0]?.note).toBe(complete.note);
    await app.close();
    store.close();
    store = new RadarStore(path);
    expect(store.getOpportunity(draft.id)).toMatchObject({ marketStatus: "unvalidated", validationRecords: [], validationProgress: [{ index: 0, status: "completed", note: complete.note }, { index: 1, status: "skipped" }] });
    const check = new DatabaseSync(path, { readOnly: true });
    expect(check.prepare("PRAGMA user_version").get()?.user_version).toBe(16);
    expect(check.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
    check.close();
  } finally { await app.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

