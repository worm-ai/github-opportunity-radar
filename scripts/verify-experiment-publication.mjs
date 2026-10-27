import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 4350;
const experimentId = "agent-world-adaptation-2026-10-23";
const expected = JSON.parse(readFileSync(resolve(root, ".data/experiments/agent-world-adaptation/latest.json"), "utf8"));
const expectedResult = JSON.parse(readFileSync(resolve(expected.directory, "result.json"), "utf8"));
const child = spawn(process.execPath, ["apps/server/dist/index.js"], {
  cwd: root,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, APP_HOST: "127.0.0.1", APP_PORT: String(port), DATA_DIR: ".data", III_URL: "", ANALYSIS_PROVIDER: "rules", NODE_ENV: "production" },
});
let stderr = "";
child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
const stop = () => { if (!child.killed) child.kill(); };
async function request(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try { return await fetch(`http://127.0.0.1:${port}/api/v1/${path}`, { signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
try {
  let response;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { response = await request("experiments"); if (response.status === 200) break; } catch { /* server is still starting */ }
    await delay(100);
  }
  assert.equal(response?.status, 200, `server did not become ready: ${stderr}`);
  const archive = await response.json();
  assert.deepEqual(archive.warnings, []);
  const record = archive.records.find(item => item.id === experimentId);
  assert.ok(record, "published experiment is missing from the default server archive");
  assert.equal(record.executedAt, new Date(expectedResult.executedAt).toISOString());
  assert.equal(record.artifacts.length, 16);
  const artifact = await request(`experiments/${experimentId}/artifacts/result.json`);
  assert.equal(artifact.status, 200);
  const result = await artifact.json();
  assert.equal(result.executedAt, expectedResult.executedAt);
  console.log(JSON.stringify({ port, experimentId, executedAt: record.executedAt, artifacts: record.artifacts.length, artifactStatus: artifact.status }));
} finally {
  stop();
  await delay(100);
}
