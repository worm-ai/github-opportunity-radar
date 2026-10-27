// Explicit live acquisition probe. Uses real GitHub HTTPS and no model calls.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GitHubClient } from "../packages/sensor-github/dist/index.js";
import { EvidenceOnlyTransport, researchDemand } from "../packages/analysis/dist/index.js";

process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
const folder = fileURLToPath(new URL("../.data/verification/requirement-fallback/", import.meta.url));
mkdirSync(folder, { recursive: true });
const client = new GitHubClient(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {});
const started = Date.now();
const question = "我想找一个本地离线的 Markdown 笔记应用，支持全文搜索和导出。检索线索为“markdown notes”。希望先找到可直接运行的完整实现，再比较改造或组合。";
await client.checkSearchAccess();
const result = await researchDemand(question, {
  transport: new EvidenceOnlyTransport(),
  search: query => client.findRepositories(query),
  collect: async fullName => {
    const repository = await client.collectRepository(fullName);
    return { ...repository, id: String(repository.id), observedAt: new Date().toISOString() };
  },
  checkpoint: snapshot => writeFileSync(folder + "snapshot.json", JSON.stringify(snapshot, null, 2)),
});
assert.equal(result.plan.capabilities[0].description, `用户原文（未语义拆解）：${question}`);
assert.deepEqual(result.searches.map(item => item.query), ["markdown notes"]);
assert.equal(result.searches[0].status, "succeeded");
assert.ok(result.projects.length > 0);
assert.ok(result.sources.length > 0);
assert.equal(result.status, "partial");
assert.equal(result.outcome, "insufficient_evidence");
assert.equal(result.recommendedPathId, null);
const summary = {
  verifiedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
  scope: "Real GitHub acquisition through the new analysis code; no HTTP server deployment or model reasoning validation",
  status: result.status, outcome: result.outcome, queries: result.searches.map(item => item.query),
  candidates: result.searches.flatMap(item => item.items.map(repo => repo.fullName)),
  collected: result.projects.map(item => item.fullName), sources: result.sources.length,
  calls: result.calls.map(({ stage, model, status }) => ({ stage, model, status })),
  warnings: result.warnings,
};
writeFileSync(folder + "summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
