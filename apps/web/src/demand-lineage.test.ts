import { describe, expect, it } from "vitest";
import type { DemandRun, ResearchNoteView } from "./api";
import { currentGroupNotes, demandGroupEntry, groupDemandRuns, type LineageRun } from "./demand-lineage";

const run = (id: string, extra: Partial<LineageRun> = {}): LineageRun => ({ id, question: "same demand", retryOf: null, continuationOf: null, status: "succeeded", startedAt: `2026-10-23T0${id.length}:00:00Z`, ...extra });
describe("explicit demand lineage", () => {
  it("connects source studies and recovery without absorbing an independent identical question", () => {
    const runs = [run("a"), run("bb", { continuationOf: "a", status: "failed" }), run("ccc", { continuationOf: "a", retryOf: "bb", status: "partial" }), run("x")];
    const groups = groupDemandRuns(runs);
    expect(groups.map(group => group.runs.map(item => item.id))).toEqual([["a", "bb", "ccc"], ["x"]]);
    expect(groups[0]!.incomplete).toBe(false);
  });
  it("keeps edited retries and their studies separate from the original requirement", () => {
    const groups = groupDemandRuns([run("a"), run("bb", { retryOf: "a", question: "changed demand" }), run("ccc", { continuationOf: "bb", question: "changed demand" })]);
    expect(groups.map(group => group.runs.map(item => item.id))).toEqual([["bb", "ccc"], ["a"]]);
  });
  it("does not invent a missing shared ancestor or silently claim complete history", () => {
    const groups = groupDemandRuns([run("a", { continuationOf: "missing" }), run("bb", { continuationOf: "missing" })]);
    expect(groups).toHaveLength(2);
    expect(groups.every(group => group.incomplete)).toBe(true);
  });
  it("terminates on cyclic links and preserves both tasks", () => {
    const groups = groupDemandRuns([run("a", { retryOf: "bb" }), run("bb", { retryOf: "a" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.runs.map(item => item.id)).toEqual(["a", "bb"]);
  });
  it("includes a directly opened ancestor outside the history window without losing its descendants", () => {
    const groups = groupDemandRuns([run("bb", { continuationOf: "a" })], { ...run("a"), snapshot: null } as DemandRun);
    expect(groups[0]!.runs.map(item => item.id)).toEqual(["a", "bb"]);
    expect(groups[0]!.incomplete).toBe(false);
  });
  it("opens the original usable report rather than an older failure or a newer failed study", () => {
    const group = groupDemandRuns([run("a", { status: "failed" }), run("bb", { retryOf: "a" }), run("ccc", { continuationOf: "bb", status: "failed" })])[0]!;
    expect(demandGroupEntry(group).id).toBe("bb");
  });
  it("keeps a newer failure distinct from older active decisions, retaining conflicting active decisions", () => {
    const group = groupDemandRuns([run("a"), run("bb", { continuationOf: "a", status: "failed" })])[0]!;
    const note = (id: string, originDemandId: string, createdAt: string, supersededBy: string | null = null) => ({ id, originDemandId, createdAt, supersededBy }) as ResearchNoteView;
    const notes = [note("old", "a", "2026-01", "revised"), note("revised", "a", "2026-02"), note("another", "a", "2026-03"), note("foreign", "other", "2026-04")];
    const before = JSON.stringify({ group, notes });
    expect(currentGroupNotes(group, notes).map(item => item.id)).toEqual(["another", "revised"]);
    expect(group.runs.at(-1)!.status).toBe("failed");
    expect(JSON.stringify({ group, notes })).toBe(before);
  });
});
