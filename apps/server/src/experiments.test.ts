import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { experimentArtifact, listExperiments } from "./experiments.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function archive() {
  const root = mkdtempSync(resolve(tmpdir(), "radar-experiment-")); roots.push(root);
  mkdirSync(resolve(root, "measured-case"));
  const bytes = Buffer.from("measured input");
  const record = { id: "measured-case", title: "Measured technical case", question: "Does the interface work?", conclusion: "Works for this input; demand unknown", executedAt: "2026-10-20T00:00:00.000Z", environment: "Temporary test archive", inputOrigin: "Explicit test fixture", projectIds: ["1", "2"], sources: [{ repository: "owner/a", commit: "a".repeat(40) }, { repository: "owner/b", commit: "b".repeat(40) }], checks: [{ label: "Byte comparison", observation: "Measured", outcome: "supported" }], limitations: ["No market validation"], nextAction: "Observe real work", artifacts: [{ name: "input.csv", label: "Input", sha256: createHash("sha256").update(bytes).digest("hex") }] };
  writeFileSync(resolve(root, "measured-case/record.json"), JSON.stringify(record));
  writeFileSync(resolve(root, "measured-case/input.csv"), bytes);
  return root;
}
it("lists measured records and serves only a declared artifact with matching bytes", () => {
  const root = archive();
  expect(listExperiments(root)).toMatchObject({ records: [{ id: "measured-case", limitations: ["No market validation"] }], warnings: [] });
  expect(experimentArtifact(root, "measured-case", "input.csv")?.bytes.toString()).toBe("measured input");
  writeFileSync(resolve(root, "measured-case/unlisted.csv"), "private");
  expect(experimentArtifact(root, "measured-case", "unlisted.csv")).toBeNull();
  expect(() => experimentArtifact(root, "measured-case", "../input.csv")).toThrow();
  expect(() => experimentArtifact(root, "../measured-case", "input.csv")).toThrow();
});
it("rejects changed evidence and exposes an archive warning instead of presenting it as verified", () => {
  const root = archive();
  writeFileSync(resolve(root, "measured-case/input.csv"), "changed after verification");
  expect(() => experimentArtifact(root, "measured-case", "input.csv")).toThrow("integrity mismatch");
  expect(listExperiments(root).records).toEqual([]);
  expect(listExperiments(root).warnings).toHaveLength(1);
});
it("treats an absent archive as empty and a malformed record as a visible warning", () => {
  const root = archive();
  expect(listExperiments(resolve(root, "absent"))).toEqual({ records: [], warnings: [] });
  writeFileSync(resolve(root, "measured-case/record.json"), "{}");
  expect(listExperiments(root)).toMatchObject({ records: [], warnings: [expect.any(String)] });
});
it("allows related projects and independently traceable external sources", () => {
  const root = archive(), path = resolve(root, "measured-case/record.json");
  const record = JSON.parse(readFileSync(path, "utf8"));
  record.projectIds = ["1"];
  record.sources.push({ repository: "external/comparator", commit: "c".repeat(40) });
  writeFileSync(path, JSON.stringify(record));
  expect(listExperiments(root)).toMatchObject({ records: [{ projectIds: ["1"], sources: [{ repository: "owner/a" }, { repository: "owner/b" }, { repository: "external/comparator" }] }], warnings: [] });
  expect(experimentArtifact(root, "measured-case", "input.csv")?.bytes.toString()).toBe("measured input");
  record.sources = [];
  writeFileSync(path, JSON.stringify(record));
  expect(listExperiments(root)).toMatchObject({ records: [], warnings: [expect.any(String)] });
});

it("requires a local modification to identify a declared, hash-verified artifact", () => {
  const root = archive(), path = resolve(root, "measured-case/record.json");
  const record = JSON.parse(readFileSync(path, "utf8"));
  const valid = { artifact: "input.csv", sha256: record.artifacts[0].sha256, description: "Local adapter, not unmodified upstream" };
  record.sources[0].modification = valid;
  writeFileSync(path, JSON.stringify(record));
  expect(listExperiments(root).warnings).toEqual([]);
  expect(listExperiments(root).records[0]!.sources[0]!.modification).toEqual(valid);
  for (const modification of [
    { ...valid, artifact: "unlisted.json" },
    { ...valid, sha256: "f".repeat(64) },
    { ...valid, artifact: "../input.csv" },
  ]) {
    record.sources[0].modification = modification;
    writeFileSync(path, JSON.stringify(record));
    expect(listExperiments(root)).toMatchObject({ records: [], warnings: [expect.any(String)] });
  }
});
