import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { experimentSchema } from "../apps/server/dist/experiments.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const work = resolve(root, ".data/experiments/agent-world-service");
const execution = JSON.parse(readFileSync(resolve(work, "latest.json"), "utf8")).directory;
const id = "agent-world-service-rerun-2026-10-26";
const target = resolve(root, ".data/live-20261026/technical-experiments", id);
if (existsSync(target)) throw new Error(`Archive already exists: ${id}`);
mkdirSync(target, { recursive: true });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const read = path => JSON.parse(readFileSync(path, "utf8"));
const copy = name => {
  copyFileSync(resolve(execution, name), resolve(target, name));
  return { name, sha256: sha(readFileSync(resolve(target, name))) };
};

const result = read(resolve(execution, "result.json"));
const copied = [
  "result.json",
  "original-bridged.json",
  "original-bridged-reload.json",
  "adapted-bridged.json",
  "adapted-bridged-reload.json",
].map(copy);
copyFileSync(resolve(work, "runtime/runtime.json"), resolve(target, "runtime.json"));
const runtime = { name: "runtime.json", sha256: sha(readFileSync(resolve(target, "runtime.json"))) };
copyFileSync(resolve(work, "sources.json"), resolve(target, "sources.json"));
const sources = { name: "sources.json", sha256: sha(readFileSync(resolve(target, "sources.json"))) };

const modification = {
  description: "本地单 asyncio loop、双 Uvicorn 服务探针；原版与本地改造均通过 async_bridge.py 接入真实 MCP。桥接属于本地实验启动器，不等同上游完整启动器。",
  commit: result.commit,
  scripts: ["run.py", "async_bridge.py", "analyze.mjs", "publish-agent-world-service-rerun.mjs"].map(name => ({ name, content: readFileSync(resolve(root, name.startsWith("publish") ? "scripts" : "experiments/agent-world-service", name), "utf8") })),
};
writeFileSync(resolve(target, "modification.json"), JSON.stringify(modification, null, 2));
const modificationArtifact = { name: "modification.json", sha256: sha(readFileSync(resolve(target, "modification.json"))) };

const logs = {
  execution,
  processes: read(resolve(execution, "processes.json")),
  stdout: ["original-bridged.stdout.txt", "original-bridged-reload.stdout.txt", "adapted-bridged.stdout.txt", "adapted-bridged-reload.stdout.txt"].map(name => ({ name, content: readFileSync(resolve(execution, name), "utf8") })),
  stderr: ["original-bridged.stderr.txt", "original-bridged-reload.stderr.txt", "adapted-bridged.stderr.txt", "adapted-bridged-reload.stderr.txt"].map(name => ({ name, content: readFileSync(resolve(execution, name), "utf8") })),
};
writeFileSync(resolve(target, "logs.json"), JSON.stringify(logs, null, 2));
const logsArtifact = { name: "logs.json", sha256: sha(readFileSync(resolve(target, "logs.json"))) };
copyFileSync(resolve(root, "docs/research/2026-10-26-agent-world-service-rerun.md"), resolve(target, "findings.md"));
const findings = { name: "findings.md", sha256: sha(readFileSync(resolve(target, "findings.md"))) };

const artifacts = [...copied, runtime, sources, modificationArtifact, logsArtifact, findings].map((item, index) => ({
  ...item,
  label: ["执行结果与边界", "原版桥接协议与观察状态", "原版桥接新进程恢复", "本地改造桥接服务调用", "本地改造桥接新进程恢复", "固定运行时与依赖", "原版与改造来源清单", "本地服务桥接启动器", "成功与失败尝试原始日志", "中文结论与反证"][index],
}));
const record = experimentSchema.parse({
  id,
  title: "社会模拟选型：agent-world 服务入口复跑与持久化反证",
  question: "真实 MCP 动作、WebSocket/HTTP 观察状态与新进程恢复是否一致，桥接后的单项目改造能否跨服务保存？",
  conclusion: result.conclusion,
  executedAt: result.executedAt,
  environment: "Windows / Python 3.12.10 / 61 个固定 wheel；本地双 Uvicorn、单 asyncio loop；真实 FastMCP/ASGI/Channels/SQLite；4 子进程、16 次调用；未验原版 Daphne/后台线程拓扑。",
  inputOrigin: "根据社会模拟场景构造四个合成角色及记忆/表情动作；本地官方 MCP 客户端脚本，无外部 LLM 或玩家数据。",
  projectIds: ["1174766694"],
  sources: [{ repository: "sbenodiz/agent-world", commit: result.commit, modification: { artifact: "modification.json", sha256: modificationArtifact.sha256, description: "本地服务桥接启动器；不代表上游完整服务已修复。" } }],
  checks: [
    { label: "真实协议与观察入口", outcome: "supported", observation: "两配置均列出五个 MCP 工具；真实 tick 后 WebSocket 与 HTTP 观察状态一致，仅覆盖本轮启动器。" },
    { label: "未桥接原版持久化边界", outcome: "refuted", observation: "未桥接原版入口的接口成功曾对应 SQLite 未更新，新进程丢失动作和记忆；旧失败日志仍归档。" },
    { label: "异步服务桥接", outcome: "supported", observation: "thread-sensitive sync_to_async 边界让两配置的注册、动作和记忆可被新进程恢复；本地改造配置额外恢复 tick 后检查点时钟。" },
    { label: "注册与错误输入", outcome: "supported", observation: "未知 key、无效动作和桥接注册失败返回结构化错误并保持内存映射一致。" },
    { label: "两客户端并发与失败回滚", outcome: "supported", observation: "两配置均完成并发动作；注入注册及动作保存失败后 SQLite 与内存回滚，Rejected 不出现在重载结果。" },
    { label: "完整服务可用性与独立效用", outcome: "inconclusive", observation: "未验证 Daphne 拓扑、重复请求、中途退出、长期代理循环、完整玩家干预、地图渲染或用户省时。" },
  ],
  limitations: result.limitations,
  nextAction: "在隔离副本复现真实 Daphne/后台循环拓扑，并验证重复请求、中途退出和长期运行；若需重写大部分核心则重新比较候选，不默认加入第二套世界状态。",
  artifacts,
});
writeFileSync(resolve(target, "record.json.tmp"), JSON.stringify(record, null, 2));
copyFileSync(resolve(target, "record.json.tmp"), resolve(target, "record.json"));
console.log(JSON.stringify({ id, target, artifacts: artifacts.length, executedAt: result.executedAt }));
