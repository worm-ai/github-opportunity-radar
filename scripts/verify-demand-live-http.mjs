import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDirectory = mkdtempSync(join(tmpdir(), "radar-demand-live-"));
const hook = join(dataDirectory, "opencode-hook.cjs");
writeFileSync(hook, `
const args = process.argv.slice(1), commandIndex = name => args.findIndex(item => item === name || item.endsWith("\\\\" + name) || item.endsWith("/" + name)), api = commandIndex("api"), run = commandIndex("run");
if (api < 0 && run < 0) return;
const emit = value => { process.stdout.write(JSON.stringify(value) + "\\n"); process.exit(0); };
if (api >= 0 && args[api + 1] === "GET" && args[api + 2] === "/api/model") emit({ data: [{ providerID: "opencode", id: "fake-free", enabled: true, status: "active", cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] }] });
else if (api >= 0 && args[api + 1] === "POST" && args[api + 2] === "/api/session") { const data = JSON.parse(args[api + 4]); emit({ data: { id: "ses_fake123", permissions: data.permissions } }); }
else if (run >= 0) emit({ type: "error", error: { status: 429, type: "provider.quota" } });
else emit({ data: {} });
`, "utf8");
const reservation = createServer(); await new Promise(done => reservation.listen(0, "127.0.0.1", done));
const port = reservation.address().port; await new Promise(done => reservation.close(done));
const child = spawn(process.execPath, [resolve(root, "apps/server/dist/index.js")], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, APP_HOST: "127.0.0.1", APP_PORT: String(port), DATA_DIR: dataDirectory, III_URL: "", ANALYSIS_PROVIDER: "opencode", OPENCODE_BIN: process.execPath, OPENCODE_MODEL: "opencode/fake-free", NODE_OPTIONS: `--require ${hook}`, GITHUB_TOKEN: "", NODE_ENV: "production" } });
let logs = ""; for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { logs = `${logs}${chunk}`.slice(-6000); });
async function until(check, timeout = 180000) { const started = Date.now(); while (Date.now() - started < timeout) { if (child.exitCode !== null) throw new Error(`server exited: ${logs}`); const result = await check().catch(() => null); if (result) return result; await new Promise(done => setTimeout(done, 500)); } throw new Error(`timed out: ${logs}`); }
const base = `http://127.0.0.1:${port}/api/v1`;
const question = '找一个本地离线 Markdown 笔记应用，支持全文搜索和导出。检索线索为“markdown notes”。';
try {
  await until(async () => (await fetch(`${base}/health/ready`)).ok, 30000);
  const integration = await (await fetch(`${base}/integrations`)).json(); assert.equal(integration.analysis.state, "configured"); assert.equal(integration.analysis.freeModelsOnly, true); assert.equal(integration.analysis.codexFallback, false); assert.equal(integration.analysis.automaticPaidFallback, false);
  const started = await fetch(`${base}/demands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, requestId: crypto.randomUUID() }) });
  assert.equal(started.status, 202); const parent = await started.json();
  const finished = await until(async () => { const run = await (await fetch(`${base}/demands/${parent.id}`)).json(); return run.status !== "running" ? run : null; });
  if (finished.status !== "partial") throw new Error(JSON.stringify({ finished, logs })); assert.ok(finished.snapshot.searches.length > 0); assert.ok(finished.snapshot.projects.length > 0); assert.ok(finished.snapshot.sources.length > 0); assert.equal(finished.snapshot.recommendedPathId, null);
  const summary = { port, dataDirectory, runId: parent.id, status: finished.status, searchCount: finished.snapshot.searches.length, projectCount: finished.snapshot.projects.length, sourceCount: finished.snapshot.sources.length, outcome: finished.snapshot.outcome, model: integration.analysis.model, codexFallback: integration.analysis.codexFallback, automaticPaidFallback: integration.analysis.automaticPaidFallback };
  writeFileSync(join(dataDirectory, "verification.json"), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
} finally { child.kill(); }
