# agent-world 本地桥接持续循环与中途终止复跑

执行时间：2026-10-26

## 问题

此前的本地改造只证明“一个完成的 tick 可以写入检查点”。本次实验验证更接近实际服务的闭环：三个具名角色通过真实 FastMCP Streamable HTTP 调用观察和行动，ASGI/Channels viewer 接收状态；进程在第 4 个已提交 tick 后被强制终止，随后从同一个 SQLite 检查点恢复并继续运行。

## 固定输入与对照

- 仓库：`sbenodiz/agent-world`
- 提交：`13d62dbdeeca07c7b5bb3b8aa264ca9834b01882`
- 初始数据库只生成一次，然后复制到连续组和中断组，避免 UUID 或初始状态差异。
- 连续组运行 8 个 tick。
- 中断组运行第 1 至 4 个 tick，在检查点写入后用 `taskkill /F` 终止进程，再启动新进程运行第 5 至 8 个 tick。
- 每个循环都通过 MCP 完成 Alice 对 Bob 的 whisper、Bob 的 remember、Cara 的 emote，并读取 Alice 的 nearby；不是直接修改内存。

## 结果

运行归档：`.data/experiments/agent-world-service/continuous-crash-20261026T144258540Z`

- 连续组最终摘要哈希：`66c3975ab2a2c22c0f036f588dea1ecbb466abba8530cc20f7cd6e10e8c579be`
- 恢复组最终摘要哈希：`66c3975ab2a2c22c0f036f588dea1ecbb466abba8530cc20f7cd6e10e8c579be`
- 第 4 个检查点在强制终止前后可恢复。
- 三个 API key、记忆、关系、当前动作、待处理事件、世界时钟和后续轨迹一致。
- 4 个恢复 tick 均产生 WebSocket viewer 更新；MCP action/context/nearby 调用全部完成。

## 修复的真实缺陷

复跑先发现两类会让恢复轨迹漂移的缺陷：

1. Channels 用 Python 全局随机数生成频道名，污染了世界事件的随机状态。改造增加独立 simulation RNG，并把它写入检查点。
2. Python 集合遍历和数据库加载顺序未固定，导致 `agent_arrived` 与关系阈值事件顺序跨进程变化。改造恢复检查点中的角色顺序，并对邻居事件使用排序遍历。

这两项修复是持续服务所需的行为约束，不是把测试器放宽来掩盖差异。

## 判断

本地异步桥接路线现在通过“真实 MCP 循环 + WebSocket 观察 + 已提交边界的强制终止恢复”这一层验证，可以继续做玩家事件注入和更长周期测试。它仍然不证明上游原版可直接采用，也不证明外部 LLM、涌现社会智能、Godot 图形或独立用户节省时间。

## 尚未覆盖

- 数据库提交进行中的掉电或硬件故障；本次终止点位于已完成检查点之后。
- 外部 LLM 驱动的角色决策与长期行为质量。
- 玩家真实任务、完整游戏验收和独立用户收益。
