import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createIssueContextSignal, createRepositorySignal, type IssueContext } from "@radar/contracts";
import { RadarStore } from "./index.js";

it("persists explicit sample truncation without inventing legacy completeness", () => {
  const store = new RadarStore(":memory:");
  try {
    const legacy = { ...context.issue, number: 8, id: 8 }; Reflect.deleteProperty(legacy, "bodyTruncated");
    const issues = [{ ...context.issue, bodyExcerpt: "x".repeat(2000), bodyTruncated: true }, legacy];
    const item = { ...repository, issues, issuesFetchSucceeded: true };
    const signal = createRepositorySignal({ repositoryId: item.id, ...item });
    expect(signal.source_event?.data.issues).toEqual(issues);
    store.saveRepository(item, signal, 10, [], [], context.observedAt);
    const saved = store.getProject("42")!;
    expect(saved.issues).toEqual(issues);
    expect(JSON.parse(JSON.stringify(saved)).issues[0].bodyTruncated).toBe(true);
    expect(JSON.parse(JSON.stringify(saved)).issues[1]).not.toHaveProperty("bodyTruncated");
  } finally { store.close(); }
});

const repository = { id: 42, fullName: "sample/editor", description: "An image editor", url: "https://github.com/sample/editor", language: "Rust", license: "MIT", stars: 10, forks: 1, openIssues: 1, createdAt: "2026-10-01T00:00:00Z", pushedAt: "2026-10-20T00:00:00Z", readmeExcerpt: "Public image editing API.", releaseTag: null, releaseUrl: null, raw: { id: 42 }, warning: null };
const context: IssueContext = { issue: { id: 7, number: 7, title: "External editor workflow", bodyExcerpt: "Keep image position and native depth.", bodyTruncated: false, url: `${repository.url}/issues/7`, state: "open", stateReason: null, closedAt: null, createdAt: repository.createdAt, updatedAt: repository.pushedAt, comments: 1, reactions: 0, authorAssociation: "NONE", authorLogin: "reporter" }, comments: [{ id: 99, url: `${repository.url}/issues/7#issuecomment-99`, bodyExcerpt: "A bridge exists with placement limitations.", bodyTruncated: false, authorLogin: "contributor", authorAssociation: "CONTRIBUTOR", isBot: false, createdAt: repository.createdAt, updatedAt: repository.pushedAt }], commentsComplete: true, commentsError: null, commentsObservedAt: "2026-10-20T02:00:00Z", observedAt: "2026-10-20T02:00:00Z" };

it.each([undefined, "first-and-latest" as const])("retains legacy/new sampling (%s), samples and W2A snapshots across failure, migration and restart", (sampling) => {
  const directory = mkdtempSync(join(tmpdir(), "radar-issue-store-")), path = join(directory, "test.sqlite");
  let store = new RadarStore(path);
  try {
    const item = { ...repository, issues: [context.issue], issuesFetchSucceeded: true, issuesFetchedAt: "2026-10-20T00:00:00Z" };
    store.saveRepository(item, createRepositorySignal({ repositoryId: item.id, ...item }), 10, [], [], item.issuesFetchedAt);
    store.close();
    const legacy = new DatabaseSync(path); legacy.exec("DROP TABLE demand_runs; DROP TABLE project_monitors; ALTER TABLE projects DROP COLUMN issue_contexts_json; DROP TABLE research_notes; ALTER TABLE opportunities DROP COLUMN validation_progress_json; PRAGMA user_version=8;"); legacy.close();
    store = new RadarStore(path);
    expect(store.getProject("42")?.issueContexts).toEqual({});
    const sampled = { ...context, ...(sampling ? { commentSampling: sampling } : {}) };
    store.saveIssueContext("42", sampled, createIssueContextSignal("42", repository.fullName, sampled));
    expect(() => store.saveIssueContext("42", context, createIssueContextSignal("43", repository.fullName, context))).toThrow("match");
    const partial = { ...context, commentSampling: "first" as const, comments: [], commentsComplete: false, commentsError: "quota exhausted", commentsObservedAt: null, observedAt: "2026-10-20T03:00:00Z" };
    const saved = store.saveIssueContext("42", partial, createIssueContextSignal("42", repository.fullName, partial));
    expect(saved.comments).toEqual(context.comments);
    expect(saved.commentsObservedAt).toBe(context.commentsObservedAt);
    expect(saved.commentsError).toBe("quota exhausted");
    expect(saved.commentSampling).toBe(sampling);
    expect(store.getProject("42")?.issues).toEqual([context.issue]);
    expect(store.getProject("42")?.issuesFetchedAt).toBe(item.issuesFetchedAt);
    store.close(); store = new RadarStore(path);
    expect(store.getProject("42")?.issueContexts?.["7"]).toEqual(saved);
    const db = new DatabaseSync(path, { readOnly: true });
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(16);
    expect(db.prepare("SELECT count(*) n FROM signals WHERE event_type='github.issue.context.observed'").get()?.n).toBe(2); db.close();
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

