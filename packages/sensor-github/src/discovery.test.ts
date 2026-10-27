import { describe, expect, it } from "vitest";
import { advanceDiscoveryProgress, buildDiscoveryPlan, type DiscoveryProgress } from "./discovery.js";

const settings = { searchQuery: "topic:robotics", createdWithinDays: 90, maxResults: 32, discoveryMode: "balanced" as const };
const day = new Date("2026-10-21T00:00:00Z");
const complete = (progress: DiscoveryProgress, hasMore = true) => {
  const plan = buildDiscoveryPlan(settings, day, progress).map((track) => ({ ...track, searchComplete: true, hasMore }));
  return advanceDiscoveryProgress(progress, plan);
};

describe("bounded discovery rotation", () => {
  it("alternates leader refresh with deeper exploration without growing the per-scan budget", () => {
    let progress: DiscoveryProgress = {};
    const pages = [];
    for (let round = 0; round < 42; round++) {
      const plan = buildDiscoveryPlan(settings, day, progress);
      pages.push(plan[0]!.page);
      expect(plan.reduce((total, track) => total + track.limit, 0)).toBe(32);
      progress = complete(progress);
    }
    expect(pages.slice(0, 7)).toEqual([1, 2, 1, 3, 1, 4, 1]);
    expect(pages.slice(36, 42)).toEqual([1, 20, 1, 2, 1, 3]);
  });

  it("continues across rolling dates and scheduling changes, resetting only affected query semantics", () => {
    const progress = complete({});
    const rescheduled = { ...settings, scanIntervalHours: 48 };
    expect(buildDiscoveryPlan(rescheduled, new Date("2026-10-22"), progress)[0]!.page).toBe(2);
    expect(buildDiscoveryPlan({ ...settings, searchQuery: "language:Rust" }, day, progress).map((track) => track.page)).toEqual([2, 2, 2, 2, 1]);
    expect(buildDiscoveryPlan({ ...settings, createdWithinDays: 180 }, day, progress).map((track) => track.page)).toEqual([1, 2, 2, 2, 1]);
    expect(buildDiscoveryPlan({ ...settings, maxResults: 33 }, day, progress).map((track) => track.page)).toEqual([2, 2, 1, 2, 2]);
    expect(buildDiscoveryPlan({ ...settings, discoveryMode: "custom" }, day, progress)[0]!.page).toBe(1);
  });

  it("does not advance failed, incomplete, skipped or historical channels", () => {
    const progress = complete({});
    const plan = buildDiscoveryPlan(settings, day, progress);
    const next = advanceDiscoveryProgress(progress, plan.map((track, index) => ({ ...track,
      ...(index === 0 ? { searchComplete: true, hasMore: true } : {}),
      ...(index === 1 ? { searchComplete: false, incomplete: true } : {}),
      ...(index === 2 ? { error: "quota" } : {}),
    })));
    expect(next.rising).toMatchObject({ page: 1, explorePage: 3 });
    for (const key of ["early", "automation", "data", "custom"]) expect(next[key]).toEqual(progress[key]);
  });

  it("returns to leaders at an empty last page and respects GitHub's 1000-item ceiling", () => {
    let progress = complete({});
    progress = complete(progress, false);
    expect(progress.rising).toMatchObject({ page: 1, explorePage: 2 });
    expect(complete(progress, false).rising).toMatchObject({ page: 1, explorePage: 2 });
    const custom = { ...settings, discoveryMode: "custom" as const, maxResults: 60 };
    let current: DiscoveryProgress = {};
    const pages = [];
    for (let round = 0; round < 34; round++) {
      const plan = buildDiscoveryPlan(custom, day, current);
      pages.push(plan[0]!.page);
      current = advanceDiscoveryProgress(current, plan.map((track) => ({ ...track, searchComplete: true, hasMore: true })));
    }
    expect(Math.max(...pages as number[])).toBe(16);
    expect(pages.slice(28, 32)).toEqual([1, 16, 1, 2]);
  });
});
