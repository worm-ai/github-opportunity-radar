const base = "http://127.0.0.1:4340/api/v1";
const demandId = "88f93fcf-f102-466b-960b-cc53e4978d63";
const projectId = "1174766694";
const experimentId = "agent-world-daphne-rerun-2026-10-26";
const sources = await (await fetch(`${base}/demands/${demandId}/note-sources`)).json();
const source = sources.sources.find(item => item.ref.kind === "experiment" && item.ref.experimentId === experimentId);
if (!source) throw new Error("Daphne experiment source unavailable");
const quote = source.text.split("\n").find(line => line.startsWith("实测结论："));
if (!quote || !source.text.includes(quote)) throw new Error("Exact experiment quote unavailable");
const payload = {
  requestId: crypto.randomUUID(), author: "assistant", title: "停止上游原版直接采用",
  question: "固定提交的上游 agent-world 原始 Daphne 启动器是否满足持久身份、记忆和重启恢复？",
  projectIds: [projectId], originDemandId: demandId, decision: "stop",
  conclusion: "停止上游 agent-world 原版直接采用。真实 runworld 拓扑可以启动，但注册和记忆没有落入 SQLite，重启后 API key 无法恢复；接口表面成功不能抵消持久化反证。",
  nextAction: "只继续验证本地异步桥接改造：补测长期代理循环、中途退出恢复和玩家观察/介入。若需要重写大部分服务核心，重新比较候选并停止此路线；不引入第二套世界状态系统。",
  evidence: [{ ref: source.ref, quote }],
};
const response = await fetch(`${base}/research-notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
const body = await response.text();
console.log(JSON.stringify({ status: response.status, body: JSON.parse(body) }, null, 2));
if (response.status !== 201) process.exit(1);
