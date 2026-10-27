import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const work = resolve(root, ".data/experiments/agent-world-service");
const python = resolve(root, ".data/experiments/actual-ecommerce-noter/python/python.exe");
const database = resolve(work, "vendor/environment/frontend_server/db.sqlite3");
const execution = resolve(work, `daphne-execution-${new Date().toISOString().replaceAll(/[-:.]/g, "").replaceAll("Z", "Z")}`);
mkdirSync(execution, { recursive: true });
rmSync(database, { force: true });

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["SYSTEMROOT", "WINDIR", "TEMP", "TMP"].includes(key.toUpperCase())));
env.PYTHONUNBUFFERED = "1";
env.DJANGO_SETTINGS_MODULE = "frontend_server.settings";

function run(command, args, label, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise({ child, code, signal, stdout, stderr, label }));
  });
}

async function waitForWeb(child, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch("http://127.0.0.1:4327/");
      if (response.status === 200) return true;
    } catch { /* keep polling the same process */ }
    await new Promise(done => setTimeout(done, 250));
  }
  return false;
}

async function startServer(label) {
  const child = spawn(python, ["-B", "-X", "utf8", "experiments/agent-world-service/daphne_manage.py", "runworld", "--port", "4327", "--mcp-port", "4328", "--npc-count", "0"], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { logs += chunk.toString(); if (logs.length > 20000) logs = logs.slice(-20000); });
  const webReady = await waitForWeb(child);
  if (!webReady) {
    child.kill();
    await new Promise(done => child.once("exit", done));
    throw new Error(`${label} Daphne web startup failed: ${logs.slice(-6000)}`);
  }
  return { child, label, getLogs: () => logs };
}

async function stopServer(server) {
  server.child.kill();
  await new Promise(done => server.child.once("exit", done));
  writeFileSync(resolve(execution, `${server.label}.log`), server.getLogs(), "utf8");
}

async function dbRows(label) {
  const result = await run(python, ["-B", "-X", "utf8", "experiments/agent-world-service/daphne_db_probe.py", database], `${label}-db`);
  assert.equal(result.code, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  writeFileSync(resolve(execution, `${label}-db.json`), JSON.stringify(rows, null, 2), "utf8");
  return rows;
}

const migrate = await run(python, ["-B", "-X", "utf8", "experiments/agent-world-service/daphne_manage.py", "migrate", "--noinput"], "migrate");
writeFileSync(resolve(execution, "migrate.log"), `${migrate.stdout}${migrate.stderr}`, "utf8");
assert.equal(migrate.code, 0, migrate.stderr);

const first = await startServer("phase1");
const phase1 = await run(python, ["-B", "-X", "utf8", "experiments/agent-world-service/daphne_client_probe.py", "http://127.0.0.1:4328/mcp", resolve(execution, "phase1-client.json")], "phase1-client");
writeFileSync(resolve(execution, "phase1-client.stdout.txt"), phase1.stdout, "utf8");
writeFileSync(resolve(execution, "phase1-client.stderr.txt"), phase1.stderr, "utf8");
const phase1Rows = await dbRows("phase1");
await stopServer(first);

const second = await startServer("phase2");
const phase2 = await run(python, ["-B", "-X", "utf8", "experiments/agent-world-service/daphne_client_probe.py", "http://127.0.0.1:4328/mcp", resolve(execution, "phase2-client.json"), "resume"], "phase2-client");
writeFileSync(resolve(execution, "phase2-client.stdout.txt"), phase2.stdout, "utf8");
writeFileSync(resolve(execution, "phase2-client.stderr.txt"), phase2.stderr, "utf8");
const phase2Rows = await dbRows("phase2");
await stopServer(second);

const phase1Client = JSON.parse(readFileSync(resolve(execution, "phase1-client.json"), "utf8"));
const phase2Client = JSON.parse(readFileSync(resolve(execution, "phase2-client.json"), "utf8"));
const logs = `${readFileSync(resolve(execution, "phase1.log"), "utf8")}\n${readFileSync(resolve(execution, "phase2.log"), "utf8")}`;
const result = {
  executedAt: new Date().toISOString(),
  repository: "sbenodiz/agent-world",
  commit: "13d62dbdeeca07c7b5bb3b8aa264ca9834b01882",
  topology: "上游 manage.py runworld；Daphne 主线程 + 后台线程 FastMCP/tick loop",
  ports: { web: 4327, mcp: 4328 },
  phase1: { exitCode: phase1.code, protocolVersion: phase1Client.protocolVersion, tools: phase1Client.tools, rowsAfterActions: phase1Rows.length, rows: phase1Rows, memoryResponseVisible: JSON.stringify(phase1Client).includes("daphne persistence probe") },
  phase2: { exitCode: phase2.code, rowsAfterRestart: phase2Rows.length, rows: phase2Rows, unknownApiKeyAfterRestart: JSON.stringify(phase2Client).includes("Unknown API key") },
  evidence: {
    daphneWebStarted: true,
    mcpStarted: logs.includes("MCP server running on port 4328"),
    tickLoopStarted: logs.includes("World tick loop started"),
    syncOrmErrorObserved: logs.includes("You cannot call this from an async context"),
    interfaceReportedSuccess: JSON.stringify(phase1Client).includes('"ok": true'),
    databasePersisted: phase1Rows.length > 0,
    stateRecovered: phase2Rows.length > 0 && !JSON.stringify(phase2Client).includes("Unknown API key"),
  },
  limitations: ["一次本地固定运行；未测长期负载、掉电、中途 kill 和完整玩家流程。", "MCP 注册/动作接口返回成功不能抵消 SQLite 为空与重启未知的反证。", "无外部 LLM、无 Godot 图形、无独立用户收益测量。"],
};
writeFileSync(resolve(execution, "result.json"), JSON.stringify(result, null, 2), "utf8");
writeFileSync(resolve(work, "daphne-latest.json"), JSON.stringify({ directory: execution }, null, 2), "utf8");
console.log(JSON.stringify({ execution, result }, null, 2));
