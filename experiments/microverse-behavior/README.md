# Microverse 原版行为检查

固定 `KsanaDock/Microverse@7a061d41ed67825496588e39ca37b0b2b7465fb2`，Windows / Godot 4.4.1。目的是核查实际 Office 场景中任务状态、记忆/关系的 prompt 输入，以及保存后新进程恢复；不是完整游戏或外部 LLM 验收。

从仓库根目录运行：

```powershell
node experiments/microverse-behavior/prepare.mjs
node experiments/microverse-behavior/run.mjs
node experiments/microverse-behavior/verify-run.mjs
```

准备脚本使用已有固定 GitHub 树 `.data/research/microverse-source/tree.json`（不可截断），下载固定源码归档，逐个核对 4,407 份 Git blob；下载官方 Godot 资源并核对官方 SHA-512。解包借用本机已有隔离 Python，路径见 prepare.mjs。没有这两项前置材料时需先恢复材料，不能绕过核验。运行数据放 `.data/experiments/microverse-behavior/`，不继承宿主 API 密钥或原有游戏配置。

首次导入包含四千余张图片，资源导入与行为检查分别设预算。导入未完成时应停止，不把缺失导入产物造成的加载失败当成项目功能反例。每次尝试独立目录，失败日志保留。后续运行复用 Godot 导入缓存；不是冷启动性能比较。

驱动只新增 `behavior_probe.gd`，不修改原版脚本、场景或资产。它实例化原版 Office、立即停止所有角色 AI 的初始与周期 Timer，调用原方法，注入清楚标记的合成任务、关系与事件记忆。记录 HTTPRequest 节点创建情况；没有节点不等同于系统级网络抓包。游戏默认启动单独检查，Office 显式加载不用于掩盖默认入口失败。

write/load 两个进程共享本次隔离 APPDATA：write 执行完成任务、占位任务操作和原版存档；load 重新实例化 Office 后读取同一存档。另直接调用原角色收集器，帮助区别角色分组问题和收集器问题。保留原版运行错误，即使保存方法返回成功也逐项核对文件与恢复状态。

verification 断言验证实验实际到达预定入口、任务容器对照、prompt 输入和未修改原文件；它不是产品功能全部通过的标志。完整玩家交互、外部 LLM 的行为变化、共同资源规则和长期模拟仍需单独验收。
