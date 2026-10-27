# 社会模拟选型：两个完整替代的源码核查

当前工程选择：先做 Stanford Generative Agents 的最小行为与恢复验证；AI Town 保留为交互界面优先时的备选。两者都先按单项目改造评估，暂不组合，不继续扩修 agent-world。这个判断来自助手的静态源码核查，待人工复核；尚未运行这两个应用，也不是产品模型成功完成的推荐。

## 为什么这样选择

第一性原理：本例的核心是角色能根据记忆、目标和共同事件改变行动。地图上能走动、能聊天还不足以满足这个要求。界面和框架数量应服从这个可验证的行为闭环。

原用户只给出了多 agent 交互与真实社会模拟游戏方向。身份、记忆、目标、关系、共同事件、玩家介入、保存恢复是助手在试用中展开的验收假设，不能反写为用户已经逐项确认的硬要求。若实际优先级是尽快有可玩的多人聊天小镇，AI Town 的验证顺序应提前。

| 核查问题 | AI Town | Stanford Generative Agents |
| --- | --- | --- |
| 记忆是否进入生成或决策 | 对话摘要写入记忆；开场及续聊检索记忆并进入提示 | 感知事件写入记忆；检索相关事件/想法后进入计划，再反思及执行 |
| 自主行动是否受目标驱动 | 已核查的 `agentDoSomething` 分支使用随机活动、随机游走和交谈冷却；有明确 TODO，不能当作目标规划 | `plan` 包含日程和事件反应；会选择事件、判断交谈/等待并改变当前行动。目标强度和行为质量仍待实测 |
| 关系是否影响行动 | 共同交谈记录用于冷却，记忆影响对话；未证实通用关系状态改变行动策略 | 检索的角色事件能进入反应选择；未证实有满足游戏需求的稳定数值关系系统 |
| 共同世界及介入 | world 的统一 tick 推进角色/对话，玩家 join/moveTo 进入输入处理；通用公共事件改变行为仍未知 | 环境文件进入模拟，角色 perceive/retrieve/plan/execute；whisper 可写入想法。研究交互不等于可用游戏操作 |
| 保存与恢复 | 引擎更新和世界差量在同一 mutation 中提交；load 从数据库还原。进程重启、未完成模型任务、数据库部署依赖仍未验证 | save 写 meta 与各角色记忆；构造时从既有模拟复制并读取 meta、环境和记忆。分文件保存非原子整体快照，保存与环境步数一致性须实测 |
| 更适合先验证什么 | 交互小镇与对话体验；补足目标/公共事件行为的工程量 | 记忆、计划、事件反应的行为闭环；启动兼容性、恢复和模型成本 |

源码存在不等于运行有效；以上描述只覆盖明确读取的分支，未出现的能力记为未知，不推断整个仓库不存在。

## 可复核的固定源码

采集脚本：[audit-social-alternatives.mjs](../../scripts/audit-social-alternatives.mjs)。只读取两个已固定提交的指定目录清单，再按实际路径读取 blob；验证 Git SHA-1、字节数和 UTF-8，保存完整选中文件及来源回执。不运行上游代码、不下载依赖。清单不声称覆盖全仓库。

AI Town 提交：`8e05997f2409275669c8344b84a51692e83f3f33`。

- [agentOperations.ts](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/aiTown/agentOperations.ts#L132)：`const activity = ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)];`，之前有 `TODO: have LLM choose the activity & emoji`。
- [conversation.ts](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/agent/conversation.ts#L35)：`searchMemories` 的结果进入对话消息；不能推断行走/活动同样受记忆驱动。
- [game.ts](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/aiTown/game.ts#L360)：`saveWorld` 先 `applyEngineUpdate` 再 `Game.saveDiff`；同文件 `Game.load` 是读取链入口。实际事务/调度依赖 Convex。
- [player.ts](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/aiTown/player.ts#L266)：join、leave、moveTo 输入改变统一游戏状态。
- [agent.ts](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/aiTown/agent.ts#L337)：候选采用 `candidates.push({ id: otherPlayer.id, position });`，其中 `position` 来自当前玩家，随后按该坐标算距离；所有候选距离都会是零，无法兑现注释中的“最近候选”。这是固定源码的局部反证，未执行应用复现，不证明全部社交行为失败。

Stanford 提交：`fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4`。

- [persona.py](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/persona.py#L220)：`perceived → retrieved → plan → reflect → execute`；同文件构造与 save 连接三种记忆。
- [perceive.py](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/perceive.py#L177)：当前事件经 `a_mem.add_event` 写入记忆。
- [retrieve.py](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/retrieve.py#L16)：感知事件对应的相关事件和想法进入返回结果。
- [plan.py](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/plan.py#L971)：选取检索事件，`_should_react` 后进入 `_chat_react` 或 `_wait_react`；不等于任意公共事件都有正确反应。
- [converse.py](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/converse.py#L239)：`load_history_via_whisper` 将输入生成的想法写入记忆，仍依赖模型。
- [reverie.py](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/reverie.py#L157)：保存 meta 和 persona；初始化另读环境及记忆，模拟每步另写 movement。保存方法本身不足以证明重启后可继续。

本地原始回执：`.data/experiments/social-alternatives-source-2026-10-23/`。归档证据包含选中文件完整内容、固定 blob 与精确行号；产品显示为人工核查记录，所有条目都明确是静态检查。

## 下一个能推翻选择的实验

只验证 Stanford 单项目，不先拼接 AI Town：在隔离目录记录依赖、配置和模型用量，先用最小角色基线启动。固定世界、起始角色及输入，用对照组与事件组观察“事件写入记忆→检索→计划改变→可见行动”的完整链；每步保留状态、来源和模型结果，不能仅用回答文字判断成功。再正常保存、结束进程，在新进程恢复，核对时间步、角色位置、记忆和未完成行动，继续推进一轮。

若现有模型/依赖不兼容、恢复状态不一致，或事件只改变话术却不改变计划，先停止扩展并记录阻碍。模型失败与行为不成立分开。只有闭环通过才讨论扩大规模或加游戏交互。不给无依据的工时/费用数字，不自动重用本项目的模型密钥到第三方程序。

对抗式审查：这轮仍是助手选例、助手阅读和助手下判断，没有独立用户、运行或因果对照证据。选择 Stanford 是下一步验证优先级，不是最终采用承诺。AI Town 的界面与现代部署可能更适合某些用户；行为目标优先级改变就应重排。两套项目的状态、调度和存储差异已经可见，但尚无组合接口和总成本证据，不能声称拼接更便宜。

## 与评估超时的关系

原补充研究保持 failed，无模型评估和推荐。本轮静态核查不是续跑成功。离线输入体积统计单独记录；没有失败调用的完整输入及 token 回执，不能将超时归因于上下文膨胀，也不以延长等待掩盖失败。下一项产品可靠性工作应让已采材料能在明确范围内恢复比较，避免重搜和重采；仍属待实现要求。
