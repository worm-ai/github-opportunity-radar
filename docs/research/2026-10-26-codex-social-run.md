# 2026-10-26 Codex 社会模拟研究记录

## 目的

用一个可证伪的真实需求检查“自然语言需求 → GitHub 搜索与采集 → 单项目改造或组合比较 → 证据与下一步验证”的完整链路。验收案例是本地优先的多智能体社会模拟原型，要求至少三个角色具备持久身份、记忆和目标，能在共享世界事件下交流并行动，允许玩家介入，且进程重启后恢复角色、世界和模拟进度。

## 实际运行

- 独立服务：`http://127.0.0.1:4345`
- 服务配置：`ANALYSIS_PROVIDER=codex`、`CODEX_MODEL=gpt-6.1-sol`
- 初始任务：`86d3fbe7-7c0a-407a-8ddf-d3fa3678aab5`
- 恢复任务：`b3de05fa-01d5-4e29-a618-2006941e03a2`
- 初始任务完成规划、4 次 GitHub 搜索和 4 个仓库采集后，评估超时；恢复任务通过真实 `resume-evaluation` 复用材料并重新规划。
- 恢复任务完成 2 次缺口搜索、第二轮评估和反方审查，最终状态为 `partial`，结果为 `insufficient_evidence`，`recommendedPathId` 为 `null`。

恢复任务共记录 6 次搜索、8 个仓库、16 份来源、8 次采集结果、2 轮评估和 4 次模型调用。搜索词为 `generative agents`、`AI Town`、`agent simulation game`、`persistent world simulation`、`agent simulation checkpoint`、`event driven agents`。

采集的仓库包括：

- [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town)
- [KsanaDock/Microverse](https://github.com/KsanaDock/Microverse)
- [joonspk-research/generative_agents](https://github.com/joonspk-research/generative_agents)
- [mkturkcan/generative-agents](https://github.com/mkturkcan/generative-agents)
- [Aeesh/Quilltale](https://github.com/Aeesh/Quilltale)
- [yuema137/MineWorld](https://github.com/yuema137/MineWorld)
- [mewamew/my_ai_town](https://github.com/mewamew/my_ai_town)
- [Agentshire/Agentshire](https://github.com/Agentshire/Agentshire)

## 结论与反方审查

第一轮把 `KsanaDock/Microverse` 作为单项目改造候选，第二轮把 `mewamew/my_ai_town` 作为单项目改造候选。两轮都没有足够证据支持组合方案。

反方审查拒绝推荐，理由是：没有固定提交 SHA；没有安装、启动或恢复的运行记录；至少三个角色的身份、目标和记忆是否落盘未知；共享事件到角色行动的因果链未知；异常退出后模拟时钟、任务和待处理事件是否恢复未知；本地优先和目标平台约束也未得到运行证明。

因此这次运行的真实产物是“优先核查对象 + 可推翻实验”，不是“已经找到可运行实现”。这一区分是产品核心边界：静态 README 或源码迹象只能形成候选证据，不能升级为采用建议。

## 下一项可执行验证

固定 `Microverse` 或 `my_ai_town` 的具体提交，安装依赖并启动；创建三个具名角色；注入唯一共享事件；记录感知、交流、行动和共享状态；让玩家介入；保存后结束进程并重启；比较角色身份、记忆、目标、世界时间、任务队列和模拟进度。任一关键状态无法重现，就撤销“可直接采用”或“单项目改造即可满足”的判断。

完整的机器可读摘要见 [.data/verification/demand-codex-social/summary.json](../../.data/verification/demand-codex-social/summary.json)。
