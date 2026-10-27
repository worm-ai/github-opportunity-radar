import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDirectory = resolve(process.env.PUBLISH_DATA_DIR ?? ".data");
const stamp = new Date().toISOString().replaceAll(/[-:.]/g, "").replaceAll("Z", "Z").toLowerCase();
const experimentId = `agent-world-continuous-rerun-${stamp}`;

function run(command, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, command, {
      cwd: root,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk.toString(); process.stdout.write(chunk); });
    child.stderr.on("data", chunk => { output += chunk.toString(); process.stderr.write(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise({ code, signal, output }));
  });
}

const rerun = await run(["experiments/agent-world-service/run-continuous-crash.mjs"]);
if (rerun.code !== 0) throw new Error(`持续恢复实测失败：退出码 ${rerun.code ?? "null"}${rerun.signal ? ` (${rerun.signal})` : ""}`);

const pointerPath = resolve(root, ".data/experiments/agent-world-service/continuous-crash-latest.json");
if (!existsSync(pointerPath)) throw new Error("持续恢复实测未生成执行目录指针");
const execution = JSON.parse(readFileSync(pointerPath, "utf8")).directory;
const published = await run(["scripts/publish-agent-world-continuous-rerun.mjs"], {
  ...process.env,
  PUBLISH_DATA_DIR: dataDirectory,
  RADAR_EXPERIMENT_ID: experimentId,
  RADAR_CONTINUOUS_EXECUTION: execution,
});
if (published.code !== 0) throw new Error(`持续恢复实测发布失败：退出码 ${published.code ?? "null"}`);
console.log(JSON.stringify({ experimentId, execution, archive: resolve(dataDirectory, "technical-experiments", experimentId) }));
