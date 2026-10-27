import { describe, expect, it } from "vitest";
import { explainAnalysisOutcome } from "./analysis-outcome.js";

describe("analysis outcome explanations", () => {
  it("distinguishes an empty shortlist from an empty proposal response", () => {
    expect(explainAnalysisOutcome({ status: "succeeded", opportunities: 0, rejected: 0, selection: { groups: [] } }).label).toBe("本轮未选出深读组合");
    expect(explainAnalysisOutcome({ status: "succeeded", opportunities: 0, rejected: 0, selection: { groups: [{ projectIds: ["1", "2"] }] }, candidateAudits: [] }).label).toBe("本轮未生成候选");
    expect(explainAnalysisOutcome({ status: "succeeded", opportunities: 0, rejected: 1, selection: { groups: [{ projectIds: ["1", "2"] }] }, candidateAudits: [] }).label).toBe("结果材料不完整");
    expect(explainAnalysisOutcome({ status: "succeeded", opportunities: 1, rejected: 0, selection: { groups: [] }, candidateAudits: [] }).label).toBe("结果材料不完整");
  });

  it("does not claim rejection or an empty result when historical candidate snapshots are missing", () => {
    const explanation = explainAnalysisOutcome({ status: "succeeded", opportunities: 0, rejected: 0, candidateAudits: null });
    expect(explanation.label).toBe("结果材料不完整");
    expect(explanation.detail).toContain("无法判断模型是否提出候选");
    const counted = explainAnalysisOutcome({ status: "succeeded", opportunities: 0, rejected: 2, candidateAudits: undefined });
    expect(counted.label).toBe("结果材料不完整");
    expect(counted.detail).toContain("计数字段记录淘汰 2 项");
    expect(counted.detail).toContain("无法复核提案与审查记录的对应关系");
  });

  it("separates candidate rejection, retained hypotheses, and failed runs", () => {
    expect(explainAnalysisOutcome({ status: "succeeded", opportunities: 0, rejected: 2, candidateAudits: [{}, {}] }).label).toBe("候选未通过审查");
    expect(explainAnalysisOutcome({ status: "succeeded", opportunities: 1, rejected: 2, candidateAudits: [{}, {}, {}] }).detail).toContain("不能据此推断市场或付费成立");
    expect(explainAnalysisOutcome({ status: "failed", opportunities: 0, rejected: 0 }).detail).toContain("不能把它解释为没有机会");
    expect(explainAnalysisOutcome({ status: "succeeded", opportunities: 0, rejected: 2, candidateAudits: [] }).detail).toContain("候选快照为空");
  });
});
