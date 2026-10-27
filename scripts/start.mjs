import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { root, startEngine } from "./engine.mjs";

if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (connected) => { socket.destroy(); resolve(connected); };
    socket.setTimeout(500);
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("timeout", () => finish(false));
  });
}

let engine;
const url = process.env.III_URL ? new URL(process.env.III_URL) : null;
if (url && ["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "49134" && !await canConnect(url.hostname, 49134)) {
  engine = startEngine();
  let connected = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (engine.exitCode !== null || engine.killed || process.exitCode) break;
    if (await canConnect(url.hostname, 49134)) { connected = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!connected) { engine.kill(); throw new Error("iii Engine did not start; check its output above"); }
}

const server = spawn(process.execPath, [resolve(root, "apps/server/dist/index.js")], {
  cwd: root, stdio: "inherit", windowsHide: true,
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" },
});
server.on("exit", (code) => { engine?.kill(); process.exitCode = code ?? 1; });
server.on("error", (error) => { console.error(error.message); engine?.kill(); process.exitCode = 1; });
engine?.on("exit", () => { if (server.exitCode === null) server.kill(); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.kill(); engine?.kill(); });
