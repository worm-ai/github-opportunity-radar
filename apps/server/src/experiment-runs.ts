import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readExperiment } from "./experiments.js";

const runId = z.string().regex(/^run-[a-f0-9]{32}$/);
const stateSchema = z.object({
  id: runId,
  experimentId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  command: z.array(z.string().min(1)).min(1).max(8),
  logFile: z.string().regex(/^run-[a-f0-9]{32}\.log$/),
  outputTail: z.string().max(12000),
  error: z.string().max(1000).nullable(),
}).strict();
export type ExperimentRun = z.infer<typeof stateSchema>;

type Manifest = { command: string[]; timeoutMs: number };
const manifests: Record<string, Manifest> = {
  "agent-world-adaptation-2026-10-23": {
    command: ["node", "experiments/agent-world-adaptation/reproduce.mjs"],
    timeoutMs: 20 * 60 * 1000,
  },
  "agent-world-continuous-crash-2026-10-27-v4": {
    command: ["node", "scripts/run-agent-world-continuous-online.mjs"],
    timeoutMs: 20 * 60 * 1000,
  },
};

function atomicWrite(path: string, content: string) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, path);
}

function tail(value: string) {
  return value.length > 12000 ? value.slice(-12000) : value;
}

export function createExperimentRunManager(options: { workspaceRoot: string; archiveRoot: string; dataDirectory: string }) {
  const stateDirectory = resolve(options.dataDirectory, "technical-experiment-runs");
  mkdirSync(stateDirectory, { recursive: true });
  const active = new Set<string>();

  function statePath(id: string) { return resolve(stateDirectory, `${id}.json`); }
  function logPath(id: string) { return resolve(stateDirectory, `${id}.log`); }
  function save(run: ExperimentRun) { atomicWrite(statePath(run.id), JSON.stringify(run, null, 2)); }

  function loadAll() {
    const runs: ExperimentRun[] = [];
    for (const entry of readdirSync(stateDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const run = stateSchema.parse(JSON.parse(readFileSync(resolve(stateDirectory, entry.name), "utf8")));
        if ((run.status === "running" || run.status === "queued") && !active.has(run.id)) {
          const recovered: ExperimentRun = { ...run, status: "failed", finishedAt: new Date().toISOString(), error: "服务重启时运行进程已失联，未将其视为成功", outputTail: tail(`${run.outputTail}\n[recovered as failed after service restart]`) };
          save(recovered);
          runs.push(recovered);
        } else runs.push(run);
      } catch { /* Ignore malformed state files; a warning is safer than a fabricated run. */ }
    }
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return runs.slice(0, 50);
  }

  function finish(run: ExperimentRun, status: "succeeded" | "failed", error: string | null) {
    const output = existsSync(logPath(run.id)) ? readFileSync(logPath(run.id), "utf8") : run.outputTail;
    const next: ExperimentRun = { ...run, status, finishedAt: new Date().toISOString(), outputTail: tail(output), error };
    active.delete(run.id);
    save(next);
    return next;
  }

  function start(experimentId: string) {
    const manifest = manifests[experimentId];
    if (!manifest) throw Object.assign(new Error("该实测没有登记可自动复现的固定入口"), { statusCode: 409, code: "experiment_not_runnable" });
    readExperiment(options.archiveRoot, experimentId);
    const existing = loadAll().find(item => item.status === "queued" || item.status === "running");
    if (existing || active.size) throw Object.assign(new Error("已有技术实测正在运行，请先等待它结束"), { statusCode: 409, code: "experiment_run_in_progress" });

    const id = `run-${randomUUID().replaceAll("-", "")}`;
    const startedAt = new Date().toISOString();
    const run: ExperimentRun = { id, experimentId, status: "queued", startedAt, finishedAt: null, command: manifest.command, logFile: `${id}.log`, outputTail: "", error: null };
    mkdirSync(stateDirectory, { recursive: true });
    writeFileSync(logPath(id), "", "utf8");
    save(run);
    active.add(id);
    const [executable, ...args] = manifest.command;
    if (!executable) throw new Error("实验登记缺少执行入口");
    const child = spawn(executable === "node" ? process.execPath : executable, args, {
      cwd: options.workspaceRoot,
      env: { ...process.env, PUBLISH_DATA_DIR: options.dataDirectory },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const running = { ...run, status: "running" as const };
    save(running);
    const write = (chunk: Buffer) => appendFileSync(logPath(id), chunk);
    child.stdout.on("data", write);
    child.stderr.on("data", write);
    let settled = false;
    const complete = (status: "succeeded" | "failed", error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish(running, status, error);
    };
    const timer = setTimeout(() => { child.kill(); complete("failed", `实测超过 ${Math.round(manifest.timeoutMs / 60000)} 分钟，已终止`); }, manifest.timeoutMs);
    child.once("error", error => complete("failed", error.message));
    child.once("exit", (code, signal) => complete(code === 0 ? "succeeded" : "failed", code === 0 ? null : `复现进程退出码 ${code ?? "null"}${signal ? ` (${signal})` : ""}`));
    return running;
  }

  return { list: loadAll, get: (id: string) => loadAll().find(item => item.id === id) ?? null, start, runnableIds: () => Object.keys(manifests) };
}

export function registerExperimentRunRoutes(api: FastifyInstance, manager: ReturnType<typeof createExperimentRunManager>) {
  api.get("/experiments/runs", async () => manager.list());
  api.get<{ Params: { runId: string } }>("/experiments/runs/:runId", async (request, reply) => {
    const parsed = runId.safeParse(request.params.runId);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_experiment_run_id", message: "无效的实测运行编号", requestId: request.id } });
    const run = manager.get(parsed.data);
    if (!run) return reply.code(404).send({ error: { code: "experiment_run_not_found", message: "实测运行不存在", requestId: request.id } });
    return run;
  });
  api.post<{ Params: { id: string } }>("/experiments/:id/runs", async (request, reply) => {
    try { return reply.code(202).send(manager.start(request.params.id)); }
    catch (error) {
      const status = error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 400;
      return reply.code(status).send({ error: { code: error instanceof Error && "code" in error ? String(error.code) : "experiment_run_failed", message: error instanceof Error ? error.message : "无法启动实测", requestId: request.id } });
    }
  });
}
