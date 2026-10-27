import { describe, expect, it } from "vitest";
import type { AnalysisRun } from "@radar/storage";
import { buildResearchLeads } from "./research-leads.js";
import { researchReport } from "./reports.js";

const checks = { distinctRoles: true, evidenceSupportsRoles: true, plausibleIntegration: true, specificTestableProblem: true, claimsStayHypothetical: true, problemSignalsRelevant: true, profileFit: "not_applicable" as const };
function run(): AnalysisRun {
  return { id: "run-1", model: "test", status: "succeeded", startedAt: "2026-10-21T00:00:00Z", finishedAt: "2026-10-21T00:01:00Z", error: null, opportunities: 0, rejected: 1, usage: null, decisions: [], promptVersion: "test",
    analyzedProjects: [{ id: "1", fullName: "a/one", url: "https://github.com/a/one" }, { id: "2", fullName: "b/two", url: "https://github.com/b/two" }],
    focus: { projectIds: ["1", "2"], question: "Can these components preserve document review comments?", originIssue: { projectId: "2", issueNumber: 7 } },
    candidateAudits: [{ index: 0, proposal: { title: "Unverified document gate", projectIds: ["1", "2"], jobToBeDone: "Preserve document review comments", firstExperiment: "Inspect both outputs on a known sample" }, evidenceStatus: "passed", review: { index: 0, verdict: "reject", reason: "The second component has no relevant interface evidence.", risks: ["User adoption remains unknown."], checks: { ...checks, evidenceSupportsRoles: false } } }],
  };
}

describe("derived research leads", () => {
  it("keeps a failed hard check rejected even if the model says keep; retains an exact origin without promoting it", () => {
    const source = run(); source.candidateAudits![0]!.review!.verdict = "keep";
    const before = structuredClone(source), [lead] = buildResearchLeads([source]);
    expect(lead).toMatchObject({ status: "rejected", resume: source.focus, proposedExperiment: "Inspect both outputs on a known sample" });
    expect(lead!.nextSteps.join()).toContain("接口原文");
    expect(source).toEqual(before);
  });

  it("distinguishes failed review from semantic rejection and exports the unexecuted suggestion", () => {
    const source = run(); source.status = "failed"; source.error = "Schema validation failed"; source.candidateAudits![0]!.review = null;
    expect(buildResearchLeads([source])[0]).toMatchObject({ status: "review_incomplete", reason: expect.stringContaining(source.error) });
    const report = researchReport({ scan: null, analysis: source, drafts: [], projectCount: 2, issueCount: 1 });
    expect(report).toContain("待核查的研究线索");
    expect(report).toContain("模型生成，未执行");
    expect(report).toContain("不能推断审查检查通过");
  });

  it.each(["unknown", "duplicate", "non-string", "wrong-focus"])("prevents %s project references from becoming a prefilled research combination", (kind) => {
    const source = run(), audit = source.candidateAudits![0]!;
    audit.evidenceStatus = "evidence_failed"; audit.review = null;
    (audit.proposal as Record<string, unknown>).projectIds = kind === "unknown" ? ["1", "404"] : kind === "duplicate" ? ["1", "1"] : kind === "non-string" ? ["1", "2", 3] : ["1", "2"];
    if (kind === "wrong-focus") source.focus!.projectIds = ["1", "3"];
    const lead = buildResearchLeads([source])[0]!;
    expect(lead.resume).toBeNull(); expect(lead.proposedExperiment).toBeNull();
    expect(lead.projects.every((project) => ["1", "2"].includes(project.id))).toBe(true);
  });

  it("retains structured gaps but does not invent diagnostics for historical proposals", () => {
    const source = run(), audit = source.candidateAudits![0]!;
    audit.evidenceStatus = "evidence_failed"; audit.review = null;
    expect(buildResearchLeads([source])[0]!.gaps).toEqual([]);
    expect(buildResearchLeads([source])[0]!.reason).toContain("历史快照");
    audit.evidenceFailures = [{ code: "document_not_found", message: "Document was not collected", projectId: "1", documentPath: "api.md" }];
    expect(buildResearchLeads([source])[0]!.gaps).toEqual([{ code: "document_not_found", message: "Document was not collected" }]);
  });

  it("does not turn corrupted titles or focus questions into readable labels or prefilled research", () => {
    const source = run();
    source.focus!.question = "????????????????????????????????????????????????????";
    (source.candidateAudits![0]!.proposal as Record<string, unknown>).title = "???????????? Office ? PDF";
    const lead = buildResearchLeads([source])[0]!;
    expect(lead.title).toBe("候选 1（标题需核对原始记录）");
    expect(lead.resume).toBeNull();
  });

  it("excludes accepted candidates, running calls, cache replays and missing historical snapshots; bounds and deduplicates the view", () => {
    const kept = run(); kept.candidateAudits![0]!.review!.checks = { ...checks }; kept.candidateAudits![0]!.review!.verdict = "keep";
    const running = run(); running.status = "running";
    const cached = run(); cached.reusedFrom = "original";
    const legacy = run(); legacy.candidateAudits = null;
    expect(buildResearchLeads([kept, running, cached, legacy])).toEqual([]);
    expect(buildResearchLeads([kept, run()])).toEqual([]);
    expect(buildResearchLeads([run(), { ...run(), id: "older" }])).toHaveLength(1);
    expect(buildResearchLeads([run()], 1)).toHaveLength(1);
  });
});
