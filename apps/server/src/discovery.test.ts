import { expect, it } from "vitest";
import type { ProjectRecord, ProjectObservation } from "@radar/storage";
import { buildDiscoveryBrief, discoveryProfile, observationSummary } from "./discovery.js";

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "1", fullName: "sample/project", url: "https://github.com/sample/project",
    description: null, readmeExcerpt: null, language: null, license: null,
    stars: 0, forks: 0, openIssues: 0, releaseTag: null, releaseUrl: null,
    createdAt: "2020-01-01T00:00:00.000Z", pushedAt: null,
    firstSeenAt: "2026-10-20T09:01:00.000Z", observedAt: "2026-10-20T09:01:00.000Z",
    score: 0, scoreReasons: [], capabilities: [], raw: {}, warning: null, ...overrides,
  };
}
function observation(observedAt: string, releaseTag: string | null, stars = 10): ProjectObservation {
  return { projectId: "1", observedAt, releaseTag, stars, forks: 1, openIssues: 1 };
}

it("exposes non-AI capabilities as exact source excerpts and leaves broad descriptions unclassified", () => {
  for (const [description, id] of [
    ["An agent skill for real maps: data maps and city posters as HTML, SVG and PNG.", "maps"],
    ["An open-source AI Office suite to create real .docx/.xlsx/.pptx files locally.", "office"],
    ["Local video workspace for timeline editing, subtitles and audio mixing.", "video"],
    ["Data movement for ELT pipelines from databases to warehouses.", "data-movement"],
  ]) {
    const item = project({ description: description! });
    const result = discoveryProfile(item);
    expect(result.kind).toBe("capability_hint");
    expect(result.clues.map((clue) => clue.id)).toContain(id);
    for (const clue of result.clues) {
      expect(description).toContain(clue.quote);
      expect(clue.source).toBe("description");
      expect(clue.url).toBe(item.url);
    }
  }
  expect(discoveryProfile(project({ description: "A fast platform for everything" })).kind).toBe("unclassified");
});

it("prefers the project description over dependency mentions and marks README fallbacks explicitly", () => {
  const item = project({ description: "A framework for web testing and automation", readmeExcerpt: "Use AI agents with this optional example" });
  expect(discoveryProfile(item).clues.map((clue) => clue.id)).toEqual(["browser"]);
  const fallback = discoveryProfile(project({ readmeExcerpt: "This project provides a vector database for retrieval." }));
  expect(fallback.kind).toBe("unclassified");
  expect(fallback.clues[0]).toMatchObject({ id: "retrieval", source: "readme", url: "https://github.com/sample/project#readme" });
  const sponsored = discoveryProfile(project({ description: "A modern desktop shell", readmeExcerpt: "Sponsor offer: image generation, video generation and a coding agent." }));
  expect(buildDiscoveryBrief([project({ description: "A modern desktop shell", readmeExcerpt: "Sponsor offer: image generation, video generation and a coding agent." })], [], null).summary.withClues).toBe(0);
  expect(sponsored.clues.length).toBeGreaterThan(0);
});

it("retains tutorial evidence without counting a course as an independent software capability", () => {
  const course = project({ description: "A free course on data visualization and data movement." });
  const profile = discoveryProfile(course);
  expect(profile.kind).toBe("resource_hint");
  expect(course.description).toContain(profile.resourceQuote);
  expect(profile.clues.length).toBeGreaterThan(0);
  const brief = buildDiscoveryBrief([course], [], null);
  expect(brief.summary).toMatchObject({ withClues: 0, resources: 1 });
  expect(brief.categories).toEqual([]);
});

it("does not turn a first observation, unknown tag recovery, lost tag or popularity change into a release", () => {
  const older = "2026-10-20T08:00:00.000Z", newer = "2026-10-20T09:00:00.000Z";
  expect(observationSummary([observation(newer, "v1")])).toMatchObject({ comparison: null, releaseChange: null });
  for (const [from, to] of [[null, "v1"], ["v1", null], ["v1", "v1"]]) {
    expect(observationSummary([observation(older, from!), observation(newer, to!, 100)]).releaseChange).toBeNull();
  }
  const changed = observationSummary([observation(older, "v1"), observation(newer, "v2", 15)]);
  expect(changed).toMatchObject({ comparison: { stars: 5, from: older, to: newer }, releaseChange: { from: "v1", to: "v2", fromObservedAt: older, toObservedAt: newer } });
});

it("distinguishes first collection from project creation and uses dates instead of stored scores", () => {
  const scan = { id: "scan", startedAt: "2026-10-20T09:00:00.000Z", finishedAt: "2026-10-20T09:02:00.000Z" };
  const old = project({ id: "older", firstSeenAt: "2026-10-19T00:00:00.000Z", score: 100 });
  const recent = project({ id: "recent", score: 0 });
  const future = project({ id: "future", firstSeenAt: "2026-10-20T09:03:00.000Z" });
  const result = buildDiscoveryBrief([old, recent, future], [], scan);
  expect(result.items.map((item) => item.id)).toEqual(["future", "recent", "older"]);
  expect(result.items.find((item) => item.id === "recent")).toMatchObject({ firstSeenInScan: true, createdAt: "2020-01-01T00:00:00.000Z" });
  expect(result.summary.firstSeenInScan).toBe(1);
  expect(buildDiscoveryBrief([recent], [], null).summary.firstSeenInScan).toBe(0);
});
