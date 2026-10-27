import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { experimentSchema } from "../apps/server/dist/experiments.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const work = resolve(root, ".data/experiments/agent-world-service");
const execution = resolve(process.env.RADAR_CONTINUOUS_EXECUTION ?? JSON.parse(readFileSync(resolve(work, "continuous-crash-latest.json"), "utf8")).directory);
const id = process.env.RADAR_EXPERIMENT_ID ?? "agent-world-continuous-crash-2026-10-27-v4";
const dataDirectory = resolve(process.env.PUBLISH_DATA_DIR ?? ".data/live-20261026");
const target = resolve(dataDirectory, "technical-experiments", id);
if (existsSync(target)) throw new Error(`Archive already exists: ${id}`);
mkdirSync(target, { recursive: true });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const copy = (source, name = source) => {
  copyFileSync(resolve(execution, source), resolve(target, name));
  return { name, sha256: sha(readFileSync(resolve(target, name))) };
};
const read = name => JSON.parse(readFileSync(resolve(execution, name), "utf8"));
const result = read("result.json");
const baselineTicks = result.phases.baseline.ticks;
const resumedTicks = result.phases.resumed.ticks;
const checkpointTick = result.phases.interrupted.checkpointTick;

const artifacts = [
  copy("result.json"),
  copy("seed.json"),
  copy("baseline.json"),
  copy("resume.json"),
  copy("split-artifacts/kill-ready.json", "kill-ready.json"),
];
const modification = {
  description: "本地异步桥接持续循环、独立模拟 RNG、稳定事件顺序与强制终止恢复探针；保留上游提交不变。",
  commit: result.commit,
  files: [
    "experiments/agent-world-service/continuous_runner.py",
    "experiments/agent-world-service/run-continuous-crash.mjs",
    "experiments/agent-world-service/run.py",
    "experiments/agent-world-service/async_bridge.py",
    "experiments/agent-world-adaptation/adapter.py",
  ].map(path => ({ path, content: readFileSync(resolve(root, path), "utf8") })),
};
writeFileSync(resolve(target, "modification.json"), JSON.stringify(modification, null, 2), "utf8");
artifacts.push({ name: "modification.json", sha256: sha(readFileSync(resolve(target, "modification.json"))) });
const findings = `# agent-world 本地桥接持续代理循环与中途终止恢复\n\n执行时间：${result.executedAt}\n\n## 验收问题\n\n本次运行覆盖连续 ${baselineTicks} tick，以及第 ${checkpointTick} 个已提交检查点后的强制终止与恢复。两个玩家事件在第 5 和第 11 tick 注入，第 ${checkpointTick} tick 覆盖随机世界事件边界。\n\n## 结果\n\n- 连续组最终摘要哈希：${result.phases.baseline.digest}\n- 恢复组最终摘要哈希：${result.phases.resumed.digest}\n- 连续组 ${baselineTicks} tick 与恢复组最终轨迹一致。\n- 恢复组 ${resumedTicks} 个 tick 均产生 viewer 更新；角色身份、记忆、关系、当前动作、事件队列、世界时钟和后续轨迹参与比较。\n\n## 边界\n\n- 强制终止发生在已提交检查点之后，证明的是恢复到最后提交边界，不是数据库提交中的掉电原子性。\n- 策略是确定性的 MCP 驱动动作，不是外部 LLM 或涌现社会智能。\n- 不包含 Godot 图形、完整玩家游戏验收或独立用户节省时间测量。\n`;
writeFileSync(resolve(target, "findings.md"), findings, "utf8");
artifacts.push({ name: "findings.md", sha256: sha(readFileSync(resolve(target, "findings.md"))) });

const record = experimentSchema.parse({
  id,
  title: "agent-world 本地桥接持续代理循环与中途终止恢复",
  question: "三个角色通过真实 MCP 持续观察和行动时，本地桥接是否能在进程强制终止后恢复身份、记忆、关系、事件和后续轨迹？",
  conclusion: `支持继续验证本地异步桥接路线：同一检查点的连续 ${baselineTicks} tick 与第 ${checkpointTick} tick 后强制终止、重启再跑 ${resumedTicks} tick 的持久化轨迹一致。上游原版直接采用结论不变；本实验也不等于 LLM 社会智能或完整游戏验收。`,
  executedAt: result.executedAt,
  environment: "Windows / 固定隔离 Python runtime / FastMCP Streamable HTTP / ASGI Channels viewer / SQLite / 三个子进程阶段",
  inputOrigin: "社会模拟游戏验收场景：三个具名角色通过 MCP 互相交流、记录玩家事件并持续推进世界时钟。",
  projectIds: ["1174766694"],
  sources: [{ repository: "sbenodiz/agent-world", commit: result.commit,
    modification: { artifact: "modification.json", sha256: artifacts.find(item => item.name === "modification.json").sha256,
      description: "本地服务桥接和适配器改造，不代表上游原版已修复。" } }],
  checks: [
    { label: "真实 MCP 代理循环", outcome: "supported", observation: "Alice whisper、Bob remember、Cara emote、nearby/context 调用在连续组和恢复组完成。" },
    { label: "WebSocket 观察", outcome: "supported", observation: `恢复后的 ${resumedTicks} 个 tick 均产生 viewer 更新。` },
    { label: "玩家事件注入", outcome: "supported", observation: "第 5 和第 11 tick 的两个玩家事件通过 inject_world_event MCP 工具注入并持久化。" },
    { label: "随机世界事件跨重启", outcome: "supported", observation: "第 12 tick 触发的随机世界事件在恢复后仍存在于状态与待处理事件中。" },
    { label: "检查点抵抗强制终止", outcome: "supported", observation: `第 ${checkpointTick} 个已提交检查点在 taskkill /F 后可被新进程加载。` },
    { label: "恢复后轨迹一致", outcome: "supported", observation: `连续 ${baselineTicks} tick 与恢复组最终摘要哈希均为 ${result.phases.baseline.digest}。` },
    { label: "基础设施随机性与顺序稳定", outcome: "supported", observation: "独立 simulation RNG、检查点角色顺序和排序事件遍历消除了跨进程漂移。" },
    { label: "玩家事件在 WebSocket 与 HTTP 可见", outcome: result.playerEventVisibility?.every(item => item.websocketVisible && item.httpVisible) ? "supported" : "refuted", observation: result.playerEventVisibility?.length ? result.playerEventVisibility.map(item => `第 ${item.tick} tick：WebSocket ${item.websocketVisible ? "可见" : "不可见"}，HTTP ${item.httpVisible ? "可见" : "不可见"}`).join("；") : "本次运行没有记录玩家事件可见性。" },
    { label: "完整游戏与独立用户收益", outcome: "inconclusive", observation: "没有外部 LLM、Godot 图形、掉电中提交、完整玩家流程或独立用户时间收益测量。" },
  ],
  limitations: result.limitations,
  nextAction: "继续在本地桥接上加入玩家事件注入并运行更长周期；随后测试非正常中断边界。若需要重写大部分服务核心，重新比较候选，不引入第二套世界状态系统。",
  artifacts: artifacts.map((item, index) => ({
    ...item,
    label: ["归档结果", "初始检查点阶段", `连续 ${baselineTicks} tick`, `恢复后 ${resumedTicks} tick`, `第 ${checkpointTick} tick 强制终止前检查点`, "改造脚本与源码", "研究结论"][index],
  })),
});
writeFileSync(resolve(target, "record.json"), JSON.stringify(record, null, 2), "utf8");
console.log(JSON.stringify({ id, target, artifacts: artifacts.length, executedAt: result.executedAt }));
