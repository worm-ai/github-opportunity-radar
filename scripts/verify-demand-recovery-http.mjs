import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RadarStore } from "../packages/storage/dist/index.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDirectory = mkdtempSync(join(tmpdir(), "radar-demand-recovery-"));
mkdirSync(dataDirectory, { recursive: true });
const model = createServer(async (request, response) => {
  let body = ""; for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body), schema = JSON.parse(payload.messages[1].content).outputSchema;
  const value = schema.properties?.capabilities ? {
    summary: "Replanned from the original question", capabilities: [{ id: "notes", description: "Local notes with search and export", required: true, origin: "user" }],
    constraints: [], assumptions: [], questions: [], queries: [{ query: "markdown notes", reason: "Explicit phrase from the original question" }],
  } : { paths: [], gapQueries: [], conclusion: "Saved sources do not establish a suitable implementation" };
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
});
await new Promise(done => model.listen(0, "127.0.0.1", done));
const modelPort = model.address().port;
const reservation = createServer(); await new Promise(done => reservation.listen(0, "127.0.0.1", done));
const port = reservation.address().port; await new Promise(done => reservation.close(done));
const database = join(dataDirectory, "opportunity-radar.sqlite");
const store = new RadarStore(database);
const question = 'Find a local Markdown notes application with full text search and export. Search phrase "markdown notes".';
const parent = store.createDemandRun(crypto.randomUUID(), question, null);
const project = { id: "77", fullName: "sample/notes", url: "https://github.com/sample/notes", license: "MIT", language: "TypeScript", observedAt: "2026-10-26T00:00:00.000Z" };
const preview = { id: 77, fullName: project.fullName, description: "A local Markdown notes application with search and export.", url: project.url, license: "MIT", stars: 10, language: project.language, archived: false, fork: false };
const source = { id: "77:description:0", projectId: project.id, field: "description", content: preview.description, url: project.url, observedAt: project.observedAt, path: null, sha: null, commitSha: null, notice: "Bounded source" };
const snapshot = { version: "demand-research-v5", question, provider: "local-cli", model: "rules/evidence-only", stage: "finished", status: "partial", plan: { summary: "Fallback plan", capabilities: [{ id: "user-requirement-1", description: "User original requirement: " + question, required: true, origin: "user" }], constraints: [], assumptions: [], questions: [], queries: [{ query: "markdown notes", reason: "Explicit phrase" }] }, searches: [{ query: "markdown notes", reason: "Explicit phrase", phase: "initial", status: "succeeded", observedAt: project.observedAt, total: 1, incomplete: false, items: [preview], error: null }], selections: [{ round: 1, selection: { selected: [{ fullName: project.fullName, reason: "Collected from GitHub" }], skipped: [] } }], collections: [{ fullName: project.fullName, status: "succeeded", error: null }], projects: [project], sources: [source], evaluations: [{ paths: [], gapQueries: [], conclusion: "Fallback did not evaluate sources" }], reviews: null, recommendedPathId: null, outcome: "insufficient_evidence", warnings: ["Model unavailable; evidence-only acquisition"], error: null, calls: [{ stage: "evaluation", model: "rules/evidence-only", promptTokens: null, completionTokens: null, status: "succeeded" }] };
store.checkpointDemandRun(parent.id, snapshot); store.close();
const child = spawn(process.execPath, [resolve(root, "apps/server/dist/index.js")], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, APP_HOST: "127.0.0.1", APP_PORT: String(port), DATA_DIR: dataDirectory, III_URL: "", ANALYSIS_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "fixture", DEEPSEEK_MODEL: "fixture-model", DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}`, GITHUB_TOKEN: "", NODE_ENV: "production" } });
let logs = ""; for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { logs = `${logs}${chunk}`.slice(-5000); });
async function until(check, timeout = 30000) { const started = Date.now(); while (Date.now() - started < timeout) { if (child.exitCode !== null) throw new Error(`server exited: ${logs}`); const result = await check().catch(() => null); if (result) return result; await new Promise(done => setTimeout(done, 150)); } throw new Error(`timed out: ${logs}`); }
const base = `http://127.0.0.1:${port}/api/v1`;
try {
  await until(async () => (await fetch(`${base}/health/ready`)).ok);
  const features = await (await fetch(`${base}/demands/features`)).json(); assert.equal(features.fallbackEvaluationResume, true);
  const requestId = crypto.randomUUID();
  const resume = await fetch(`${base}/demands/${parent.id}/resume-evaluation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId }) });
  assert.equal(resume.status, 202); const childRun = await resume.json();
  const recovered = await until(async () => { const run = await (await fetch(`${base}/demands/${childRun.id}`)).json(); return run.status !== "running" ? run : null; });
  assert.equal(recovered.status, "partial"); assert.equal(recovered.snapshot.evaluationResume.replanned, true); assert.equal(recovered.snapshot.sources.length, 1); assert.equal(recovered.snapshot.recommendedPathId, null);
  const idempotent = await fetch(`${base}/demands/${parent.id}/resume-evaluation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId }) }); assert.equal(idempotent.status, 200); assert.equal((await idempotent.json()).id, childRun.id);
  const summary = { parentId: parent.id, childId: childRun.id, parentStatus: "partial", childStatus: recovered.status, sourceCount: recovered.snapshot.sources.length, replanned: recovered.snapshot.evaluationResume.replanned, featureEnabled: features.fallbackEvaluationResume, idempotencyStatus: idempotent.status };
  writeFileSync(join(dataDirectory, "verification.json"), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
} finally { child.kill(); model.close(); }
