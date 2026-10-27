import { randomUUID } from "node:crypto";

const base = process.env.RADAR_BASE ?? "http://127.0.0.1:4345/api/v1";
const question = "我需要一个本地优先的多智能体社会模拟原型：至少三个角色具有持久身份、记忆和目标，在共享世界事件驱动下交流并采取可观察行动；玩家可以注入事件，进程重启后状态必须恢复。请真实搜索 GitHub，优先找可直接运行的单项目；若不满足，再比较单项目改造与组合方案。固定提交、依赖、许可证和启动方式，实际运行最小验证，明确支持、反证和未验证项。";
const response = await fetch(`${base}/demands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, requestId: randomUUID() }) });
if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
const started = await response.json();
console.log(JSON.stringify({ started: { id: started.id, status: started.status, model: started.snapshot?.model } }));
for (let index = 0; index < 36; index++) {
  await new Promise(resolve => setTimeout(resolve, 10000));
  const current = await (await fetch(`${base}/demands/${started.id}`)).json();
  const snapshot = current.snapshot;
  console.log(JSON.stringify({ index: index + 1, id: current.id, status: current.status, stage: snapshot?.stage, searches: snapshot?.searches?.length ?? 0, projects: snapshot?.projects?.length ?? 0, evaluations: snapshot?.evaluations?.length ?? 0, recommendedPathId: snapshot?.recommendedPathId ?? null, error: current.error }));
  if (current.status !== "running") {
    console.log(JSON.stringify({ final: { id: current.id, status: current.status, outcome: snapshot?.outcome, recommendedPathId: snapshot?.recommendedPathId, plan: snapshot?.plan, projects: snapshot?.projects, evaluations: snapshot?.evaluations, reviews: snapshot?.reviews, warnings: snapshot?.warnings, calls: snapshot?.calls } }, null, 2));
    break;
  }
}
