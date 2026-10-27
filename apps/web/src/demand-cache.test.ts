import { describe, expect, it } from "vitest";
import type { ProjectSearchResponse } from "./api";
import { triageCachedCandidates } from "./demand-cache";

const item = (fullName: string, matchedFields: ProjectSearchResponse["items"][number]["matchedFields"], observedAt = "2026-10-26T00:00:00Z") => ({
  id: fullName, fullName, url: `https://github.com/${fullName}`, firstSeenAt: observedAt, description: "description", language: "TypeScript", license: "MIT", stars: 1, forks: 0, openIssues: 0, createdAt: observedAt, pushedAt: observedAt, readmeExcerpt: "README", score: 0, scoreReasons: [], capabilities: [], observedAt, discoveryChannels: [], issuesFetchedAt: null, issues: [], discovery: { kind: "capability_hint" as const, resourceQuote: null, clues: [] }, matchedFields, matchedEvidence: matchedFields.map(field => ({ field, excerpt: `${field} evidence` })),
});

describe("triageCachedCandidates", () => {
  it("puts README-backed evidence first without calling it a recommendation", () => {
    const result = triageCachedCandidates([item("owner/description", ["description"]), item("owner/readme", ["readmeExcerpt", "description"])], []);
    expect(result.map(value => value.item.fullName)).toEqual(["owner/readme", "owner/description"]);
    expect(result[0]).toMatchObject({ evidenceLabel: "证据较多", matchLabel: "精确命中" });
    expect(result[1]?.nextAction).toContain("README");
  });

  it("labels expanded cache results and preserves deterministic ordering", () => {
    const result = triageCachedCandidates([item("owner/a", ["fullName"]), item("owner/b", ["fullName"])], ["agent", "memory"]);
    expect(result.every(value => value.matchLabel === "扩展线索")).toBe(true);
    expect(result.every(value => value.evidenceLabel === "线索有限")).toBe(true);
    expect(result.map(value => value.item.fullName)).toEqual(["owner/a", "owner/b"]);
  });
});
