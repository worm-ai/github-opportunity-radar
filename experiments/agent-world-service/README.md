# agent-world 真实服务入口探针

目的：核实真实 MCP 返回值、WebSocket/HTTP 观察结果与 SQLite 是否一致，判断上一轮串行核心改造能否直接接到服务。固定上游提交 `13d62dbdeeca07c7b5bb3b8aa264ca9834b01882`；没有外部模型或用户数据。

从仓库根目录运行，前置为原版行为实验与最小改造实验的源码和 Python：

```powershell
node experiments/agent-world-service/prepare.mjs
node experiments/agent-world-service/bootstrap.mjs
./.data/experiments/actual-ecommerce-noter/python/python.exe -I -B -X utf8 experiments/agent-world-service/run.py
node experiments/agent-world-service/analyze.mjs
```

`prepare.mjs` 校验 Git blob，下载真实 MCP、ASGI、WebSocket consumer、HTTP 路由及入口 HTML，不修改原版核心副本。`bootstrap.mjs` 只在本实验目录安装 wheel：直接依赖固定，传递依赖由 pip 解析并全部保存版本与 SHA-256。PyPI 官方域名在此次网络中超时，使用清华 TLS 镜像；镜像哈希不等于独立的发布者签名。第二次可从本地 wheel 目录安装；完整版本以该次 `runtime.json` 为准。

`run.py` 用四个新进程、两份独立 SQLite，分别执行原版/上一轮改造版服务及停止后的重载，比较各自接入未修改 MCP 工具的表现。采用上游真实 FastMCP Streamable HTTP、官方 MCP Python 客户端和真实前端 ASGI/Channels consumer，监听 `127.0.0.1:4325/4326`。先确认端口空闲再执行，并等待 bootstrap 进程退出成功。每个子进程限时 100 秒，排除宿主凭证。

探针只改启动与配置：两个 Uvicorn 服务和真实 tick loop 共用一个 asyncio loop，替代原版 runworld 的 Daphne 主线程与后台循环；不声称原版完整启动器已通过。图形资产没有下载完整，HTML 来源可核查，但本轮不验收地图渲染。

检查 context、remember/emote、无效 key/动作、自动注册、真实 tick 广播和 HTTP 状态，另外直接读 SQLite，不能仅看接口 `ok`。失败日志和初次尝试保留。预期问题与实际结论必须以产物区分：出现 ORM 异步保护错误时不关闭保护、不把内存变化说成持久化成功。

`analyze.mjs` 对实际调用、观察状态、SQLite 和新进程恢复做一致性断言，生成带脚本、依赖清单和原始产物哈希的 `result.json`。断言通过指探针发现得到核对，不表示上游服务可采用。当前发现见 [中文报告](../../docs/research/2026-10-23-agent-world-service.md)。这不是服务并发修复、完整游戏、代理智能或产品省时证明。
## 持续循环与中途终止恢复

使用 `run-continuous-crash.mjs` 运行真实 FastMCP/ASGI 三角色循环：先生成一个固定检查点，再分别连续运行和在第 4 个已提交 tick 后强制终止并恢复。脚本会比较两个最终持久化轨迹，并把结果写入 `continuous-crash-latest.json`。

```powershell
node experiments/agent-world-service/run-continuous-crash.mjs
node scripts/publish-agent-world-continuous-rerun.mjs
node scripts/verify-agent-world-continuous-live.mjs
```

当前正式归档使用 16 tick、1.1 秒真实循环间隔、第 12 tick 强制终止，以及第 5/11 tick 玩家事件注入；归档编号为 `agent-world-continuous-crash-2026-10-26-v3`。快速循环会触发上游动作限流，不能据此宣称恢复失败或删除限流。
