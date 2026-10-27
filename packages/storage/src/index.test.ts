import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createDocumentationSignal, createRepositorySignal, createIssueContextSignal, type IssueContext, type RepositoryDocumentation } from "@radar/contracts";
import { RadarStore } from "./index.js";
import { buildDiscoveryPlan } from "@radar/sensor-github";

const directories: string[] = [];

describe("discovery checkpoints", () => {
  it("persists only completed evidence pages, survives restart, and does not advance twice", () => {
    const { directory, store } = fixture();
    const settings = store.getSettings();
    const run = store.createScanRun();
    const plan = buildDiscoveryPlan(settings);
    store.recordDiscovery(run.id, plan);
    expect(store.getDiscoveryProgress()).toEqual({});
    const collected = plan.map((track, index) => ({ ...track, searchComplete: index !== 1, hasMore: true, found: track.limit }));
    store.completeDiscovery(run.id, collected);
    const progress = store.getDiscoveryProgress();
    expect(buildDiscoveryPlan(settings, new Date(), progress).map((track) => track.page)).toEqual([2, 1, 2, 2, 2]);
    store.completeDiscovery(run.id, collected);
    expect(store.getDiscoveryProgress()).toEqual(progress);
    store.close();
    const restarted = new RadarStore(join(directory, "test.sqlite"));
    expect(restarted.getDiscoveryProgress()).toEqual(progress);
    expect(restarted.getScanRun(run.id)?.tracks).toMatchObject([{ page: 1, found: plan[0]!.limit } , {}, {}, {}, {}]);
    restarted.close();
  });

  it("retries an interrupted collection and keeps successful checkpoints independent of later analysis failure", () => {
    const { store } = fixture();
    const interrupted = store.createScanRun(), settings = store.getSettings();
    store.recordDiscovery(interrupted.id, buildDiscoveryPlan(settings));
    store.recoverInterruptedRuns();
    expect(store.getDiscoveryProgress()).toEqual({});
    const run = store.createScanRun();
    store.completeDiscovery(run.id, buildDiscoveryPlan(settings).map((track) => ({ ...track, searchComplete: true, hasMore: true })));
    store.finishScanRun(run, { status: "partial", found: 32, inserted: 32, duplicates: 0, error: null }, ["model failure"]);
    expect(buildDiscoveryPlan(settings, new Date(), store.getDiscoveryProgress())[0]?.page).toBe(2);
    store.close();
  });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "radar-test-"));
  directories.push(directory);
  return { directory, store: new RadarStore(join(directory, "test.sqlite")) };
}

function repository() {
  return {
    id: 42,
    fullName: "sample/agent-memory",
    description: "Persistent memory primitives for AI agent applications.",
    language: "TypeScript",
    license: null,
    stars: 50,
    forks: 4,
    openIssues: 2,
    createdAt: "2026-10-01T00:00:00.000Z",
    pushedAt: "2026-10-10T00:00:00.000Z",
    url: "https://github.com/sample/agent-memory",
    readmeExcerpt: "Persistent vector memory for agent applications.",
    releaseTag: null,
    releaseUrl: null,
    raw: { id: 42 },
    warning: null,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("RadarStore", () => {
  it("preserves the requested profile before any model checkpoint even after settings change and restart", () => {
    const { store, directory } = fixture();
    const profile = { targetUser: "Procurement teams", recurringWork: "Weekly supplier PDF review", constraints: "Local execution" };
    store.updateSettings({ ...store.getSettings(), researchProfile: profile });
    const id = store.createAnalysisRun("early-failure", "test", null, profile);
    store.updateSettings({ ...store.getSettings(), researchProfile: null });
    store.failAnalysisRun(id, "Catalog request failed before a checkpoint");
    store.close();
    const reopened = new RadarStore(join(directory, "test.sqlite"));
    expect(reopened.getSettings().researchProfile).toBeNull();
    expect(reopened.getAnalysisRun(id)).toMatchObject({ status: "failed", researchProfile: profile, candidateAudits: null });
    reopened.close();
  });
  it("persists selected discussions independently of the sample and never revives invalidated comments after a later empty sample", () => {
    const { store, directory } = fixture(), item = { ...repository(), issues: [], issuesFetchSucceeded: true };
    store.saveRepository(item, createRepositorySignal({ repositoryId: item.id, ...item }), 0, [], [], "2026-10-20T00:00:00Z");
    const issue = { id: 18, number: 18, title: "Repeated order item categorization", bodyExcerpt: "I manually categorize hundreds of orders every year.", url: `${item.url}/issues/18`, state: "closed" as const, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", comments: 0, reactions: 0, authorAssociation: "NONE", bodyTruncated: false, stateReason: "completed", closedAt: "2026-10-10T00:00:00Z" };
    const context: IssueContext = { selectedForResearch: true, issue, comments: [], commentsComplete: true, commentsError: null, commentsObservedAt: "2026-10-20T00:00:00Z", observedAt: "2026-10-20T00:00:00Z" };
    store.saveIssueContext("42", context, createIssueContextSignal("42", item.fullName, context));
    expect(store.dashboard().issueSampleCount).toBe(1);
    const newer = { ...item, issues: [{ ...issue, updatedAt: "2026-10-21T00:00:00Z" }] };
    store.saveRepository(newer, createRepositorySignal({ repositoryId: item.id, ...newer }), 0, [], [], "2026-10-21T00:00:00Z");
    expect(store.dashboard().issueSampleCount).toBe(1);
    expect(store.getProject("42")?.issueContexts?.["18"]?.newestSampleUpdatedAt).toBe("2026-10-21T00:00:00Z");
    store.saveRepository(item, createRepositorySignal({ repositoryId: item.id, ...item }), 0, [], [], "2026-10-22T00:00:00Z");
    expect(store.getProject("42")?.issues).toEqual([]);
    expect(store.dashboard().issueSampleCount).toBe(0);
    store.close();
    const reopened = new RadarStore(join(directory, "test.sqlite"));
    expect(reopened.getProject("42")?.issues).toEqual([]);
    expect(reopened.getProject("42")?.issueContexts?.["18"]?.selectedForResearch).toBe(true);
    const refreshed = { ...context, issue: newer.issues[0]!, observedAt: "2026-10-23T00:00:00Z" };
    reopened.saveIssueContext("42", refreshed, createIssueContextSignal("42", item.fullName, refreshed));
    expect(reopened.getProject("42")?.issues?.map((issue) => issue.number)).toEqual([18]);
    expect(reopened.getProject("42")?.issueContexts?.["18"]?.newestSampleUpdatedAt).toBeUndefined();
    expect(reopened.dashboard().issueSampleCount).toBe(1);
    reopened.close();
  });
  it("loads the two latest observations per project independently without changing historical records", () => {
    const { store } = fixture();
    for (const id of [42, 43]) {
      const item = { ...repository(), id, fullName: `sample/project-${id}` };
      for (const hour of [7, 8, 9]) {
        const observedAt = `2026-10-20T0${hour}:00:00.000Z`;
        const snapshot = { ...item, stars: hour };
        const signal = createRepositorySignal({ ...snapshot, repositoryId: id });
        store.saveRepository(snapshot, signal, 40, [], [], observedAt);
      }
    }
    const recent = store.getDiscoveryObservations();
    expect(recent).toHaveLength(4);
    for (const id of ["42", "43"]) {
      expect(recent.filter((item) => item.projectId === id).map((item) => item.stars)).toEqual([9, 8]);
      expect(store.getProjectObservations(id)).toHaveLength(3);
    }
    store.close();
  });
  it("retains paid proposal checkpoints across failed review and restart with current usage completeness", () => {
    const { directory, store } = fixture();
    const focus = { projectIds: ["1", "2"], question: "Can PDF extraction reduce procurement spreadsheet editing time?", originIssue: { projectId: "1", issueNumber: 7 } };
    const researchProfile = { targetUser: "Procurement teams", recurringWork: "Review supplier PDF tables every week", constraints: "Local execution" };
    const id = store.createAnalysisRun("checkpoint-failure", "test", focus, researchProfile);
    const candidateAudits = [{ index: 0, proposal: { title: "Preserved proposal", firstExperiment: "Observe actual editing time" }, evidenceStatus: "passed" as const, review: null }];
    store.updateAnalysisUsage(id, { promptTokens: 20, completionTokens: 10, complete: true });
    store.checkpointAnalysisRun(id, { provider: "deepseek", model: "test", promptVersion: "test", inputHash: "checkpoint-failure", drafts: [], rejected: 0, durationMs: 10, usage: { promptTokens: 20, completionTokens: 10, complete: true }, candidateAudits, analyzedProjects: [{ id: "1", fullName: "sample/a", url: "https://github.com/sample/a" }], focus, researchProfile });
    store.updateAnalysisUsage(id, { promptTokens: 20, completionTokens: 10, complete: false });
    store.close();
    const reopened = new RadarStore(join(directory, "test.sqlite"));
    reopened.recoverInterruptedRuns();
    expect(reopened.getAnalysisRun(id)).toMatchObject({ status: "failed", focus, researchProfile, candidateAudits, analyzedProjects: [{ id: "1" }], usage: { promptTokens: 20, completionTokens: 10, complete: false } });
    expect(reopened.getCachedModelAnalysis("checkpoint-failure")).toBeNull();
    expect(reopened.getOpportunities()).toEqual([]);
    reopened.close();
  });
  it("keeps failures and cache reuse attributable to their focused questions across restart", () => {
    const { directory, store } = fixture();
    const focus = { projectIds: ["1", "2"], question: "Can PDF extraction and spreadsheet export reduce editing time?" };
    const failedId = store.createAnalysisRun("focused-failure", "test-model", focus);
    store.failAnalysisRun(failedId, "Model could not connect");
    const succeededId = store.createAnalysisRun("focused-success", "test-model", focus);
    const result = { provider: "deepseek" as const, model: "test-model", promptVersion: "test", inputHash: "focused-success", drafts: [], rejected: 0, durationMs: 1, usage: { promptTokens: 12, completionTokens: 4, complete: true }, focus };
    store.finishAnalysisRun(succeededId, result);
    const cached = store.findCachedModelAnalysis("focused-success");
    expect(cached?.runId).toBe(succeededId);
    const reusedId = store.createAnalysisRun("focused-success", "test-model", focus);
    store.finishAnalysisRun(reusedId, { ...result, usage: null, durationMs: 0, reusedFrom: succeededId });
    store.close();
    const reopened = new RadarStore(join(directory, "test.sqlite"));
    expect(reopened.getAnalysisRun(failedId)).toMatchObject({ focus, status: "failed", usage: null });
    expect(reopened.getAnalysisRun(reusedId)).toMatchObject({ focus, status: "succeeded", usage: null, reusedFrom: succeededId });
    expect(reopened.getAnalysisRun(succeededId)?.usage?.promptTokens).toBe(12);
    expect(reopened.getAnalysisRun("unknown")).toBeNull();
    reopened.close();
  });

  it("never hides other research scopes when one focused question has no retained result", () => {
    const { store } = fixture();
    const draft = (id: string) => ({ id, combinationKey: id, title: id, targetUser: "Procurement teams", jobToBeDone: "Reduce document editing time", hypothesis: "A hypothesis that requires user validation", projectIds: ["1", "2"], projectNames: ["sample/a", "sample/b"], score: 50, supportingEvidence: [], counterEvidence: [], validationSteps: ["Observe one actual work session"], successMetric: "One user retries with their own input", failureMetric: "No useful difference from current tools" });
    const first = { projectIds: ["1", "2"], question: "Can this combination reduce document processing time?" };
    const second = { ...first, question: "Can this combination preserve auditable citation metadata?" };
    store.saveOpportunities([draft("discovery")]);
    store.saveOpportunities([draft("focused-a")], first);
    store.saveOpportunities([draft("focused-b")], second);
    expect(store.getOpportunities()).toHaveLength(3);
    store.saveOpportunities([], first);
    expect(store.getOpportunities().map((item) => item.id).sort()).toEqual(["discovery", "focused-b"]);
    expect(store.getOpportunities("history")).toMatchObject([{ id: "focused-a", researchFocus: first, marketStatus: "unvalidated", status: "candidate", supersededAt: expect.any(String) }]);
    expect(store.getOpportunity("focused-b")?.researchFocus).toEqual(second);
    store.updateOpportunityStatus("focused-b", "saved");
    store.saveOpportunities([], second);
    store.saveOpportunities([]);
    expect(store.getOpportunities().map((item) => item.id)).toEqual(["focused-b"]);
    expect(store.getOpportunities("history").map((item) => item.id).sort()).toEqual(["discovery", "focused-a"]);
    store.close();
  });

  it("keeps candidates from different research profiles in separate scopes", () => {
    const { store } = fixture();
    const draft = (id: string) => ({ id, combinationKey: id, title: id, targetUser: "Procurement teams", jobToBeDone: "Reduce document editing time", hypothesis: "A hypothesis that requires user validation", projectIds: ["1", "2"], projectNames: ["sample/a", "sample/b"], score: 50, supportingEvidence: [], counterEvidence: [], validationSteps: ["Observe one actual work session"], successMetric: "One user retries with their own input", failureMetric: "No useful difference from current tools" });
    const first = { targetUser: "Procurement teams", recurringWork: "Review supplier PDFs", constraints: "Local" };
    const second = { ...first, constraints: "Browser" };
    store.saveOpportunities([draft("profile-a")], null, first);
    store.saveOpportunities([draft("profile-b")], null, second);
    expect(store.getOpportunities().map((item) => item.id).sort()).toEqual(["profile-a", "profile-b"]);
    store.saveOpportunities([], null, first);
    expect(store.getOpportunities().map((item) => item.id)).toEqual(["profile-b"]);
    expect(store.getOpportunities("history").map((item) => item.id)).toEqual(["profile-a"]);
    store.close();
  });

  it("keeps historical candidates across restart, reuses their identity, and preserves explicit follow-up decisions", () => {
    const { directory, store } = fixture();
    const draft = { id: "prior", combinationKey: "same-hypothesis", title: "Original hypothesis", targetUser: "Document reviewers", jobToBeDone: "Preserve review notes", hypothesis: "Needs independent validation", projectIds: ["1", "2"], projectNames: ["sample/a", "sample/b"], score: 50, supportingEvidence: [], counterEvidence: [], validationSteps: ["Observe a real workflow"], successMetric: "Repeat use", failureMetric: "Existing tool is enough" };
    store.saveOpportunities([draft]);
    store.saveOpportunities([]);
    expect(store.dashboard().opportunityCount).toBe(0);
    expect(store.getOpportunity(draft.id)?.marketStatus).toBe("unvalidated");
    store.close();
    const raw = new DatabaseSync(join(directory, "test.sqlite"));
    raw.prepare("UPDATE opportunities SET superseded_at=? WHERE id=?").run("2026-10-20T00:00:00Z", draft.id);
    raw.close();
    const reopened = new RadarStore(join(directory, "test.sqlite"));
    try {
      reopened.saveOpportunities([]);
      expect(reopened.getOpportunities("history")).toMatchObject([{ id: draft.id, supersededAt: "2026-10-20T00:00:00Z" }]);
      reopened.updateOpportunityStatus(draft.id, "saved");
      expect(reopened.getOpportunities("history")).toEqual([]);
      expect(reopened.getOpportunities()).toMatchObject([{ id: draft.id, status: "saved", marketStatus: "unvalidated" }]);
      reopened.saveOpportunities([{ ...draft, id: "new-generated-id", title: "Revised hypothesis" }]);
      expect(reopened.getOpportunities()).toMatchObject([{ id: draft.id, title: "Revised hypothesis", status: "saved", supersededAt: null }]);
      reopened.updateOpportunityStatus(draft.id, "candidate");
      reopened.saveOpportunities([]);
      reopened.updateOpportunityStatus(draft.id, "dismissed");
      expect(reopened.getOpportunities()).toEqual([]);
      expect(reopened.getOpportunities("history")).toEqual([]);
      reopened.saveOpportunities([draft]);
      expect(reopened.getOpportunities()).toEqual([]);
      expect(reopened.getOpportunity(draft.id)?.status).toBe("dismissed");
    } finally { reopened.close(); }
  });

  it("upgrades v7 history and source snapshots without fabricating a research question", () => {
    const { directory, store } = fixture();
    const item = repository();
    store.saveRepository(item, createRepositorySignal({ repositoryId: item.id, ...item }), 60, [], [], "2026-10-20T00:00:00Z");
    const id = store.createAnalysisRun("legacy-v7", "test");
    store.updateAnalysisUsage(id, { promptTokens: 9, completionTokens: 2, complete: false });
    store.failAnalysisRun(id, "Existing failure");
    store.close();
    const legacy = new DatabaseSync(join(directory, "test.sqlite"));
    legacy.exec("DROP TABLE demand_runs; DROP TABLE project_monitors; ALTER TABLE analysis_runs DROP COLUMN request_json; ALTER TABLE opportunities DROP COLUMN research_scope; ALTER TABLE projects DROP COLUMN issue_contexts_json; DROP TABLE research_notes; ALTER TABLE opportunities DROP COLUMN validation_progress_json; PRAGMA user_version = 7;");
    legacy.close();
    const migrated = new RadarStore(join(directory, "test.sqlite"));
    expect(migrated.getProject("42")?.readmeExcerpt).toBe(item.readmeExcerpt);
    expect(migrated.getAnalysisRun(id)).toMatchObject({ focus: null, status: "failed", usage: { promptTokens: 9, completionTokens: 2, complete: false } });
    migrated.close();
  });
  it("migrates v6 without losing evidence and persists documentation refresh failures and recovery", () => {
    const { directory, store } = fixture();
    const item = repository();
    store.saveRepository(item, createRepositorySignal({ repositoryId: item.id, ...item }), 60, [], [], "2026-10-20T00:00:00Z");
    store.close();
    const databasePath = join(directory, "test.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec("DROP TABLE demand_runs; DROP TABLE project_monitors; ALTER TABLE projects DROP COLUMN documentation_json; ALTER TABLE analysis_runs DROP COLUMN request_json; ALTER TABLE opportunities DROP COLUMN research_scope; ALTER TABLE projects DROP COLUMN issue_contexts_json; DROP TABLE research_notes; ALTER TABLE opportunities DROP COLUMN validation_progress_json; PRAGMA user_version = 6;");
    legacy.close();
    const migrated = new RadarStore(databasePath);
    expect(migrated.getProject("42")?.readmeExcerpt).toBe(item.readmeExcerpt);
    const report: RepositoryDocumentation = { documents: [{ path: "docs/cli.md", sha: "a".repeat(40), url: `${item.url}/blob/HEAD/docs/cli.md`, excerpt: "Accepts JSON data on standard input.", observedAt: "2026-10-20T00:00:00Z" }], attemptedPaths: ["docs/cli.md"], warnings: [], observedAt: "2026-10-20T00:00:00Z" };
    migrated.saveDocumentation("42", report, createDocumentationSignal("42", item.fullName, report));
    const failed = { ...report, documents: [], warnings: ["docs/cli.md: unavailable"], observedAt: "2026-10-20T01:00:00Z" };
    migrated.saveDocumentation("42", failed, createDocumentationSignal("42", item.fullName, failed));
    expect(migrated.getProject("42")?.documentation?.documents).toMatchObject([{ path: "docs/cli.md", sha: "a".repeat(40), stale: true }]);
    const recovered = { ...report, documents: [{ ...report.documents[0]!, sha: "b".repeat(40), stale: false }], observedAt: "2026-10-20T02:00:00Z" };
    migrated.saveDocumentation("42", recovered, createDocumentationSignal("42", item.fullName, recovered));
    expect(() => migrated.saveDocumentation("42", recovered, createDocumentationSignal("43", "other/repo", recovered))).toThrow("match the project");
    migrated.close();
    const reopened = new RadarStore(databasePath);
    expect(reopened.getProject("42")?.documentation?.documents).toMatchObject([{ path: "docs/cli.md", sha: "b".repeat(40), stale: false }]);
    reopened.close();
    const check = new DatabaseSync(databasePath);
    expect(check.prepare("PRAGMA user_version").get()?.user_version).toBe(16);
    expect(check.prepare("SELECT COUNT(*) AS count FROM signals WHERE event_type='github.documentation.observed'").get()?.count).toBe(3);
    check.close();
  });
  it("persists repositories and idempotently deduplicates W2A observation signals", () => {
    const { store } = fixture();
    const item = repository();
    const firstObservedAt = new Date(Date.now() - 60_000).toISOString();
    const signal = createRepositorySignal({
      repositoryId: item.id, fullName: item.fullName, url: item.url, description: item.description,
      language: item.language, license: item.license, stars: item.stars, forks: item.forks, openIssues: item.openIssues,
      createdAt: item.createdAt, pushedAt: item.pushedAt, readmeExcerpt: item.readmeExcerpt, releaseTag: item.releaseTag, releaseUrl: item.releaseUrl,
    });
    expect(store.saveRepository(item, signal, 60, [], ["Agent runtime", "Memory and retrieval"], firstObservedAt).signalInserted).toBe(true);
    const replay = createRepositorySignal({
      repositoryId: item.id, fullName: item.fullName, url: item.url, description: item.description,
      language: item.language, license: item.license, stars: item.stars, forks: item.forks, openIssues: item.openIssues,
      createdAt: item.createdAt, pushedAt: item.pushedAt, readmeExcerpt: item.readmeExcerpt, releaseTag: item.releaseTag, releaseUrl: item.releaseUrl,
    });
    expect(store.saveRepository(item, replay, 61, [], [], new Date().toISOString()).signalInserted).toBe(false);
    expect(store.getProjects()).toHaveLength(1);
    expect(store.getProjects()[0]?.fullName).toBe(item.fullName);
    expect(store.getProjects()[0]?.firstSeenAt).toBe(firstObservedAt);
    expect(store.dashboard().freshCount).toBe(1);
    store.close();
  });

  it("searches the local project cache across names, descriptions, and README excerpts without executing FTS operators", () => {
    const { store } = fixture();
    const first = { ...repository(), id: 42, fullName: "sample/markdown-notes", description: "Markdown notes for local research", readmeExcerpt: "Offline editor with full text search" };
    const second = { ...repository(), id: 43, fullName: "sample/agent-memory", description: "Persistent memory primitives", readmeExcerpt: "Vector memory for agents" };
    store.saveRepository(first, createRepositorySignal({ repositoryId: first.id, ...first }), 0, [], [], "2026-10-20T00:00:00Z");
    store.saveRepository(second, createRepositorySignal({ repositoryId: second.id, ...second }), 0, [], [], "2026-10-21T00:00:00Z");
    expect(store.searchProjects("markdown notes")).toMatchObject([{ fullName: "sample/markdown-notes", matchedFields: ["fullName", "description"], matchedEvidence: [{ field: "fullName" }, { field: "description", excerpt: expect.stringContaining("Markdown notes") }] }]);
    expect(store.searchProjects("offline editor")[0]?.fullName).toBe("sample/markdown-notes");
    expect(store.searchProjects("markdown notes missing")).toEqual([]);
    expect(store.searchProjectsDetailed("markdown notes missing", 12, { expandOnEmpty: true })).toMatchObject({
      expandedQueries: ["markdown", "notes"],
      items: [{ fullName: "sample/markdown-notes", matchedFields: ["fullName", "description"] }],
    });
    expect(store.searchProjects("agent OR NOT")).toEqual([]);
    expect(() => store.searchProjects("   ")).toThrow("project_search_query_required");
    expect(() => store.searchProjects("!@#$")).toThrow("project_search_query_invalid");
    store.close();
  });

  it("keeps enriched evidence when GitHub detail requests are rate limited", () => {
    const { store } = fixture();
    const original = repository();
    const observedAt = new Date(Date.now() - 60_000).toISOString();
    const originalSignal = createRepositorySignal({
      repositoryId: original.id, fullName: original.fullName, url: original.url, description: original.description,
      language: original.language, license: original.license, stars: original.stars, forks: original.forks, openIssues: original.openIssues,
      createdAt: original.createdAt, pushedAt: original.pushedAt, readmeExcerpt: original.readmeExcerpt, releaseTag: "v1.0.0", releaseUrl: "https://github.com/sample/agent-memory/releases/tag/v1.0.0",
    });
    store.saveRepository({ ...original, releaseTag: "v1.0.0", releaseUrl: "https://github.com/sample/agent-memory/releases/tag/v1.0.0" }, originalSignal, 60, [], [], observedAt);

    const limited = { ...original, readmeExcerpt: null, releaseTag: null, releaseUrl: null, readmeFetchSucceeded: false, releaseFetchSucceeded: false, warning: "GitHub API rate limit reached" };
    const limitedSignal = createRepositorySignal({
      repositoryId: limited.id, fullName: limited.fullName, url: limited.url, description: limited.description,
      language: limited.language, license: limited.license, stars: limited.stars, forks: limited.forks, openIssues: limited.openIssues,
      createdAt: limited.createdAt, pushedAt: limited.pushedAt, readmeExcerpt: limited.readmeExcerpt, releaseTag: limited.releaseTag, releaseUrl: limited.releaseUrl,
    });
    store.saveRepository(limited, limitedSignal, 45, [], [], new Date().toISOString());

    expect(store.getProject(String(original.id))).toMatchObject({
      readmeExcerpt: original.readmeExcerpt,
      releaseTag: "v1.0.0",
      releaseUrl: "https://github.com/sample/agent-memory/releases/tag/v1.0.0",
    });

    const emptyReadme = { ...original, readmeExcerpt: null, releaseTag: null, releaseUrl: null, readmeFetchSucceeded: true, releaseFetchSucceeded: false, warning: "GitHub API rate limit reached" };
    const emptySignal = createRepositorySignal({
      repositoryId: emptyReadme.id, fullName: emptyReadme.fullName, url: emptyReadme.url, description: emptyReadme.description,
      language: emptyReadme.language, license: emptyReadme.license, stars: emptyReadme.stars, forks: emptyReadme.forks, openIssues: emptyReadme.openIssues,
      createdAt: emptyReadme.createdAt, pushedAt: emptyReadme.pushedAt, readmeExcerpt: emptyReadme.readmeExcerpt, releaseTag: emptyReadme.releaseTag, releaseUrl: emptyReadme.releaseUrl,
    });
    store.saveRepository(emptyReadme, emptySignal, 20, [], [], new Date().toISOString());
    expect(store.getProject(String(original.id))).toMatchObject({ readmeExcerpt: null, releaseTag: "v1.0.0", releaseUrl: "https://github.com/sample/agent-memory/releases/tag/v1.0.0" });

    const emptyRelease = { ...emptyReadme, releaseFetchSucceeded: true, warning: null };
    const emptyReleaseSignal = createRepositorySignal({
      repositoryId: emptyRelease.id, fullName: emptyRelease.fullName, url: emptyRelease.url, description: emptyRelease.description,
      language: emptyRelease.language, license: emptyRelease.license, stars: emptyRelease.stars, forks: emptyRelease.forks, openIssues: emptyRelease.openIssues,
      createdAt: emptyRelease.createdAt, pushedAt: emptyRelease.pushedAt, readmeExcerpt: emptyRelease.readmeExcerpt, releaseTag: emptyRelease.releaseTag, releaseUrl: emptyRelease.releaseUrl,
    });
    store.saveRepository(emptyRelease, emptyReleaseSignal, 20, [], [], new Date().toISOString());
    expect(store.getProject(String(original.id))).toMatchObject({ readmeExcerpt: null, releaseTag: null, releaseUrl: null });
    store.close();
  });

  it("upgrades a v2 database and backfills first discovery from stored raw events", () => {
    const { directory, store } = fixture();
    const item = repository();
    const firstObservedAt = new Date(Date.now() - 60_000).toISOString();
    const signal = createRepositorySignal({
      repositoryId: item.id, fullName: item.fullName, url: item.url, description: item.description,
      language: item.language, license: item.license, stars: item.stars, forks: item.forks, openIssues: item.openIssues,
      createdAt: item.createdAt, pushedAt: item.pushedAt, readmeExcerpt: item.readmeExcerpt, releaseTag: item.releaseTag, releaseUrl: item.releaseUrl,
    });
    store.saveRepository(item, signal, 60, [], [], firstObservedAt);
    store.close();

    const databasePath = join(directory, "test.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec("DROP TABLE demand_runs; DROP TABLE project_monitors; DROP TABLE analysis_runs; DROP TABLE project_observations; ALTER TABLE projects DROP COLUMN first_seen_at; ALTER TABLE projects DROP COLUMN issues_json; ALTER TABLE projects DROP COLUMN issues_fetched_at; ALTER TABLE projects DROP COLUMN discovery_channels_json; ALTER TABLE projects DROP COLUMN documentation_json; ALTER TABLE opportunities DROP COLUMN analysis_details_json; ALTER TABLE opportunities DROP COLUMN research_scope; ALTER TABLE job_runs DROP COLUMN discovery_json; ALTER TABLE projects DROP COLUMN issue_contexts_json; DROP TABLE research_notes; ALTER TABLE opportunities DROP COLUMN validation_progress_json; PRAGMA user_version = 2;");
    legacy.close();

    const migrated = new RadarStore(databasePath);
    expect(migrated.getProjects()).toHaveLength(1);
    expect(migrated.getProjects()[0]?.firstSeenAt).toBe(firstObservedAt);
    expect(migrated.dashboard().projectCount).toBe(1);
    migrated.close();
  });

  it("records validation outcomes without claiming that one observation validates a market", () => {
    const { store } = fixture();
    store.saveOpportunities([{
      id: "opportunity-1", combinationKey: "agent+memory:1:2", title: "Agent memory", targetUser: "Agent developers",
      jobToBeDone: "Reuse knowledge across sessions", hypothesis: "A technical capability combination worth testing.",
      projectIds: ["1", "2"], projectNames: ["a/agent", "b/memory"], score: 61,
      supportingEvidence: [], counterEvidence: [], validationSteps: ["Interview developers"],
      successMetric: "Three users confirm the issue", failureMetric: "No user confirms the issue",
    }]);
    expect(store.getOpportunities()[0]?.marketStatus).toBe("unvalidated");
    const recorded = store.recordExternalValidation("opportunity-1", { method: "interview", outcome: "refutes", note: "Interviewed five developers; all already use a reliable alternative." });
    expect(recorded?.marketStatus).toBe("evidence_recorded");
    expect(recorded?.status).toBe("validating");
    expect(recorded?.validationRecord?.method).toBe("interview");
    expect(recorded?.validationRecord?.outcome).toBe("refutes");
    expect(recorded?.validationRecords).toHaveLength(1);
    const second = store.recordExternalValidation("opportunity-1", { method: "trial", outcome: "inconclusive", note: "A second user tried the workflow; the result was mixed and needs a larger sample." });
    expect(second?.status).toBe("validating");
    expect(second?.validationRecords.map((item) => item.method)).toEqual(["interview", "trial"]);
    expect(second?.validationRecord?.method).toBe("trial");
    store.close();
  });

  it("upgrades v5 analysis history without inventing usage for old failures", () => {
    const { directory, store } = fixture();
    const failedId = store.createAnalysisRun("legacy-failed", "test-model");
    store.failAnalysisRun(failedId, "Old failed analysis");
    const succeededId = store.createAnalysisRun("legacy-succeeded", "test-model");
    store.close();
    const databasePath = join(directory, "test.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.prepare("UPDATE analysis_runs SET status='succeeded',result_json=? WHERE id=?").run(JSON.stringify({ drafts: [], usage: { promptTokens: 15, completionTokens: 3 } }), succeededId);
    legacy.exec("DROP TABLE demand_runs; DROP TABLE project_monitors; ALTER TABLE analysis_runs DROP COLUMN usage_json; ALTER TABLE analysis_runs DROP COLUMN request_json; ALTER TABLE opportunities DROP COLUMN research_scope; ALTER TABLE projects DROP COLUMN documentation_json; ALTER TABLE projects DROP COLUMN issue_contexts_json; DROP TABLE research_notes; ALTER TABLE opportunities DROP COLUMN validation_progress_json; PRAGMA user_version = 5;");
    legacy.close();
    const migrated = new RadarStore(databasePath);
    expect(migrated.listAnalysisRuns().find((run) => run.id === failedId)?.usage).toBeNull();
    expect(migrated.listAnalysisRuns().find((run) => run.id === succeededId)?.usage).toEqual({ promptTokens: 15, completionTokens: 3, complete: false });
    migrated.close();
  });

  it("caches completed model results but never failed or interrupted analysis", () => {
    const { store } = fixture();
    const failedId = store.createAnalysisRun("failed-input", "test-model");
    store.updateAnalysisUsage(failedId, { promptTokens: 10, completionTokens: 5, complete: false });
    store.failAnalysisRun(failedId, "Model timed out");
    expect(store.getCachedModelAnalysis("failed-input")).toBeNull();
    expect(store.listAnalysisRuns().find((run) => run.id === failedId)?.usage).toEqual({ promptTokens: 10, completionTokens: 5, complete: false });
    const unknownUsageId = store.createAnalysisRun("unknown-usage", "test-model");
    store.failAnalysisRun(unknownUsageId, "Connection closed before usage was returned");
    expect(store.listAnalysisRuns().find((run) => run.id === unknownUsageId)?.usage).toBeNull();
    const completedId = store.createAnalysisRun("stable-input", "test-model");
    const result = { provider: "deepseek" as const, model: "test-model", promptVersion: "test-v1", inputHash: "stable-input", drafts: [], rejected: 1, durationMs: 35, usage: { promptTokens: 50, completionTokens: 25, complete: true } };
    store.finishAnalysisRun(completedId, result);
    expect(store.getCachedModelAnalysis("stable-input")).toEqual(result);
    const interruptedId = store.createAnalysisRun("interrupted", "test-model");
    store.updateAnalysisUsage(interruptedId, { promptTokens: 8, completionTokens: 2, complete: false });
    const scan = store.createScanRun();
    store.recoverInterruptedRuns();
    expect(store.getCachedModelAnalysis("interrupted")).toBeNull();
    expect(store.listAnalysisRuns().find((run) => run.id === completedId)?.status).toBe("succeeded");
    expect(store.listAnalysisRuns().find((run) => run.status === "running")).toBeUndefined();
    expect(store.listAnalysisRuns().find((run) => run.id === interruptedId)?.usage).toEqual({ promptTokens: 8, completionTokens: 2, complete: false });
    expect(store.getScanRun(scan.id)?.status).toBe("failed");
    store.close();
  });

  it("persists validation-step execution separately from external market evidence", () => {
    const { store } = fixture();
    store.saveOpportunities([{ id: "step-progress", combinationKey: "v3:step-progress", title: "Step progress", targetUser: "Developers", jobToBeDone: "Validate a recurring workflow", hypothesis: "A testable hypothesis", projectIds: ["42", "43"], projectNames: ["sample/agent", "sample/export"], score: 50, supportingEvidence: [], counterEvidence: [], validationSteps: ["Interview one target user", "Try the workflow with a real file"], successMetric: "Repeated use", failureMetric: "No recurring need" }]);
    expect(store.getOpportunity("step-progress")).toMatchObject({ marketStatus: "unvalidated", validationProgress: [] });
    const completed = store.updateValidationStep("step-progress", 0, "completed", "User completed a 25-minute interview; no repeat use confirmed.");
    expect(completed).toMatchObject({ marketStatus: "unvalidated", status: "candidate", validationProgress: [{ index: 0, step: "Interview one target user", status: "completed", note: "User completed a 25-minute interview; no repeat use confirmed." }] });
    expect(store.updateValidationStep("step-progress", 9, "skipped", "Out of scope today")).toBeNull();
    const skipped = store.updateValidationStep("step-progress", 1, "skipped", "No authorized sample file is available.");
    expect(skipped?.validationProgress).toHaveLength(2);
    const reset = store.updateValidationStep("step-progress", 0, "pending", "");
    expect(reset?.validationProgress).toHaveLength(1);
    expect(reset?.validationProgress?.[0]?.index).toBe(1);
    store.close();
  });

  it("preserves Issue evidence on failed enrichment and records observation history", () => {
    const { store } = fixture();
    const issue = { id: 9, number: 9, title: "Need structured data export", bodyExcerpt: "I currently copy all table cells manually every week.", url: "https://github.com/sample/agent-memory/issues/9", state: "open" as const, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z", comments: 4, reactions: 2, authorAssociation: "NONE" };
    const first = { ...repository(), issues: [issue], issuesFetchSucceeded: true, issuesFetchedAt: "2026-10-20T00:00:00Z", discoveryChannels: ["新兴能力"] };
    store.saveRepository(first, createRepositorySignal({ repositoryId: first.id, ...first }), 50, [], [], "2026-10-20T00:00:00Z");
    const failed = { ...first, stars: 52, issues: [], issuesFetchSucceeded: false, issuesFetchedAt: null, discoveryChannels: ["自动化组件"] };
    store.saveRepository(failed, createRepositorySignal({ repositoryId: failed.id, ...failed }), 50, [], [], "2026-10-20T01:00:00Z");
    expect(store.getProject("42")).toMatchObject({ issues: [issue], issuesFetchedAt: first.issuesFetchedAt, discoveryChannels: ["新兴能力", "自动化组件"] });
    expect(store.getProjectObservations("42")).toHaveLength(2);
    expect(store.dashboard().issueSampleCount).toBe(1);
    store.saveOpportunities([{ id: "issue-grounded-opportunity", combinationKey: "v3:issue-grounded", title: "Issue-grounded opportunity", targetUser: "Procurement teams", jobToBeDone: "Turn a recurring manual workflow into reviewed structured output", hypothesis: "A grounded technical combination hypothesis.", projectIds: ["42", "43"], projectNames: ["sample/agent", "sample/export"], score: 50, supportingEvidence: [], counterEvidence: [], validationSteps: ["Run one public sample end-to-end"], successMetric: "One buyer confirms repeat use", failureMetric: "Current tools solve the issue", components: [{ projectId: "42", role: "Extract inputs from PDFs", input: "PDF document", output: "Rows" }], integrationPlan: "Write an adapter", alternatives: "Manual copy/paste", whyNow: "A new extraction project appeared", firstExperiment: "Run one sample for two hours", problemEvidence: [{ url: issue.url, quote: issue.bodyExcerpt, observedAt: issue.updatedAt, relation: "supports" }] }]);
    expect(store.getOpportunity("issue-grounded-opportunity")).toMatchObject({ components: [{ role: "Extract inputs from PDFs" }], integrationPlan: "Write an adapter", problemEvidence: [{ url: issue.url }] });
    const empty = { ...failed, issuesFetchSucceeded: true, issuesFetchedAt: "2026-10-20T02:00:00Z" };
    store.saveRepository(empty, createRepositorySignal({ repositoryId: empty.id, ...empty }), 50, [], [], "2026-10-20T02:00:00Z");
    expect(store.getProject("42")?.issues).toEqual([]);
    store.close();
  });
});

