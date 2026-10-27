const base = "http://127.0.0.1:4340/api/v1";
const demandId = "88f93fcf-f102-466b-960b-cc53e4978d63";
const projectId = "1174766694";
const experimentId = "agent-world-continuous-crash-2026-10-27-v4";
const sources = await (await fetch(`${base}/demands/${demandId}/note-sources`)).json();
const source = sources.sources.find(item => item.ref.kind === "experiment" && item.ref.experimentId === experimentId);
if (!source) throw new Error("Continuous bridge experiment source unavailable");
const quote = source.text.split("\n").find(line => line.startsWith("实测结论"));
if (!quote) throw new Error("Exact experiment conclusion quote unavailable");
const payload = {
  requestId: crypto.randomUUID(), author: "assistant", title: "继续验证本地异步桥接路线",
  question: "三个角色通过真实 MCP 持续观察和行动时，本地桥接是否能在进程强制终止后恢复核心世界状态？",
  projectIds: [projectId], originDemandId: demandId, decision: "continue",
  conclusion: "继续验证本地异步桥接路线。连续 8 tick 与第 4 个已提交 tick 后强制终止、重启再跑 4 tick 的身份、记忆、关系、事件队列、时钟和后续轨迹一致；上游原版直接采用仍然停止。",
  nextAction: "加入玩家事件注入并运行更长周期，随后测试非正常中断边界；若需要重写大部分服务核心则重新比较候选，不引入第二套世界状态系统。",
  evidence: [{ ref: source.ref, quote }],
};
const response = await fetch(`${base}/research-notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
const body = await response.json();
console.log(JSON.stringify({ status: response.status, noteId: body.id, decision: body.decision, evidenceStates: body.evidenceStates }, null, 2));
if (response.status !== 201) process.exit(1);
