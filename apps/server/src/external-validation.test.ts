import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { RadarStore } from "@radar/storage";
import { registerExternalValidationRoutes } from "./external-validation.js";
import { opportunityReport } from "./reports.js";

it("persists an incomplete trial faithfully and exports missing values as unrecorded", async () => {
  const directory = mkdtempSync(join(tmpdir(), "radar-external-validation-"));
  const store = new RadarStore(join(directory, "radar.sqlite"));
  const app = Fastify();
  const draft = { id: "trial-test", combinationKey: "test:trial", title: "Test trial", targetUser: "Developers", jobToBeDone: "Compare a repeated task", hypothesis: "A hypothesis requiring user evidence", projectIds: ["1", "2"], projectNames: ["fixture/a", "fixture/b"], score: 1, supportingEvidence: [], counterEvidence: [], validationSteps: ["Run a comparable task"], successMetric: "Task finishes", failureMetric: "Task cannot finish" };
  store.saveOpportunities([draft]);
  store.updateOpportunityStatus(draft.id, "validating");
  registerExternalValidationRoutes(app, store);
  const body = {
    method: "trial", outcome: "inconclusive", note: "任务在核对阶段中断，没有获得足以比较的耗时。",
    trialMeasurement: { taskDescription: "从同一批公开材料中筛选需要继续核查的候选。", baselineMethod: "逐条搜索并人工核对。", assistedMethod: "使用项目雷达筛选后仍需人工复核。", comparable: false, bothCompleted: false, timing: "unmeasured", tasksCompared: 1, baselineMinutes: null, assistedMinutes: null, falseKeeps: null, missedCandidates: null },
  };
  try {
    expect((await app.inject({ method: "POST", url: `/opportunities/${draft.id}/validation`, payload: { ...body, trialMeasurement: { ...body.trialMeasurement, baselineMinutes: "" } } })).statusCode).toBe(400);
    const response = await app.inject({ method: "POST", url: `/opportunities/${draft.id}/validation`, payload: body });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ marketStatus: "evidence_recorded", validationRecord: body });
    const report = opportunityReport(store.getOpportunity(draft.id)!);
    expect(report).toContain("基线分钟：未记录");
    expect(report).toContain("误留：未记录");
    expect(report).toContain("任务条件不可比，不计算耗时收益");
  } finally {
    await app.close(); store.close(); rmSync(directory, { recursive: true, force: true });
  }
});
