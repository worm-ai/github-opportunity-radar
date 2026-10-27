# 需求结果页直达受控实测：agent-world 独立复跑

需求：`88f93fcf-f102-466b-960b-cc53e4978d63`  
运行：`run-41138a7f5de04911875d4b080577a150`  
实验登记：`agent-world-continuous-crash-2026-10-27-v4`  
独立归档：`agent-world-continuous-rerun-20261026t180919829z`  
固定上游：`sbenodiz/agent-world@13d62dbdeeca07c7b5bb3b8aa264ca9834b01882`

用户从需求结果页的固定入口启动实测。运行器只接受服务端 allowlist 中的命令，不执行用户或仓库材料中的任意命令；状态持久化到当前 `DATA_DIR`，不会覆盖正式 v4 归档。

独立 rerun 的连续组运行 16 tick；中断组在第 12 个已提交检查点后结束，由新进程恢复并运行 4 tick。两组最终摘要哈希均为 `c4f40322085e00b65b06a3cf352f0a4714d91c3d8af51c73b34baaef988e9ce8`。MCP 动作与观察、WebSocket 更新、两个玩家事件、随机世界事件跨重启和检查点恢复均通过。

这项记录证明“从需求结果到固定实测再到可审计产物”的产品操作链。它不改写正式 v4 的 24 tick 证据，也不证明上游原版、外部 LLM、Godot、组合兼容、掉电中事务、完整游戏或独立用户节省时间。
