# 会话提取保真度实验

目的：先证伪“统一聊天导出可直接用于权限策略回归”的接口假设，避免用组件名称或 README 推导兼容。

固定上游 ai-data-extractor 提交 `df66cb083cf597edbedf49684f762581ce250f8e`。`run.py` 校验下载文件的 Git Blob hash 后运行原版 `extract()`，只传本实验生成的合成目录；不调用自动发现、不读取实际用户聊天、不发模型请求。

准备文件位于 `.data/research/policy-session/vendor/ai-data-extractor/`，清单为同目录上层的 `files.json`。`prepare.mjs` 从固定提交下载四个原文件并校验 Git Blob hash；仅依赖已编译的项目 GitHubClient。需要 Python 3.10+；本次复用此前实验的项目内 Python 3.12.10 embeddable runtime，未安装到系统。

```powershell
node experiments/policy-session/prepare.mjs
.\.data\experiments\actual-ecommerce-noter\python\python.exe -I -B experiments/policy-session/run.py
```

五组受控输入覆盖 Claude 线性工具链正对照、文件内会话切换、嵌套子代理、Codex `response_item` 工具记录、父子会话元数据。输入格式是人工构造，不能声称覆盖所有实际客户端版本，也不复现 OpenAPPA #592。结果及完整输入输出写入 `.data/research/policy-session/execution/`。

本实验没有运行 OpenAPPA、没有判断任何实际工具应允许还是拒绝。它只能说明固定提取器对这些输入的处理行为，不能证明安全性、节省时间或付费需求。
