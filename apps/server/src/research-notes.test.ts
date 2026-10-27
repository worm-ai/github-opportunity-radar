import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { createIssueContextSignal, createRepositorySignal, type IssueContext, type ResearchNoteInput } from "@radar/contracts";
import { RadarStore } from "@radar/storage";
import { registerResearchNoteRoutes, relatedResearchNotes } from "./research-notes.js";

const issue = { id: 7, number: 7, title: "Keep native depth during an editor round trip", bodyExcerpt: "The new layer must retain the original pixel values.", url: "https://github.com/fixture/editor/issues/7", state: "open" as const, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z", comments: 1, reactions: 0, authorAssociation: "NONE" };
const repository = { id: 1, fullName: "fixture/editor", description: "A local image editing component.", url: "https://github.com/fixture/editor", language: "Rust", license: "MIT", stars: 1, forks: 0, openIssues: 1, createdAt: issue.createdAt, pushedAt: issue.updatedAt, readmeExcerpt: "Images travel as 8-bit PNG. A lossless layer exchange remains unverified.", releaseTag: null, releaseUrl: null, raw: { id: 1 }, warning: null, issues: [issue], issuesFetchSucceeded: true };
const context: IssueContext = { issue: { ...issue, bodyTruncated: false, stateReason: null, closedAt: null }, comments: [{ id: 99, url: `${issue.url}#issuecomment-99`, bodyExcerpt: "A bridge already exists, but depth and position still need testing.", bodyTruncated: false, authorLogin: "author", authorAssociation: "NONE", isBot: false, createdAt: issue.createdAt, updatedAt: issue.updatedAt }], commentsComplete: true, commentsError: null, commentsObservedAt: "2026-10-20T01:00:00Z", observedAt: "2026-10-20T01:00:00Z" };
const input = (): ResearchNoteInput => ({ requestId: randomUUID(), author: "user", title: "Check the existing editor bridge first", question: "Does a new bridge solve anything that the existing implementation does not?", projectIds: ["1"], originIssue: { projectId: "1", issueNumber: 7 }, decision: "watch", conclusion: "An existing bridge is described, and its precision limits need an isolated reproduction.", nextAction: "Compare identity round trips before adding another component.", evidence: [{ ref: { projectId: "1", kind: "comment", issueNumber: 7, commentId: 99 }, quote: context.comments[0]!.bodyExcerpt }] });

it("saves PR status as technical evidence, preserves the original decision and excludes failed or outdated PR refreshes", async () => {
  const f = fixture();
  try {
    const pull = { number: 14, title: "Expose validator details", bodyExcerpt: "Render the existing diagnostic details in the report.", bodyTruncated: false, url: `${repository.url}/pull/14`, state: "closed" as const, draft: false, merged: true, mergedAt: "2026-10-19T13:37:27Z", mergeCommitSha: "a".repeat(40), updatedAt: context.issue.updatedAt };
    const checked = { ...context, referencedPullRequests: { items: [pull], checkedNumbers: [14], omitted: 0, notFoundNumbers: [], errors: [] } };
    f.store.saveIssueContext("1", checked, createIssueContextSignal("1", repository.fullName, checked));
    const payload = { ...input(), evidence: [{ ref: { projectId: "1", kind: "pull_request" as const, issueNumber: 7, pullRequestNumber: 14 }, quote: "merged: true\nmerged_at: 2026-10-19T13:37:27Z" }] };
    const response = await f.post(payload); expect(response.statusCode).toBe(201);
    const note = response.json();
    expect(note.evidence[0].url).toBe(pull.url);
    expect(note.evidence[0].notice).toContain("不证明修复覆盖");
    const same = { ...checked, observedAt: "2026-10-21T00:00:00Z" };
    f.store.saveIssueContext("1", same, createIssueContextSignal("1", repository.fullName, same));
    expect((await f.app.inject(`/research-notes/${note.id}`)).json().evidenceStates).toEqual(["same"]);
    const failed = { ...same, referencedPullRequests: { ...same.referencedPullRequests, items: [], errors: [{ number: 14, message: "network unavailable" }] } };
    f.store.saveIssueContext("1", failed, createIssueContextSignal("1", repository.fullName, failed));
    expect((await f.app.inject(`/research-notes/${note.id}`)).json()).toMatchObject({ evidence: note.evidence, evidenceStates: ["unavailable"] });
    expect((await f.post({ ...payload, requestId: randomUUID() })).statusCode).toBe(422);
    const stale = { ...checked, newestSampleUpdatedAt: "2026-10-21T00:00:00Z" };
    f.store.saveIssueContext("1", stale, createIssueContextSignal("1", repository.fullName, stale));
    expect((await f.post({ ...payload, requestId: randomUUID() })).statusCode).toBe(422);
    expect(f.store.listAnalysisRuns()).toEqual([]);
  } finally { await f.close(); }
});
function fixture(path = ":memory:") {
  const store = new RadarStore(path), app = Fastify();
  store.saveRepository(repository, createRepositorySignal({ repositoryId: 1, ...repository }), 0, [], [], issue.updatedAt);
  store.saveIssueContext("1", context, createIssueContextSignal("1", repository.fullName, context));
  registerResearchNoteRoutes(app, store);
  const post = (payload: unknown) => app.inject({ method: "POST", url: "/research-notes", headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
  return { app, store, post, close: async () => { await app.close(); store.close(); } };
}

it("saves a retained origin after rotation while rejecting stale or unknown origins", async () => {
  const f = fixture();
  const rotate = () => {
    const rotated = { ...repository, issues: [] };
    f.store.saveRepository(rotated, createRepositorySignal({ repositoryId: 1, ...rotated }), 0, [], [], "2026-10-22T00:00:00Z");
  };
  try {
    rotate();
    expect(f.store.getProject("1")?.issues).toEqual([]);
    const response = await f.post({ ...input(), author: "assistant" });
    expect(response.statusCode).toBe(201);
    const note = response.json();
    expect(note.evidenceStates).toEqual(["same"]);
    expect((await f.app.inject(`/research-notes/${note.id}/report.md`)).body).toContain(context.comments[0]!.bodyExcerpt);
    expect((await f.post({ ...input(), originIssue: { projectId: "1", issueNumber: 8 } })).statusCode).toBe(400);
    const stale = { ...context, newestSampleUpdatedAt: "2026-10-21T00:00:00Z" };
    f.store.saveIssueContext("1", stale, createIssueContextSignal("1", repository.fullName, stale));
    expect((await f.post(input())).statusCode).toBe(400);
    expect((await f.app.inject(`/research-notes/${note.id}`)).json()).toMatchObject({ evidence: note.evidence, evidenceStates: ["unavailable"] });
  } finally { await f.close(); }
});

it("links research decisions to an opportunity without treating shared projects as an exact match", async () => {
  const f = fixture();
  try {
    const note = (await f.post(input())).json();
    expect(relatedResearchNotes(f.store, ["missing"])).toEqual([]);
    expect(relatedResearchNotes(f.store, ["1"])).toMatchObject([{ id: note.id, relation: "exact", sharedProjectIds: ["1"], evidenceStates: ["same"] }]);
    expect(relatedResearchNotes(f.store, ["1", "other"])).toMatchObject([{ id: note.id, relation: "partial", sharedProjectIds: ["1"] }]);
  } finally { await f.close(); }
});

it("binds immutable manual decisions to exact source URLs and keeps them separate from market/model results", async () => {
  const f = fixture();
  try {
    const saved = await f.post({ ...input(), author: "assistant" }); expect(saved.statusCode).toBe(201);
    const note = saved.json();
    expect(note).toMatchObject({ author: "assistant", decision: "watch", projectNames: [repository.fullName], evidenceStates: ["same"], evidence: [{ url: context.comments[0]!.url, quote: context.comments[0]!.bodyExcerpt, observedAt: context.observedAt }] });
    expect(f.store.getOpportunities()).toEqual([]); expect(f.store.listAnalysisRuns()).toEqual([]);
    expect((await f.app.inject(`/research-notes/${note.id}`)).json()).toEqual(note);
    expect((await f.app.inject(`/research-notes/${randomUUID()}`)).statusCode).toBe(404);
  } finally { await f.close(); }
});

it("rejects unknown projects, false origins, invented quotes, mismatched comment IDs and injected URLs", async () => {
  const f = fixture();
  try {
    const good = input();
    for (const changed of [{ projectIds: ["1", "1"] }, { projectIds: ["missing"] }, { originIssue: { projectId: "2", issueNumber: 7 } }, { originIssue: { projectId: "1", issueNumber: 8 } }, { evidence: [{ ...good.evidence[0], url: "https://evil.invalid" }] }]) expect((await f.post({ ...good, ...changed })).statusCode).toBe(400);
    for (const evidence of [[{ ...good.evidence[0], quote: "An invented quote does not become source evidence." }], [{ ...good.evidence[0], ref: { projectId: "1", kind: "comment", issueNumber: 7, commentId: 123 } }], [{ ...good.evidence[0], ref: { projectId: "2", kind: "comment", issueNumber: 7, commentId: 99 } }]]) expect((await f.post({ ...good, evidence })).statusCode).toBe(422);
    expect(f.store.listResearchNotes()).toEqual([]);
  } finally { await f.close(); }
});

it("treats same-content refreshes as unchanged and warns when another comment changes the discussion", async () => {
  const f = fixture();
  try {
    const note = (await f.post(input())).json();
    const refreshed = { ...context, observedAt: "2026-10-20T02:00:00Z", commentsObservedAt: "2026-10-20T02:00:00Z" };
    f.store.saveIssueContext("1", refreshed, createIssueContextSignal("1", repository.fullName, refreshed));
    expect((await f.app.inject(`/research-notes/${note.id}`)).json().evidenceStates).toEqual(["same"]);
    const changed = { ...refreshed, issue: { ...refreshed.issue, comments: 2 }, comments: [...refreshed.comments, { ...refreshed.comments[0]!, id: 100, bodyExcerpt: "Counterexample: the depth flag alone does not prove pixel precision." }] };
    f.store.saveIssueContext("1", changed, createIssueContextSignal("1", repository.fullName, changed));
    const updated = (await f.app.inject(`/research-notes/${note.id}`)).json();
    expect(updated.evidenceStates).toEqual(["changed"]); expect(updated.evidence).toEqual(note.evidence);
  } finally { await f.close(); }
});

it("preserves old snapshots after failed/outdated refreshes and does not accept them as new evidence", async () => {
  const f = fixture();
  try {
    const payload = input(), note = (await f.post(payload)).json();
    const failed = { ...context, comments: [], commentsError: "unavailable", commentsComplete: false, commentsObservedAt: null, observedAt: "2026-10-20T02:00:00Z" };
    f.store.saveIssueContext("1", failed, createIssueContextSignal("1", repository.fullName, failed));
    expect((await f.app.inject(`/research-notes/${note.id}`)).json()).toMatchObject({ evidenceStates: ["unavailable"], evidence: note.evidence });
    expect((await f.post({ ...payload, requestId: randomUUID() })).statusCode).toBe(422);
    const updated = { ...repository, issues: [{ ...issue, updatedAt: "2026-10-21T00:00:00Z" }] };
    f.store.saveRepository(updated, createRepositorySignal({ repositoryId: 1, ...updated }), 0, [], [], "2026-10-21T00:00:00Z");
    expect((await f.post({ ...payload, requestId: randomUUID() })).statusCode).toBe(422);
    expect((await f.post(payload)).json().id).toBe(note.id); // Network retry returns the original saved result.
    expect((await f.post({ ...payload, conclusion: "A changed request must not reuse the same submission ID." })).statusCode).toBe(409);
  } finally { await f.close(); }
});

it("exports the sampling boundary and retains an immutable quote when a later sample omits its comment", async () => {
  const f = fixture();
  try {
    const sampled = { ...context, commentSampling: "first-and-latest" as const, commentsComplete: false, issue: { ...context.issue, comments: 22 } };
    f.store.saveIssueContext("1", sampled, createIssueContextSignal("1", repository.fullName, sampled));
    const note = (await f.post(input())).json();
    expect(note.evidence[0].notice).toContain("中间可能遗漏");
    const report = await f.app.inject(`/research-notes/${note.id}/report.md`);
    expect(report.body).toContain("中间可能遗漏");
    const next = { ...sampled, comments: [{ ...sampled.comments[0]!, id: 100, bodyExcerpt: "The maintainer has since provided a different existing solution." }] };
    f.store.saveIssueContext("1", next, createIssueContextSignal("1", repository.fullName, next));
    expect((await f.app.inject(`/research-notes/${note.id}`)).json()).toMatchObject({ evidenceStates: ["unavailable"], evidence: note.evidence });
    expect((await f.post(input())).statusCode).toBe(422);
  } finally { await f.close(); }
});

it.each([
  [true, "正文截断"], [false, "正文未截断"], [undefined, "正文截断状态未知（旧档案）"],
] as const)("exports the saved Issue completeness boundary (%s) without rewriting history", async (truncated, notice) => {
  const f = fixture();
  try {
    // A newer automatic sample makes the older discussion context ineligible.
    const sampled = { ...issue, updatedAt: "2026-10-21T00:00:00Z", ...(truncated === undefined ? {} : { bodyTruncated: truncated }) };
    const project = { ...repository, issues: [sampled] };
    f.store.saveRepository(project, createRepositorySignal({ repositoryId: 1, ...project }), 0, [], [], sampled.updatedAt);
    const payload = { ...input(), evidence: [{ ref: { projectId: "1", kind: "issue" as const, issueNumber: 7 }, quote: issue.bodyExcerpt }] };
    const response = await f.post(payload); expect(response.statusCode).toBe(201);
    const note = response.json();
    expect(note.evidenceStates).toEqual(["same"]);
    expect(note.evidence[0].notice).toContain(notice);
    const report = await f.app.inject("/research-notes/" + note.id + "/report.md");
    expect(report.statusCode).toBe(200);
    expect(report.body).toContain("- 边界：" + note.evidence[0].notice);
    expect(report.body).toContain("    " + issue.bodyExcerpt);
    const checked = { ...context, issue: { ...context.issue, updatedAt: sampled.updatedAt, bodyTruncated: false }, observedAt: "2026-10-22T00:00:00Z" };
    f.store.saveIssueContext("1", checked, createIssueContextSignal("1", repository.fullName, checked));
    const updated = (await f.app.inject("/research-notes/" + note.id)).json();
    expect(updated.evidenceStates).toEqual(["changed"]);
    expect(updated.evidence).toEqual(note.evidence);
    expect((await f.app.inject("/research-notes/" + note.id + "/report.md")).body).toContain("- 边界：" + note.evidence[0].notice);
    expect(f.store.listAnalysisRuns()).toEqual([]);
    expect(f.store.getOpportunities()).toEqual([]);
  } finally { await f.close(); }
});

it("records revisions without erasing original evidence or allowing concurrent branches", async () => {
  const f = fixture();
  try {
    const payload = input(), first = (await f.post(payload)).json();
    const revision = { ...payload, requestId: randomUUID(), supersedesId: first.id, decision: "stop", conclusion: "The existing bridge already covers the general workflow; stop duplicating it." };
    const next = await f.post(revision); expect(next.statusCode).toBe(201);
    expect((await f.app.inject(`/research-notes/${first.id}`)).json()).toMatchObject({ decision: "watch", evidence: first.evidence, supersededBy: next.json().id });
    expect((await f.post({ ...revision, requestId: randomUUID() })).statusCode).toBe(409);
    expect(f.store.listResearchNotes()).toHaveLength(2);
  } finally { await f.close(); }
});

it("exports untrusted manual text as data and keeps source quotes literal", async () => {
  const f = fixture();
  try {
    const payload = { ...input(), conclusion: "<script>alert('x')</script> [misleading](https://evil.invalid) is untrusted manual text." };
    const note = (await f.post(payload)).json(), report = await f.app.inject(`/research-notes/${note.id}/report.md`);
    expect(report.statusCode).toBe(200); expect(report.headers["content-disposition"]).toContain("attachment");
    expect(report.body).toContain("&lt;script&gt;"); expect(report.body).not.toContain("<script>");
    expect(report.body).toContain(`    ${payload.evidence[0]!.quote}`); expect(report.body).toContain("不是模型机会");
    expect(report.body).toContain(`[原始来源](${context.comments[0]!.url})`);
  } finally { await f.close(); }
});

it("migrates v9 and preserves research decisions across a real SQLite restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "radar-research-notes-")), path = join(directory, "test.sqlite");
  const initial = new RadarStore(path); initial.close();
  const legacy = new DatabaseSync(path); legacy.exec("DROP TABLE demand_runs; DROP TABLE project_monitors; DROP TABLE research_notes; ALTER TABLE opportunities DROP COLUMN validation_progress_json; PRAGMA user_version=9;"); legacy.close();
  const f = fixture(path);
  let closed = false;
  try {
    const note = (await f.post(input())).json(); await f.app.close(); f.store.close(); closed = true;
    const reopened = new RadarStore(path);
    try { expect(reopened.getResearchNote(note.id)?.evidence).toEqual(note.evidence); expect(reopened.getProject("1")?.issueContexts?.["7"]).toEqual(context); } finally { reopened.close(); }
    const db = new DatabaseSync(path, { readOnly: true });
    try { expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(16); expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok"); } finally { db.close(); }
  } finally {
    if (!closed) { await f.app.close(); f.store.close(); }
    const target = resolve(directory), parent = resolve(tmpdir());
    if (!target.startsWith(`${parent}\\radar-research-notes-`) && !target.startsWith(`${parent}/radar-research-notes-`)) throw new Error("Unexpected temporary test directory");
    rmSync(target, { recursive: true, force: true });
  }
});

