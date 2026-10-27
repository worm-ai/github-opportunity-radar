import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const work = resolve(root, ".data/experiments/agent-world-service");
const python = resolve(root, ".data/experiments/actual-ecommerce-noter/python/python.exe");
const endTick = Number(process.env.RADAR_CONTINUOUS_END_TICK ?? "16");
const killTick = Number(process.env.RADAR_CONTINUOUS_KILL_TICK ?? "12");
if (!Number.isInteger(endTick) || !Number.isInteger(killTick) || endTick <= killTick || killTick < 1) throw new Error("Invalid continuous tick configuration");
const execution = resolve(work, `continuous-crash-${new Date().toISOString().replaceAll(/[-:.]/g, "").replaceAll("Z", "Z")}`);
mkdirSync(execution, { recursive: true });

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["SYSTEMROOT", "WINDIR", "TEMP", "TMP"].includes(key.toUpperCase())));

function childArgs(phase, database, output, extra = {}) {
  const args = ["-I", "-B", "-X", "utf8", "experiments/agent-world-service/continuous_runner.py",
    "--phase", phase, "--database", database, "--output", output,
    "--start-tick", String(extra.startTick ?? (phase === "seed" ? 1 : 5)),
    "--end-tick", String(extra.endTick ?? (phase === "seed" ? 8 : 8)),
    "--artifact-dir", String(extra.artifactDir ?? resolve(output, "..")),
    "--web-port", String(extra.webPort ?? 4335), "--mcp-port", String(extra.mcpPort ?? 4336)];
  if (extra.killAfter) args.push("--kill-after", String(extra.killAfter), "--kill-wait", "60");
  return args;
}

function spawnPhase(label, phase, database, output, extra = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(python, childArgs(phase, database, output, extra), {
      cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      writeFileSync(resolve(execution, `${label}.stdout.txt`), stdout, "utf8");
      writeFileSync(resolve(execution, `${label}.stderr.txt`), stderr, "utf8");
      resolvePromise({ child, code, signal, stdout, stderr });
    });
  });
}

const killReadyTimeoutMs = Number(process.env.RADAR_KILL_READY_TIMEOUT_MS ?? "120000");
if (!Number.isInteger(killReadyTimeoutMs) || killReadyTimeoutMs < 1000) throw new Error("Invalid kill-ready timeout configuration");

async function waitForFile(path, timeoutMs = killReadyTimeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(path)) return true;
    await new Promise(done => setTimeout(done, 100));
  }
  return false;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Seed once, then clone the exact checkpoint so the two trajectories differ
// only by the forced termination, never by UUID allocation or initial state.
const seedDb = resolve(execution, "seed.sqlite3");
const seedOutput = resolve(execution, "seed.json");
const seedDir = resolve(execution, "seed-artifacts");
mkdirSync(seedDir, { recursive: true });
const seed = await spawnPhase("seed", "seed", seedDb, seedOutput, { startTick: 1, endTick: 0, artifactDir: seedDir });
assert.equal(seed.code, 0, seed.stderr.slice(-5000));

const baselineDb = resolve(execution, "baseline.sqlite3");
const baselineOutput = resolve(execution, "baseline.json");
const baselineDir = resolve(execution, "baseline-artifacts");
mkdirSync(baselineDir, { recursive: true });
copyFileSync(seedDb, baselineDb);
const baseline = await spawnPhase("baseline", "resume", baselineDb, baselineOutput, { startTick: 1, endTick: endTick, artifactDir: baselineDir });
assert.equal(baseline.code, 0, baseline.stderr.slice(-5000));

const splitDb = resolve(execution, "split.sqlite3");
const splitOutput = resolve(execution, "split-phase1.json");
const splitDir = resolve(execution, "split-artifacts");
mkdirSync(splitDir, { recursive: true });
copyFileSync(seedDb, splitDb);
const splitChildPromise = spawnPhase("split-phase1", "resume", splitDb, splitOutput, { startTick: 1, endTick: killTick, killAfter: killTick, artifactDir: splitDir });
assert.equal(await waitForFile(resolve(splitDir, "kill-ready.json")), true, "phase 1 never reached the kill boundary");
const killReady = readJson(resolve(splitDir, "kill-ready.json"));
assert.equal(killReady.tick, killTick);
const splitChild = await Promise.race([
  splitChildPromise.then(value => ({ value, finished: true })),
  new Promise(resolvePromise => setTimeout(() => resolvePromise({ finished: false }), 1000)),
]);
if (!splitChild.finished) {
  // The child is intentionally in a wait window after a completed checkpoint.
  // SIGKILL maps to TerminateProcess on Windows and bypasses cleanup handlers.
  const processInfo = readJson(resolve(splitDir, "kill-ready.json"));
  spawn("taskkill", ["/PID", String(processInfo.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
}
const splitPhase1 = await splitChildPromise;
assert.notEqual(splitPhase1.code, 0, "forced termination unexpectedly followed graceful completion");

const resumeOutput = resolve(execution, "resume.json");
const resumeDir = resolve(execution, "resume-artifacts");
mkdirSync(resumeDir, { recursive: true });
const resumed = await spawnPhase("resume", "resume", splitDb, resumeOutput, { startTick: killTick + 1, endTick: endTick, artifactDir: resumeDir });
assert.equal(resumed.code, 0, resumed.stderr.slice(-5000));

const baselineResult = readJson(baselineOutput);
const resumedResult = readJson(resumeOutput);
const baselineTick4 = readJson(resolve(baselineDir, `after-tick-${killTick}.json`));

assert.equal(baselineResult.tickCount, endTick);
assert.equal(resumedResult.tickCount, endTick);
assert.equal(resumedResult.digest, baselineResult.digest, "restart changed durable trajectory");
assert.equal(baselineTick4.digest, killReady.digest, "state differed before forced termination");
assert.equal(resumedResult.websocketUpdates, endTick - killTick);
assert.equal(resumedResult.tools.includes("act"), true);
assert.equal(resumedResult.tools.includes("get_world_context"), true);
assert.equal(resumedResult.tools.includes("inject_world_event"), true);
assert.equal(baselineResult.playerEvents.length, 2);
assert.equal(JSON.stringify(baselineResult.playerEvents).includes('"ok":true'), true);
assert.deepEqual(baselineResult.playerEventVisibility, [
  { tick: 5, websocketVisible: true, httpVisible: true },
  { tick: 11, websocketVisible: true, httpVisible: true },
]);
assert.equal(JSON.stringify(resumedResult.state).includes("player_intervention"), true);
for (const name of ["Alice", "Bob", "Cara"]) {
  assert.equal(JSON.stringify(resumedResult.restored[name]).includes(name), true, `${name} identity not restored`);
}

const result = {
  executedAt: new Date().toISOString(),
  repository: "sbenodiz/agent-world",
  commit: "13d62dbdeeca07c7b5bb3b8aa264ca9834b01882",
  topology: "local adapted bridge + FastMCP streamable HTTP + ASGI/Channels viewer",
  execution,
  phases: {
    baseline: { ticks: endTick, exitCode: baseline.code, digest: baselineResult.digest, playerEvents: baselineResult.playerEvents.length },
    interrupted: { checkpointTick: killTick, exitCode: splitPhase1.code, signal: splitPhase1.signal, digest: killReady.digest },
    resumed: { ticks: endTick - killTick, exitCode: resumed.code, digest: resumedResult.digest },
  },
  playerEventVisibility: baselineResult.playerEventVisibility,
  checks: [
    { name: "mcpActionsAndObservation", outcome: baselineResult.calls.length >= 3 + endTick * 4 ? "supported" : "refuted" },
    { name: "websocketViewerUpdates", outcome: resumedResult.websocketUpdates === endTick - killTick ? "supported" : "refuted" },
    { name: "playerEventInjection", outcome: baselineResult.playerEvents.length === 2 && JSON.stringify(baselineResult.playerEvents).includes('"ok":true') ? "supported" : "refuted" },
    { name: "randomWorldEventSurvivesRestart", outcome: JSON.stringify(resumedResult.state).includes("world_event") ? "supported" : "refuted" },
    { name: "checkpointSurvivesForcedProcessTermination", outcome: baselineTick4.digest === killReady.digest ? "supported" : "refuted" },
    { name: "resumedDurableTrajectoryMatchesContinuousRun", outcome: resumedResult.digest === baselineResult.digest ? "supported" : "refuted" },
    { name: "externalAgentActionsPersist", outcome: ["Alice", "Bob", "Cara"].every(name => JSON.stringify(resumedResult.restored[name]).includes(name)) ? "supported" : "refuted" },
    { name: "playerEventsVisibleInWebSocketAndHttp", outcome: baselineResult.playerEventVisibility.every(item => item.websocketVisible && item.httpVisible) ? "supported" : "refuted" },
  ],
  stateCompared: ["tickCount", "clock", "agent identity/API keys", "memory", "relationships", "current actions", "pending events", "decisions"],
  excludedFromDigest: ["wall-clock timestamps", "agent last_seen", "rate-limit action timestamps"],
  limitations: [
    "The kill occurs after a completed checkpoint, so this proves recovery to the last committed boundary, not atomicity of a power loss during a database commit.",
    "The policy is deterministic MCP-driven actions, not an external LLM or emergent social intelligence.",
    "No Godot rendering or independent user time-saving study is included.",
  ],
};
writeFileSync(resolve(execution, "result.json"), JSON.stringify(result, null, 2), "utf8");
writeFileSync(resolve(work, "continuous-crash-latest.json"), JSON.stringify({ directory: execution }, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
