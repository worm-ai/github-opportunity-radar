# 2026-10-26 agent-world 原始 Daphne 拓扑复跑

## 目的

前两轮证据分别覆盖了本地改造核心和自建双 Uvicorn 桥接。它们不能证明上游 README 中的真实启动方式可用。本次直接执行固定提交中的 `environment/frontend_server/manage.py runworld`，让上游自己的管理命令启动 Daphne 主线程、后台 MCP 线程和 tick loop，然后检查 MCP 动作是否真的落入 SQLite，以及停止后新进程是否能恢复。

## 实际运行

- 固定仓库：[sbenodiz/agent-world](https://github.com/sbenodiz/agent-world)
- 固定提交：`13d62dbdeeca07c7b5bb3b8aa264ca9834b01882`
- Web：`127.0.0.1:4327`
- MCP：`127.0.0.1:4328/mcp`
- 拓扑：上游 `manage.py runworld`，Daphne 主线程 + 后台 FastMCP/tick loop
- 两个阶段：第一次启动并注册 Alice/Bob、写入记忆；停止；第二次启动并尝试用原 API key 恢复。

Web、MCP 和 tick loop 都成功启动。第一次 MCP 调用返回注册结果，`act remember` 返回 `ok: true`，上下文也能看到记忆。但直接读取 SQLite 得到 0 行；日志同时记录 `You cannot call this from an async context - use a thread or sync_to_async`。停止服务后第二次进程仍是 0 行，原 API key 返回 `Unknown API key`。

这说明真实上游入口存在“接口表面成功、持久化失败、重启丢失身份和记忆”的可复现反证。单看 MCP JSON 或 Web 200 不能称为可运行社会模拟。

## 选型影响

原始 `agent-world` 直接采用路径现在应停止：它不能满足持久身份、记忆和重启恢复的基本条件。之前的本地异步桥接实验仍有价值，但其通过的是本地改造启动器；下一步只在明确愿意维护服务边界的前提下评估改造路线，不再继续为上游原版补充静态研究或拼接第二套世界系统。

本实验没有覆盖长期负载、掉电、中途 kill、完整玩家流程、外部 LLM、Godot 图形或独立用户收益。机器产物通过产品当前 4340 归档为 `agent-world-daphne-rerun-2026-10-26`，研究页可直接查看。原始回执见 `.data/verification/agent-world-daphne-20261026/summary.json`。

该结论已经保存为研究判断 `28095417-f9e6-43f4-ad63-2a0a8d515427`，决策为 `stop`，引用状态为 `same`；页面核验确认判断在刷新后仍可见，移动端无横向溢出，未产生写请求。
