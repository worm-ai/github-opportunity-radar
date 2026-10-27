# agent-world 行为实验

从社会模拟需求研究继续验证候选实现。执行固定提交原版核心、真实地图、Django ORM 与 SQLite；不替换业务函数，不运行 Web/MCP 服务，不调用模型。输入角色、消息和随机种子均为合成测试材料。

```powershell
node experiments/agent-world-behavior/prepare.mjs
node experiments/agent-world-behavior/prepare-wheels.mjs
./.data/experiments/actual-ecommerce-noter/python/python.exe -I -B -X utf8 experiments/agent-world-behavior/install-runtime.py
```

依赖 wheel 固定版本并校验 PyPI SHA-256，将 wheel 解压至 `.data/experiments/agent-world-behavior/runtime/site-packages`。使用项目已有 Python 3.12.10 运行时，避免改写原实验的依赖。准备完成后执行：

```powershell
./.data/experiments/actual-ecommerce-noter/python/python.exe -I -B -X utf8 experiments/agent-world-behavior/run.py
node experiments/agent-world-behavior/publish.mjs
node experiments/agent-world-behavior/verify.mjs
```

准备脚本只从 GitHub 官方 API 与 PyPI 下载固定资料；GitHub 凭证仅用于准备进程。运行进程清空环境，遥测未配置，不访问上游公共服务。每次实验新建独立目录/数据库，子进程各限时 45 秒，输出 `latest.json` 指向最新完整成功记录。保留最初断言失败的记录：批量保存原本预期能恢复，实际报关闭数据库连接错误；未改上游代码使实验通过。

研究结论和证据边界见 [行为实验记录](../../docs/research/2026-10-23-agent-world-behavior.md)。`publish.mjs` 仅将完成实验归档至隔离实例数据目录，`verify.mjs` 只读核查 API 和真实 Edge 页面。
