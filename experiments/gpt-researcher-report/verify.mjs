// Read-only local application audit of the published experiment and report boundaries.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4317";
const id = "gpt-researcher-report-failure-20261022";
async function read(path, json = true) {
  const response = await fetch(base + "/api/v1" + path, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, path);
  return json ? response.json() : response;
}
const [health, opportunities, experiments, note] = await Promise.all([
  read("/health/ready"), read("/opportunities"), read("/experiments"),
  read("/research-notes/1f2b798b-b213-4611-9e9d-fc540681bb69"),
]);
assert.equal(health.ready, true);
const record = experiments.records.find((item) => item.id === id);
assert.ok(record, "The actual application must expose the archived experiment");
assert.equal(record.checks.length, 6);
assert.equal(record.projectIds.length, 1);
for (const artifact of record.artifacts) {
  const response = await read("/experiments/" + id + "/artifacts/" + artifact.name, false);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256, artifact.name);
  if (artifact.name === "result.json") {
    const result = JSON.parse(bytes.toString("utf8"));
    assert.equal(result.mode, "unchanged_upstream_functions_with_dependency_stubs");
    assert.equal(result.cases.length, 6);
    assert.equal(result.liveModelRequests, 0);
    assert.equal(result.productionWrites, 0);
  }
}
const matching = opportunities.filter((item) => item.projectIds.includes("639835356"));
assert.ok(matching.length, "Verify the current related opportunity output as well as the archive");
for (const opportunity of matching) {
  const report = await (await read("/opportunities/" + opportunity.id + "/report.md", false)).text();
  assert.ok(report.includes(id), "The opportunity report must include its related function-level experiment");
}
const report = await (await read("/research-notes/" + note.id + "/report.md", false)).text();
assert.ok(note.evidence.length > 0);
assert.ok(note.evidence.every((evidence) => report.includes("- 边界：" + evidence.notice)), "Check the actual saved notices, rather than expecting a truncated-body label on a complete source");
const after = await read("/opportunities");
const marketState = (items) => items.map((item) => [item.id, item.marketStatus, item.validationRecords.length]).sort((a, b) => a[0].localeCompare(b[0]));
assert.deepEqual(marketState(after), marketState(opportunities));
const audit = { checkedAt: new Date().toISOString(), archive: id, artifactsVerified: record.artifacts.length,
  relatedReportsVerified: matching.length, savedNoticeBoundariesVerified: note.evidence.length,
  researchEvidenceStates: note.evidenceStates, marketState: marketState(after), productionRequests: "GET only",
  providerRequests: 0, evidenceScope: "Function-level technical evidence; no real user value validation" };
mkdirSync(".data/browser", { recursive: true });
writeFileSync(".data/browser/gpt-report-evidence-verification.json", JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit));
