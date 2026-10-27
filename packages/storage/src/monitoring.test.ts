import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRepositorySignal, createIssueContextSignal, type IssueContext } from "@radar/contracts";
import { RadarStore } from "./index.js";
const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const time = "2026-10-20T00:00:00.000Z";
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "radar-monitor-store-")); directories.push(directory);
  const path = join(directory, "test.sqlite"), store = new RadarStore(path);
  for (const id of [1, 2, 3]) {
    const repository = { id, fullName: `fixture/component-${id}`, description: "A local file interface", language: "Python", license: "MIT", stars: 1, forks: 0, openIssues: 0, createdAt: time, pushedAt: time, url: `https://github.com/fixture/component-${id}`, readmeExcerpt: "Accept local CSV files", releaseTag: "v1", releaseUrl: null, raw: { id }, warning: null };
    store.saveRepository(repository, createRepositorySignal({ repositoryId: id, ...repository }), 0, [], [], time);
  }
  return { path, store };
}
it("upgrades schema 10 without enrolling old projects or losing their evidence", () => {
  const { path, store } = setup(), before = store.getProjects(); store.close();
  const legacy = new DatabaseSync(path); legacy.exec("DROP TABLE demand_runs; DROP TABLE project_monitors; ALTER TABLE opportunities DROP COLUMN validation_progress_json; PRAGMA user_version=10"); legacy.close();
  const next = new RadarStore(path);
  expect(next.getProjects()).toEqual(before); expect(next.listProjectMonitors()).toEqual([]); next.close();
  const check = new DatabaseSync(path); try { expect(check.prepare("PRAGMA user_version").get()?.user_version).toBe(16); expect(check.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok"); } finally { check.close(); }
});
it("persists opt-in, preserves a prior successful result after interruption, and does not re-enable a cancelled watch", () => {
  const { path, store } = setup();
  store.setProjectMonitor("1", true, time);
  store.beginMonitorAttempt("1", time, "2026-10-21T00:00:00.000Z");
  store.finishMonitorAttempt("1", { status: "succeeded", finishedAt: time, nextDueAt: "2026-10-21T00:00:00.000Z", changes: { stars: 3, releaseBefore: null, releaseAfter: "v1", readmeChanged: false } });
  store.beginMonitorAttempt("1", "2026-10-21T00:00:00.000Z", "2026-10-22T00:00:00.000Z"); store.setProjectMonitor("1", false, "2026-10-21T00:00:00.000Z"); store.close();
  const next = new RadarStore(path); next.recoverInterruptedMonitors("2026-10-21T00:01:00.000Z");
  expect(next.getProjectMonitor("1")).toMatchObject({ enabled: false, status: "failed", errorCode: "interrupted", lastSuccessAt: time, nextDueAt: "2026-10-21T00:02:00.000Z", changes: { stars: 3 } });
  expect(next.listProjectMonitors()).toEqual([]); expect(next.dueProjectMonitors("2026-10-22T00:00:00.000Z")).toEqual([]); next.close();
});
it("keeps due selection bounded and adjusts the next successful check when the configured interval changes", () => {
  const { store } = setup();
  store.setProjectMonitor("1", true, time, 2); store.setProjectMonitor("2", true, time, 2);
  expect(() => store.setProjectMonitor("3", true, time, 2)).toThrow("monitor_limit"); expect(store.listProjectMonitors()).toHaveLength(2);
  store.beginMonitorAttempt("1", time, "2026-10-21T00:00:00.000Z");
  store.finishMonitorAttempt("1", { status: "succeeded", finishedAt: time, nextDueAt: "2026-10-21T00:00:00.000Z" });
  store.updateSettings({ ...store.getSettings(), scanIntervalHours: 6 });
  expect(store.getProjectMonitor("1")?.nextDueAt).toBe("2026-10-20T06:00:00.000Z");
  expect(store.dueProjectMonitors(time, 1).map((item) => item.projectId)).toEqual(["2"]);
  store.setProjectMonitor("2", false, time); store.setProjectMonitor("3", true, time, 2);
  expect(store.listProjectMonitors().map((item) => item.projectId)).toEqual(["1", "3"]); store.close();
});

it("upgrades schema 11 without changing existing monitor state or enrolling discussions", () => {
  const { path, store } = setup(); store.setProjectMonitor("1", true, time);
  const previous = store.getProjectMonitor("1"); store.close();
  const legacy = new DatabaseSync(path); legacy.exec("DROP TABLE demand_runs; ALTER TABLE project_monitors DROP COLUMN issues_json; ALTER TABLE opportunities DROP COLUMN validation_progress_json; PRAGMA user_version=11"); legacy.close();
  const next = new RadarStore(path);
  expect(next.getProjectMonitor("1")).toEqual(previous); expect(next.getProjectMonitor("1")?.issues).toEqual([]); next.close();
  const db = new DatabaseSync(path); try { expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(16); expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok"); } finally { db.close(); }
});

it("pins tracked discussions within the ten-snapshot budget and retains unread changes across restarts", () => {
  const { path, store } = setup();
  function snapshot(number: number): IssueContext {
    return { selectedForResearch: true, issue: { id: number, number, title: `Discussion ${number}`, bodyExcerpt: "Need to preserve this older discussion", url: `https://github.com/fixture/component-1/issues/${number}`, state: "open", stateReason: null, closedAt: null, createdAt: time, updatedAt: time, comments: 0, reactions: 0, authorAssociation: "NONE", bodyTruncated: false }, comments: [], commentsError: null, commentsComplete: true, commentsObservedAt: time, observedAt: new Date(Date.parse(time) + number * 1000).toISOString() };
  }
  const save = (context: IssueContext) => store.saveIssueContext("1", context, createIssueContextSignal("1", "fixture/component-1", context));
  save(snapshot(1)); store.setMonitoredIssue("1", 1, true, time);
  for (let number = 2; number <= 15; number++) save(snapshot(number));
  expect(Object.keys(store.getProject("1")!.issueContexts!)).toHaveLength(10);
  expect(store.getProject("1")?.issues?.some((issue) => issue.number === 1)).toBe(true);
  const subscription = store.getProjectMonitor("1")!.issues[0]!;
  const changed = { ...snapshot(1), issue: { ...snapshot(1).issue, state: "closed" as const } };
  store.recordMonitoredIssueCheck("1", subscription.id, time, { context: changed });
  expect(store.listMonitorIssueChanges()).toHaveLength(1); const saved = store.getProjectMonitor("1"); store.close();
  const next = new RadarStore(path);
  expect(next.getProjectMonitor("1")).toEqual(saved); expect(next.listMonitorIssueChanges()).toHaveLength(1); expect(next.listProjectMonitors()).toEqual([]); next.close();
});

