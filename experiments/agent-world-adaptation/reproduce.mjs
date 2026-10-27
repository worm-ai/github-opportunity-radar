import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const experiment = "agent-world-adaptation-2026-10-23";
const python = process.env.RADAR_PYTHON ?? resolve(root, ".data/experiments/actual-ecommerce-noter/python/python.exe");
const timeoutMs = Number(process.env.RADAR_EXPERIMENT_TIMEOUT_MS ?? 15 * 60 * 1000);
const publishDataDir = process.env.PUBLISH_DATA_DIR ?? process.env.DATA_DIR ?? ".data";
const args = new Set(process.argv.slice(2));
if (args.has("--help")) {
  console.log("Usage: node experiments/agent-world-adaptation/reproduce.mjs [--dry-run]");
  console.log("Runs only the registered local prepare/run scripts, publishes to PUBLISH_DATA_DIR or DATA_DIR, and never executes a command from an archive record.");
  process.exit(0);
}
assert(args.size === 0 || (args.size === 1 && args.has("--dry-run")), "Only --dry-run is supported");
const scripts = [
  [python, ["-I", "-B", "-X", "utf8", "experiments/agent-world-adaptation/prepare.py"], "prepare"],
  [python, ["-I", "-B", "-X", "utf8", "-X", "faulthandler", "experiments/agent-world-adaptation/run.py"], "run"],
  [process.execPath, ["experiments/agent-world-adaptation/publish.mjs"], "publish"],
];
const invocation = ([executable, command]) => [executable, ...command];
assert(existsSync(python), `Python runtime not found: ${python}`);
for (const [, command, name] of scripts) for (const part of command) assert(!part.includes("..\\") && !part.includes("../"), `${name} command escapes the workspace`);
const plan = { experiment, python, publishDataDir, timeoutMs, steps: scripts.map(([, command, name]) => ({ name, command })) };
if (args.has("--dry-run")) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

function run(command, name, env = {}) {
  return new Promise((resolveStep, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk.toString(); process.stdout.write(chunk); });
    child.stderr.on("data", chunk => { output += chunk.toString(); process.stderr.write(chunk); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${name} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolveStep({ name, code, signal, output });
      else reject(new Error(`${name} exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}`));
    });
  });
}

try {
  const startedAt = Date.now();
  const results = [];
  results.push(await run(invocation(scripts[0]), "prepare"));
  results.push(await run(invocation(scripts[1]), "run"));
  results.push(await run(invocation(scripts[2]), "publish", { PUBLISH_DATA_DIR: publishDataDir }));
  const latest = JSON.parse(readFileSync(resolve(root, ".data/experiments/agent-world-adaptation/latest.json"), "utf8"));
  const result = JSON.parse(readFileSync(resolve(latest.directory, "result.json"), "utf8"));
  assert.ok(Date.parse(result.executedAt) >= startedAt, "latest.json does not point to a result produced by this run");
  assert.equal(result.resumedTrajectoryEqual, true);
  assert.equal(result.singleActionSavesBothRelationshipSides, true);
  assert.equal(result.decisions, 90);
  console.log(JSON.stringify({ experiment, publishedDataDir: publishDataDir, execution: latest.directory, executedAt: result.executedAt, steps: results.map(step => step.name) }));
} catch (error) {
  console.error(JSON.stringify({ experiment, publishedDataDir: publishDataDir, status: "failed", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
