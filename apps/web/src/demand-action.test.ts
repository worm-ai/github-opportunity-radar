import { describe, expect, it } from "vitest";
import type { DemandRun, DemandSnapshot } from "./api";
import { demandAction } from "./demand-action";
import type { DemandPath } from "../../../packages/analysis/src/demand";
import type { ResearchNoteView } from "@radar/contracts/research";

const base = (): DemandSnapshot => ({
  version: "demand-research-v5", question: "Build a local tool with a saved state.", provider: "codex", model: "codex/test",
  stage: "finished", status: "partial", plan: { summary: "Local tool", capabilities: [{ id: "state", description: "Saved state", required: true, origin: "user" }], constraints: [], assumptions: [], questions: [], queries: [{ query: "saved state", reason: "Find implementations" }] },
  searches: [], selections: [], collections: [{ fullName: "sample/tool", status: "succeeded", error: null }], projects: [{ id: "1", fullName: "sample/tool", url: "https://github.com/sample/tool", license: null, language: "TypeScript", observedAt: "2026-01-01" }], sources: [{ id: "1:readme:0", projectId: "1", field: "readme", url: "https://github.com/sample/tool", observedAt: "2026-01-01", content: "The tool saves state.", path: null, sha: null, commitSha: null, notice: "unverified" }], evaluations: [], reviews: null, recommendedPathId: null, outcome: "insufficient_evidence", warnings: [], error: null, calls: [],
});
const run = (snapshot: DemandSnapshot, status: DemandRun["status"] = snapshot.status): DemandRun => ({ id: "run", requestId: "request", question: snapshot.question, retryOf: null, status, startedAt: "2026-01-01", updatedAt: "2026-01-01", finishedAt: null, error: snapshot.error, snapshot });
const path = (): DemandPath => ({ id: "p", title: "Adapt sample/tool", kind: "adapt", projectIds: ["1"], coverage: [{ capabilityId: "state", status: "partial", reason: "Documentation only", evidence: [{ sourceId: "1:readme:0", quote: "The tool saves state." }] }], constraintsFit: "unknown", constraintReason: "Not run", roles: [{ projectId: "1", responsibility: "Stores state", input: "State", output: "Saved state" }], integration: "Single project", remainingWork: ["Pin commit"], risks: ["No runtime proof"], experiment: { input: "A state file", steps: ["Pin the commit and run the save/reload check"], pass: "State reloads", fail: "State is lost" } });

describe("demand action handoff", () => {
  it("elevates the latest active manual evidence into the next bounded action", () => {
    const snapshot = base();
    const note = { id: "note", createdAt: "2026-01-02", supersededBy: null, projectNames: ["sample/tool"], decision: "continue", conclusion: "人工实测支持继续验证本地改造，但还不能证明完整应用可用。", nextAction: "先验证玩家事件后的可观察反馈，再测试中途失败恢复。", evidenceStates: ["same"], evidence: [] } as unknown as ResearchNoteView;
    expect(demandAction(run(snapshot), [note])).toMatchObject({ kind: "verify", title: "已有人工实测，继续验证下一步", projectNames: ["sample/tool"], next: note.nextAction });
  });

  it("does not turn empty evidence into a recommendation", () => {
    const snapshot = base();
    expect(demandAction(run(snapshot))).toMatchObject({ kind: "no_evidence", title: "当前不能形成实现建议" });
  });
  it("converts a candidate into a bounded verification action", () => {
    const snapshot = base(); snapshot.evaluations = [{ paths: [path()], gapQueries: [], conclusion: "Evidence is incomplete" }];
    const result = demandAction(run(snapshot));
    expect(result).toMatchObject({ kind: "verify", title: "有候选，但还不能推荐", projectNames: ["sample/tool"], next: "Pin the commit and run the save/reload check" });
    expect(result.blockers).toEqual(expect.arrayContaining(["运行约束尚未确认", "至少一个候选许可证未知", "候选来源未固定到提交"]));
    expect(result.blockers.join(" ")).not.toContain("真实搜索 GitHub");
  });
  it("uses a completed recommendation only when the snapshot says so", () => {
    const snapshot = base(); const candidate = path(); candidate.constraintsFit = "compatible"; candidate.coverage[0]!.status = "supported"; snapshot.projects[0]!.license = "MIT"; snapshot.sources[0]!.commitSha = "a".repeat(40); snapshot.evaluations = [{ paths: [candidate], gapQueries: [], conclusion: "Keep" }]; snapshot.reviews = { reviews: [{ pathId: "p", verdict: "keep", reason: "Checks pass", risks: ["Runtime remains to verify"], checks: { capabilitiesGrounded: true, constraintsRespected: true, singleProjectCompared: true, integrationHonest: true, experimentFalsifiable: true } }], recommendedPathId: "p", conclusion: "Keep" }; snapshot.recommendedPathId = "p"; snapshot.outcome = "adapt"; snapshot.status = "succeeded";
    expect(demandAction(run(snapshot, "succeeded")).title).toBe("可以开始最小验证");
  });
});
