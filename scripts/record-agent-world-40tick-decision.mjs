import { randomUUID } from "node:crypto";

const base = "http://127.0.0.1:4348/api/v1";
const demandId = "88f93fcf-f102-466b-960b-cc53e4978d63";
const priorId = "113a3556-3109-4d5c-ac40-082ff279aa8e";
const catalog = await (await fetch(`${base}/demands/${demandId}/note-sources`)).json();
const source = catalog.sources.find((item) => item.ref?.kind === "experiment" && item.ref.experimentId === "agent-world-continuous-rerun-20261026t193122549z");
if (!source) throw new Error("40 tick experiment source unavailable");
const quote = source.text.split(/\r?\n/)[1];
const payload = {
  requestId: randomUUID(),
  author: "assistant",
  title: "agent-world 本地桥接 40 tick 与玩家事件可见性复核（UTF-8 修订）",
  question: "在 32 tick 之后，固定提交的本地桥接能否在更长周期、强制终止恢复和玩家事件可见性上保持一致？这是否足以继续投入完整社会模拟游戏？",
  projectIds: ["1174766694"],
  originDemandId: demandId,
  decision: "continue",
  conclusion: "40 tick 连续运行与第 30 个已提交检查点后强制终止、恢复 10 tick 的最终轨迹摘要一致，摘要哈希均为 1a61768df83d4e877d5b021a4d2705cf07c657682fd14c3a05c5c8222a07eaa8；第 5 和第 11 tick 注入的玩家事件在 WebSocket 与 HTTP 状态均可见，7 个归档产物的服务端 SHA-256 全部一致。因此继续验证本地异步桥接仍有技术依据，但上游原版直接采用结论不变，也不能据此宣称完整游戏、外部 LLM 社会智能或独立用户收益已经成立。",
  nextAction: "下一步只做一次提交进行中的失败/回滚实验：在保存阶段注入失败，检查 SQLite、内存、事件队列和重启结果是否都回到失败前状态，并确认失败不生成成功归档。若原子性不成立，停止继续堆叠 agent-world 改造并重新比较候选；若成立，再补完整玩家 UI 流程与真实用户任务耗时对照。",
  evidence: [{ ref: source.ref, quote }],
  supersedesId: priorId,
};
const response = await fetch(`${base}/research-notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
const body = await response.text();
if (response.status !== 201) throw new Error(`${response.status}: ${body}`);
const saved = JSON.parse(body);
if (saved.title !== payload.title || saved.conclusion !== payload.conclusion || saved.supersedesId !== priorId) throw new Error("UTF-8 revision mismatch");
console.log(JSON.stringify({ id: saved.id, supersedesId: saved.supersedesId, title: saved.title, evidenceStates: saved.evidenceStates }, null, 2));
