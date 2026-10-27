import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { experimentSchema } from "../apps/server/dist/experiments.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const work = resolve(root, ".data/experiments/agent-world-service");
const execution = JSON.parse(readFileSync(resolve(work, "daphne-latest.json"), "utf8")).directory;
const id = "agent-world-daphne-rerun-2026-10-26";
const target = resolve(root, ".data/live-20261026/technical-experiments", id);
if (existsSync(target)) throw new Error(`Archive already exists: ${id}`);
mkdirSync(target, { recursive: true });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const copy = (source, name = source) => { copyFileSync(resolve(execution, source), resolve(target, name)); return { name, sha256: sha(readFileSync(resolve(target, name))) }; };
const artifacts = [
  copy("result.json"),
  copy("phase1-client.json"),
  copy("phase2-client.json"),
  copy("phase1-db.json"),
  copy("phase2-db.json"),
  copy("phase1.log", "phase1-log.md"),
  copy("phase2.log", "phase2-log.md"),
  copy("migrate.log", "migrate-log.md"),
];
const modification = {
  description: "原始 manage.py runworld 拓扑复现入口和只读 MCP/SQLite 客户端探针；不修补上游代码。",
  commit: "13d62dbdeeca07c7b5bb3b8aa264ca9834b01882",
  files: ["daphne_manage.py", "daphne_client_probe.py", "daphne_db_probe.py", "run-daphne.mjs", "../vendor/environment/frontend_server/manage.py"].map(name => {
    const path = name.startsWith("../") ? resolve(work, "vendor/environment/frontend_server/manage.py") : resolve(root, "experiments/agent-world-service", name);
    return { name, content: readFileSync(path, "utf8") };
  }),
};
writeFileSync(resolve(target, "modification.json"), JSON.stringify(modification, null, 2), "utf8");
artifacts.push({ name: "modification.json", sha256: sha(readFileSync(resolve(target, "modification.json"))) });
copyFileSync(resolve(root, "docs/research/2026-10-26-agent-world-daphne-rerun.md"), resolve(target, "findings.md"));
artifacts.push({ name: "findings.md", sha256: sha(readFileSync(resolve(target, "findings.md"))) });
const result = JSON.parse(readFileSync(resolve(execution, "result.json"), "utf8"));
const labels = ["原始拓扑结果", "第一次 MCP 客户端回执", "第二次 MCP 恢复回执", "第一次 SQLite 直读", "第二次 SQLite 直读", "第一次 Daphne 日志", "第二次 Daphne 日志", "迁移日志", "复现脚本与固定源码", "中文结论与反证"];
const record = experimentSchema.parse({
  id,
  title: "社会模拟选型：原始 Daphne 启动器持久化反证",
  question: "上游 manage.py runworld 的真实 Daphne + MCP + tick loop 是否能持久化注册、记忆并在新进程恢复？",
  conclusion: "原始 Daphne 拓扑能够启动 Web、MCP 和 tick loop，但注册与记忆接口返回表面成功，SQLite 始终为空，停止后新进程无法恢复 API key；直接采用路径应停止。",
  executedAt: result.executedAt,
  environment: "Windows / Python 3.12.10 / 固定 61 个 wheel；上游 manage.py runworld；Daphne 4327、MCP 4328；两次独立进程；SQLite 直读。",
  inputOrigin: "根据社会模拟场景构造 Alice/Bob 合成角色，调用真实 MCP 注册、remember、context 和重启读取；无外部 LLM 或玩家数据。",
  projectIds: ["1174766694"],
  sources: [{ repository: "sbenodiz/agent-world", commit: result.commit, modification: { artifact: "modification.json", sha256: artifacts.find(item => item.name === "modification.json").sha256, description: "只读复现脚本和固定上游 manage.py；没有修改上游行为。" } }],
  checks: [
    { label: "Daphne Web 启动", outcome: "supported", observation: "上游 runworld 在 4327 返回 HTTP 200。" },
    { label: "后台 MCP 与 tick loop 启动", outcome: "supported", observation: "日志显示 MCP server running 和 World tick loop started，MCP 列出五个工具。" },
    { label: "接口表面响应", outcome: "supported", observation: "注册返回 agent_id/api_key，remember 返回 ok:true，上下文返回记忆。" },
    { label: "SQLite 持久化", outcome: "refuted", observation: "第一次动作后直接读取 world_agentrecord 得到 0 行；日志出现 async ORM 错误。" },
    { label: "新进程恢复", outcome: "refuted", observation: "第二次进程 SQLite 仍为 0 行，原 API key 返回 Unknown API key。" },
    { label: "直接采用与独立效用", outcome: "inconclusive", observation: "长期负载、玩家流程、外部 LLM 和独立用户收益未测；但核心持久化反证已足以否决直接采用。" },
  ],
  limitations: result.limitations,
  nextAction: "停止上游原版直接采用；若继续，限定为维护本地服务边界的单项目改造，并验证长期运行、中途退出和玩家流程，不引入第二套世界状态系统。",
  artifacts: artifacts.map((item, index) => ({ ...item, label: labels[index] })),
});
writeFileSync(resolve(target, "record.json"), JSON.stringify(record, null, 2), "utf8");
console.log(JSON.stringify({ id, target, artifacts: artifacts.length, executedAt: result.executedAt }));
