import { randomUUID } from "node:crypto";

const base = "http://127.0.0.1:4348/api/v1";
const demandId = "88f93fcf-f102-466b-960b-cc53e4978d63";
const priorId = "a9c41bb9-2a8b-4b25-8502-7bbafb2605fe";
const catalog = await (await fetch(`${base}/demands/${demandId}/note-sources`)).json();
const find = (experimentId) => catalog.sources.find((item) => item.ref?.kind === "experiment" && item.ref.experimentId === experimentId);
const longRun = find("agent-world-continuous-rerun-20261026t193122549z");
const failureRun = find("agent-world-adaptation-2026-10-27-commit-failure");
if (!longRun || !failureRun) throw new Error("required experiment source unavailable");
const longRunQuote = longRun.text.split(/\r?\n/)[1];
const failureRunQuote = failureRun.text.split(/\r?\n/).find((line) => line.includes("真实 SQL 与检查点失败"));
const payload = {
  requestId: randomUUID(),
  author: "assistant",
  title: "agent-world 提交中失败与 40 tick 证据复核（UTF-8 修订）",
  question: "40 tick 长周期恢复之后，保存已写入角色但尚未完成世界检查点时，事务失败是否会回滚并拒绝混合状态？这是否改变继续改造的判定？",
  projectIds: ["1174766694"],
  originDemandId: demandId,
  decision: "continue",
  conclusion: "最新 40 tick 实验的连续组与强制终止恢复组轨迹一致，玩家事件在 WebSocket 与 HTTP 均可见，归档产物 SHA-256 全部通过；随后重新执行的提交失败实验在两种注入点都传播错误，角色行与世界检查点回滚，独立进程继续读取旧状态，哈希不符或角色行与检查点混合时拒绝载入。因此本地桥接的持久化边界已有可复核技术证据，继续做一次完整玩家 UI 与真实用户任务验证仍合理；这仍不等于上游原版、外部 LLM 社会智能、完整游戏或独立用户收益成立。",
  nextAction: "停止继续增加世界状态功能，先补一个可操作的玩家 UI 闭环：注入事件、观察角色反应、重启并确认状态；同时用一项可脱敏的真实选型任务做前后耗时和误留/漏选记录。若 UI 闭环或真实任务不能形成可观察收益，或后续需求需要重写大部分服务核心，则停止 agent-world 路线并重新比较候选，不引入第二套世界状态系统。",
  evidence: [{ ref: longRun.ref, quote: longRunQuote }, { ref: failureRun.ref, quote: failureRunQuote }],
  supersedesId: priorId,
};
const response = await fetch(`${base}/research-notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
const body = await response.text();
if (response.status !== 201) throw new Error(`${response.status}: ${body}`);
const saved = JSON.parse(body);
if (saved.title !== payload.title || saved.supersedesId !== priorId || saved.evidenceStates.some((state) => state !== "same")) throw new Error("decision revision mismatch");
console.log(JSON.stringify({ id: saved.id, supersedesId: saved.supersedesId, title: saved.title, evidenceStates: saved.evidenceStates }, null, 2));
