# agent-world 单项目最小改造验证

这是机会捕手针对选型疑问执行的隔离实验，不是社会模拟游戏产品。基于已核验的 `sbenodiz/agent-world@13d62dbdeeca07c7b5bb3b8aa264ca9834b01882`，新增可复查补丁、持久化适配器、三个合成角色的规则策略与共享供水规则。未使用外部 LLM，不能把新能力归给原版项目。

前置：先按 [原版行为实验](../agent-world-behavior/README.md) 准备固定源码、Python 3.12.10 与核验过的依赖。无需重新下载或调用模型。从仓库根目录执行：

```powershell
./.data/experiments/actual-ecommerce-noter/python/python.exe -I -B -X utf8 experiments/agent-world-adaptation/prepare.py
./.data/experiments/actual-ecommerce-noter/python/python.exe -I -B -X utf8 -X faulthandler experiments/agent-world-adaptation/run.py
```

`prepare.py` 重新核验原版 36 份 Git blob，只改隔离副本。生成三份上游文件的 unified diff（角色保存、世界存档模型和新迁移）及修改清单；策略与世界恢复适配器另存为 `adapter.py`。原始副本运行前后保持哈希不变。

`run.py` 每次新建目录/SQLite，按进程读取，子进程限时 60 秒且不继承宿主凭证。使用上游真实地图、WorldEngine.tick、动作分发、事件队列、关系管理与 ORM。虚拟 11 秒间隔触发真实速率限制和 idle 检查，不等待五分钟，也不测墙钟性能。

验收比较：连续 30 tick 与运行 13 tick 后新进程续跑 17 tick；独立动作后的双方关系保存；未消费事件恢复；事件、关系、记忆各两条件，加对应输入屏蔽反证；存档中途与真实 SQL 写入失败回滚；损坏存档和混合角色资料拒绝载入。完整状态比较只排除事件时间戳，不排除随机状态、角色、关系、记忆、资源、事件或决策。

范围仅为串行完成步骤后的恢复。**不保证任意 tick 中途被杀、并发服务器、掉电、现有游戏数据库迁移或完整 Web/MCP 恢复。** 规则策略是人工编写的可执行假设，验证接口能承载闭环，不能证明认知智能、自然社会涌现、完整游戏或独立用户收益。

成功运行后 `latest.json` 才更新；失败目录与日志保留。归档与浏览器验证：

```powershell
node experiments/agent-world-adaptation/publish.mjs
node experiments/agent-world-adaptation/verify.mjs
```

发布脚本默认写入服务默认数据目录 `.data/technical-experiments`。如果服务使用自定义 `DATA_DIR`，发布时显式指定同一目录，例如：

```powershell
$env:PUBLISH_DATA_DIR = ".data/live-20261026"
node experiments/agent-world-adaptation/publish.mjs
```

发布完成后，服务的 `GET /api/v1/experiments` 应返回最新执行时间；产物接口还会重新校验 SHA-256。

也可以使用登记过的复现编排器执行完整的本地闭环：

```powershell
corepack pnpm experiment:agent-world
```

它只执行本目录固定的 `prepare.py`、`run.py` 和 `publish.mjs`，不会执行归档记录或 GitHub 仓库中的任意命令。执行前可用 `node experiments/agent-world-adaptation/reproduce.mjs --dry-run` 查看命令计划；失败会保留子进程输出和既有失败目录，不会把旧成功结果冒充为本次成功。

归档写入 4318 隔离实例的技术实测目录。验证脚本只读，检查下载哈希、需求页改造标识、导出、原版对照与手机布局，不调用模型或改写研究任务。
