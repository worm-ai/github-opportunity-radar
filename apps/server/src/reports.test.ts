import { expect, it } from "vitest";
import type { OpportunityRecord } from "@radar/storage";
import type { ResearchNoteView } from "@radar/contracts/research";
import { opportunityReport, reportText, researchReport } from "./reports.js";
import type { TechnicalExperiment } from "./experiments.js";

it("exports a failed/latest run without relabeling historical opportunities as its results", () => {
  const report = researchReport({ scan: null, analysis: null, drafts: [], projectCount: 17, issueCount: 6 });
  expect(report).toContain("本次尚无保留方向");
  expect(report).toContain("17 个项目 / 6 条公开 Issue");
});

it("labels a focused question as unverified and cache reuse as no new model call", () => {
  const report = researchReport({ scan: null, drafts: [], projectCount: 2, issueCount: 0, analysis: {
    id: "cached-1", model: "test", status: "succeeded", startedAt: "2026-10-20T00:00:00Z", finishedAt: "2026-10-20T00:01:00Z", error: null,
    opportunities: 0, rejected: 0, usage: null, promptVersion: "test", analyzedProjects: [], decisions: [], reusedFrom: "original-1",
    focus: { projectIds: ["1", "2"], question: "<script>not evidence</script> Can this combination save editing time?", originIssue: { projectId: "1", issueNumber: 7 } },
    researchProfile: { targetUser: "<img src=x onerror=evil>", recurringWork: "[unsafe](javascript:evil)", constraints: "Local execution" },
  } });
  expect(report).toContain("待证伪，不是需求证据");
  expect(report).toContain("指定问题起点：项目 ID 1 #7");
  expect(report).toContain("&lt;script&gt;");
  expect(report).toContain("复用分析 original-1；本次未调用模型");
  expect(report).not.toContain("实际消耗未知");
  expect(report).toContain("研究画像（当时的筛选背景，不是需求证据）");
  expect(report).toContain("&lt;img src=x onerror=evil&gt;");
  expect(report).toContain("\\[unsafe\\]\\(javascript:evil\\)");
  expect(report).toContain("Local execution");
});

it("does not export corrupted focused questions as readable research", () => {
  const corrupt = "???????? anydoc Issue #191 ???????";
  const item: OpportunityRecord = {
    id: "corrupt-opportunity", status: "candidate", marketStatus: "unvalidated",
    title: "Review comment preservation", targetUser: "Developers", jobToBeDone: "Preserve comments", hypothesis: "Testable hypothesis",
    projectIds: ["1", "2"], projectNames: ["sample/a", "sample/b"], score: 1,
    supportingEvidence: [], counterEvidence: [], validationSteps: ["Check a known file"], successMetric: "Comments survive", failureMetric: "Any comment is lost",
    validationRecord: null, validationRecords: [], createdAt: "2026-10-22T00:00:00Z", combinationKey: "fixture",
    validationProgress: [{ index: 0, step: "Check a known file", status: "completed", note: "Parsed three comments; two anchors were approximate.", updatedAt: "2026-10-22T00:05:00Z" }],
    researchFocus: { projectIds: ["1", "2"], question: corrupt },
  };
  const detail = opportunityReport(item);
  expect(detail).toContain("验证步骤执行记录");
  expect(detail).toContain("Parsed three comments; two anchors were approximate.");
  const latest = researchReport({ scan: null, analysis: {
    id: "corrupt-focus", model: "test", status: "succeeded", startedAt: "2026-10-22T00:00:00Z", finishedAt: "2026-10-22T00:01:00Z", error: null,
    opportunities: 0, rejected: 0, usage: null, promptVersion: "test", analyzedProjects: [], decisions: [], focus: { projectIds: ["1", "2"], question: corrupt },
  }, drafts: [], projectCount: 2, issueCount: 0 });
  for (const report of [detail, latest]) {
    expect(report).toContain("原研究问题包含不可恢复字符");
    expect(report).not.toContain(corrupt);
  }
});

it("exports current exact research and matching experiments before the original proposal", () => {
  const item: OpportunityRecord = {
    id: "docx-comments", status: "candidate", marketStatus: "unvalidated", title: "Preserve DOCX comments",
    targetUser: "Developers", jobToBeDone: "Keep review comments", hypothesis: "A wrapper could preserve comments",
    projectIds: ["1", "2"], projectNames: ["sample/reader", "sample/converter"], score: 1,
    supportingEvidence: [], counterEvidence: [], validationSteps: ["Compare converters"], successMetric: "Comments survive", failureMetric: "Comments are lost",
    validationRecord: null, validationRecords: [], createdAt: "2026-10-22T00:00:00Z", combinationKey: "fixture",
    firstExperiment: "Run the old two-hour sample experiment.",
  };
  const note: ResearchNoteView = {
    id: "note-1", createdAt: "2026-10-22T02:00:00Z", author: "assistant", title: "Pandoc is a mature alternative",
    question: "Does the established converter change whether this adapter is needed?", projectIds: ["1", "2"], projectNames: item.projectNames,
    decision: "watch", conclusion: "Its upstream AST tracks comments, but CLI Markdown output remains unverified.",
    nextAction: "Compare a fixed Pandoc CLI build on the exact positive and negative fixtures.", supersedesId: null, supersededBy: null, evidenceStates: ["same"], evidence: [],
  };
  const experiment: TechnicalExperiment = {
    id: "docx-experiment", title: "Read comments with GenOffice", question: "Can the parser recover comments?",
    conclusion: "The fixture comment and anchor were recovered.", executedAt: "2026-10-22T03:00:00Z", environment: "isolated test",
    inputOrigin: "synthetic DOCX", projectIds: ["1", "2"], sources: [{ repository: "sample/reader", commit: "a".repeat(40) }, { repository: "sample/converter", commit: "b".repeat(40) }],
    checks: [{ label: "comment body", observation: "Needs source.", outcome: "supported" }], limitations: ["Synthetic input only."], nextAction: "Seek workflow evidence.",
    artifacts: [{ name: "result.json", label: "Raw result", sha256: "a".repeat(64) }],
  };
  const report = opportunityReport(item, { researchNotes: [note], experiments: [experiment] });
  expect(report.indexOf("## 后续研究与实测")).toBeLessThan(report.indexOf("## 原始机会提案"));
  expect(report.indexOf("Pandoc is a mature alternative")).toBeLessThan(report.indexOf("Run the old two-hour sample experiment."));
  expect(report).toContain("代理研究，待人工复核");
  expect(report).toContain("docx-experiment");
  expect(report).toContain("a".repeat(64));
  expect(report).not.toContain("这不证明实验尚未执行");
});

it("exports full proposal and review as literal data with no invented historical snapshots", () => {
  const analysis = {
    id: "audit-1", model: "test", status: "succeeded" as const, startedAt: "2026-10-20T00:00:00Z", finishedAt: "2026-10-20T00:01:00Z", error: null,
    opportunities: 0, rejected: 1, usage: null, promptVersion: "test", analyzedProjects: [], decisions: [],
    candidateAudits: [{ index: 0, proposal: { title: "<script>not trusted</script>", firstExperiment: "Measure editing time" }, evidenceStatus: "passed" as const, review: { index: 0, verdict: "reject" as const, reason: "Experiment does not test the job", risks: ["No user observation"], checks: { distinctRoles: true, evidenceSupportsRoles: true, plausibleIntegration: true, specificTestableProblem: false, claimsStayHypothetical: true, problemSignalsRelevant: true, profileFit: "not_applicable" as const } } }],
  };
  const report = researchReport({ scan: null, analysis, drafts: [], projectCount: 2, issueCount: 0 });
  expect(report).toContain('    "firstExperiment": "Measure editing time"');
  expect(report).toContain('      "specificTestableProblem": false');
  expect(report).toContain('    "title": "<script>not trusted</script>"');
  expect(report).not.toContain("历史结果没有完整候选快照");
  const legacy = researchReport({ scan: null, analysis: { ...analysis, candidateAudits: undefined }, drafts: [], projectCount: 2, issueCount: 0 });
  expect(legacy).toContain("历史结果没有完整候选快照");
  expect(legacy).toContain("结果解释：结果材料不完整；计数字段记录淘汰 1 项");
});

it("explains an empty candidate snapshot without claiming evidence rejection", () => {
  const report = researchReport({ scan: null, drafts: [], projectCount: 2, issueCount: 0, analysis: {
    id: "empty-candidates", model: "test", status: "succeeded", startedAt: "2026-10-20T00:00:00Z", finishedAt: "2026-10-20T00:01:00Z", error: null,
    opportunities: 0, rejected: 0, usage: null, promptVersion: "test", analyzedProjects: [{ id: "1", fullName: "sample/a", url: "https://github.com/sample/a" }], decisions: [],
    selection: { catalogProjects: 2, groups: [{ projectIds: ["1", "2"], projectNames: ["sample/a", "sample/b"], researchQuestion: "test", reason: "test" }], skipped: [] },
    candidateAudits: [],
  } });
  expect(report).toContain("结果解释：本轮未生成候选");
  expect(report).toContain("不代表证据门槛淘汰了候选");
  expect(report).not.toContain("结果解释：候选未通过审查");
});

it("escapes active HTML and Markdown links in untrusted report content", () => {
  const content = reportText('<img src=x onerror=alert(1)>\n[click](javascript:evil)');
  expect(content).not.toContain("<img");
  expect(content).toContain("&lt;img");
  expect(content).toContain("\\[click\\]\\(javascript:evil\\)");
});

it("exports a failed analysis's known subtotal without claiming a complete bill", () => {
  const report = researchReport({ scan: null, drafts: [], projectCount: 2, issueCount: 0, analysis: {
    id: "failed-1", model: "test", status: "failed", startedAt: "2026-10-20T00:00:00Z", finishedAt: "2026-10-20T00:01:00Z", error: "Review timed out",
    opportunities: 0, rejected: 0, usage: { promptTokens: 31, completionTokens: 7, complete: false }, promptVersion: null, analyzedProjects: [], decisions: [],
  } });
  expect(report).toContain("已知 token 小计（完整用量未确认）：31/7");
  expect(report).toContain("分析失败：Review timed out");
});

it("links rejected candidates only to projects in the analyzed input", () => {
  const report = researchReport({
    scan: null,
    analysis: {
      id: "run-1", model: "test", status: "succeeded", startedAt: "2026-10-20T00:00:00Z", finishedAt: "2026-10-20T00:01:00Z", error: null,
      opportunities: 0, rejected: 1, usage: { promptTokens: 10, completionTokens: 5, complete: true }, promptVersion: "v-test",
      analyzedProjects: [{ id: "1", fullName: "sample/document", url: "https://github.com/sample/document" }],
      decisions: [{ title: "Malformed candidate", stage: "schema", reason: "Missing fields", projectIds: ["1", "invented"], projectNames: ["sample/document", "invented"] }],
    },
    drafts: [], projectCount: 1, issueCount: 0,
  });
  expect(report).toContain("[原始来源](https://github.com/sample/document)");
  expect(report).not.toContain("invented");
});
