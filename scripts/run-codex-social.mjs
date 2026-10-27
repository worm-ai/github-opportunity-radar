const question = "我想做一个本地优先的多智能体社会模拟原型：至少三个角色各自有持久身份、记忆和目标，在共享世界事件驱动下交流并采取可观察行动；玩家能够介入世界或角色；进程重启后角色、世界和模拟进度可以恢复。请在 GitHub 上寻找可直接运行的完整实现；如果没有，再比较单项目改造与组合方案。需要给出固定版本或可核查源码证据、依赖和启动方式、哪些能力只是静态证据、最小运行验证步骤，以及明确的采用/改造/停止建议。";
const response = await fetch("http://127.0.0.1:4345/api/v1/demands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, requestId: crypto.randomUUID() }) });
if (!response.ok) throw new Error(await response.text());
console.log(JSON.stringify(await response.json()));
