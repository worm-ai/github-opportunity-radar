# Agent 会话 → 权限回归：先核验数据保真

截至 2026-10-21，暂停把“通用聊天导出 + OpenAPPA”包装为可信权限回归产品。固定提取器对受控输入只能支持部分线性 Claude 会话；子任务、会话切换及 Codex 工具记录存在信息丢失。已经发生的工具调用也不能自动成为“应该允许”的断言。

这是技术组合的反证和代理研究判断，尚无真实使用者、节省时间或付费意愿验证。暂停这条直接组合，不是否定权限回归任务本身。

## 从什么任务出发

假设使用者维护 Agent 权限策略，希望修改策略后提前发现正常任务被阻断，或禁止的数据流被放行。要让这个任务成立，需要可关联的工具调用/结果、工具命名映射、任务及会话关系、对应版本的策略、独立确定的预期决策。

拟议分工是 ai-data-extractor 提供本地历史会话，OpenAPPA 执行策略重放。真正需要验证的是二者间信息是否足够，不能从“统一 JSONL”和“replay”两个名称直接推导可用。

## 本轮发现与筛除

经真实 iii 预览查询语音、安全、数据、视频四个方向，搜索范围是 2026-07-23 以后创建、至少 30 stars、非归档、非 fork；每方向最多六项，均未标为不完整。这是有界样本，不是整个 GitHub，也不证明新项目质量。

收录四项：speech.cpp、OpenAPPA、clarity、ai-data-extractor。clarity 自述已有语音练习、评分及 fallback，避免把“本地语音库 + 练习应用”当空白；speech.cpp 近期五条 Issue 均为 OWNER 规划，不能当外部需求。它们没有运行。原始查询与产品快照保存在 `.data/research/2026-10-21-cross-domain-discovery.json`、`2026-10-21-cross-domain-sources.json`、`2026-10-21-policy-session-sources.json`。

## 已有方案与旧问题的反证

- [OpenAPPA 固定提交](https://github.com/archestra-ai/OpenAPPA/tree/b9e2cee8bc8ddd79f8c75c4e850ee0b0d153f8af) 的 validation 文档已有脚本化 `appa replay`、CI、观察无断言调用、JSON 输出。通用重放器不是新缺口。
- [#592](https://github.com/archestra-ai/OpenAPPA/issues/592) 是外部作者对 OpenAPPA 0.30.0 / Claude Code 2.1.288 的会话重启故障陈述，当前 closed/completed。维护者“已复现、修复在路上”的评论既不是运行结果，也不能证明最新版本仍失败。
- [v0.32.0 变更日志固定提交](https://github.com/archestra-ai/OpenAPPA/blob/b2782543656c9cb5de6873c9afb3d165eed4ac6a/CHANGELOG.md) 记载 `keep a protected launch's family across session id changes`，关联 #602 / `9a5dbe351f67cbc54ea5ff6c66d98c45a2e00219`。这是该标签内的修复记载，未安装并复现其覆盖范围，不能以旧报告推导当前缺口。
- 最新 CHANGELOG 的前 8,000 字符没有包含这一旧条目。本轮利用已有指定版本补证功能读取 v0.32.0，保留每份文件自己的 ref / SHA；没有把最新 validation 文档错误标成旧版本，也没有扩建采集功能。
- `appa-runtime/src/recorder.rs` 记录 external consult 的结果与上下文，并非已经证实的全量 Agent 工具轨迹导出。不能因为文件叫 recorder 就认定替代了全部采集需求；这里只读源码，没有运行 recorder。
- replay 源码对允许的调用提交空成功输出；文档把真实集成测试与策略测试分开。这一模式可检查确定的契约，但无法自动重现任意历史工具结果、外部 annotator、批准和任务生命周期。

## 最小实验与结果

[实验说明](../../experiments/policy-session/README.md) 与 [运行代码](../../experiments/policy-session/run.py)。固定 ai-data-extractor 到 `df66cb083cf597edbedf49684f762581ce250f8e`；运行前核对四个原文件 Git Blob hash，保留 MIT 许可证。Python 3.12.10 / Windows，直接调用未修改的公开 `extract()`，仅传入实验生成的目录，不自动发现或读取本机真实会话。

| 受控输入 | 实际观察 | 对接口假设的判断 |
| --- | --- | --- |
| Claude 线性调用、失败、重试 | 三个调用 ID、参数、三个对应结果、失败布尔值及顺序保留 | 支持这部分格式的保真 |
| 同文件中 sessionId 从 before 变 after | 全部消息合成一个 conversation，session_id 只剩 after，消息无原 sessionId | 反驳保留切换关系 |
| 主会话和嵌套 subagents 文件 | 只返回主会话，保留 spawn-1，未读取 child-read | 反驳该布局下完整遍历 |
| Codex response_item 的 function_call / function_call_output | 两条文本保留，工具 ID、参数、失败输出均未保留 | 反驳该编码的工具保真 |
| Codex 父子 session_meta | 两个会话文本均返回，parent_thread_id 消失 | 反驳保留该元数据关系 |

这是五组**人工构造**的输入，不能声称覆盖实际客户端所有版本；同文件 sessionId 切换不是对 #592 的复现。没有运行 OpenAPPA、没有执行真实工具、没有验证安全决策。正对照用于确认提取器确实执行；四个反例用于否定“通用格式可直接无损连接”的宽泛假设，并非统计失败率。

原始结果、完整合成输入、标准化输出、原提取器及许可证、脚本快照、来源索引归档到工作台“技术实测”；每份产物按 SHA-256 校验。研究判断使用产品已采集的 Issue、文档与 README 逐字引用，技术结果在结论中明确指向实测档案。

## 何时重新打开

先取得一个明确维护权限策略的团队及其脱敏任务轨迹，比较原生 replay 手工用法、原生事件记录、直接读取固定版本日志三种办法。确定事件与工具命名映射、哪些字段无法恢复、预期决策由谁认可，以及已发布版本仍造成的重复劳动。

最小验收应同时包含应该允许、应该拒绝、失败工具、子任务及会话切换；未知或不可重建要明确拒绝生成可信断言。只有单项目修补不足、反复发生的工作与收益可测，才继续做双组件产品。当前没有这些证据，停止直接包装、保留可复核材料，不继续为这个案例扩建适配器。
