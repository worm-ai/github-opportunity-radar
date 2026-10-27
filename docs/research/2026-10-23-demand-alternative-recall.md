# 完整替代召回与补充比较失败记录

本轮改变的决定是：暂停继续修补 agent-world，先比较原研究遗漏的完整应用。此文件记录召回修正及模型比较失败的历史阶段。后续已完成 14 份固定源码的人工静态核查，决定先验证 Stanford 行为与恢复，AI Town 为交互备选，见[后续源码比较](2026-10-23-social-alternatives-source.md)。尚未推荐直接采用或组合，没有安装运行它们，也没有证明用户省时。

## 原研究为什么不足

原任务 `06fffe22-dc24-4182-bed7-1cc70f60e1c5` 的四条查询是 `social simulation`、`"AI agents" memory goals`、`"multi-agent" relationships simulation`、`agent simulation events interaction`。它们返回 20 个不同仓库预览，实际采集四个仓库，但 AI Town 和 Stanford Generative Agents 均未进入预览。后续实验虽然发现真实问题，不能据此说已经比较过最强完整替代。

通过现有产品的只读搜索接口实际查询 `generative agents` 和 `ai town`，分别返回 4,916 和 1,090 个匹配，目标仓库都在预览首位。匹配量不能证明适用性，也不能反推原查询本应命中。回执目录：`.data/experiments/demand-alternative-recall-2026-10-23T08-20-29-662Z/`。

## 规划修正及其反证

| 实验 | 实际查询要点 | 观察 | 边界 |
| --- | --- | --- | --- |
| v3 | `social simulation`、`life simulation`、`multi-agent generative agents`、`social simulation game` | 两个目标均遗漏，生活模拟查询引入无关粒子/生态项目 | 一次真实模型规划、四次真实搜索；失败保留 |
| v4 | `generative agents`、`AI Town`、`social simulation game`、`agent simulation relationships` | 两个目标均进入真实预览 | 一次真实模型规划、两次真实搜索、两条重用实际回执 |

通用规划提示要求先提出最强完整替代的名称假设，并使用最简领域原生术语；名称必须经过真实 GitHub 搜索，不能凭模型记忆直接收录。不硬编码这两个名字，不增加搜索及仓库预算。其余查询用于产品形态或实际缺口，避免把所有能力叠成 AND 条件。

脚本 `scripts/verify-demand-alternative-recall.mjs` 使用原任务的原始需求，不把这两个名称输入模型。它只调用规划阶段，筛选明确使用空桩，没有采集、评估或推荐，也不写产品任务和判断。v3/v4 回执分别在 `.data/experiments/demand-alternative-plan-2026-10-23T08-23-26-234Z/`、`.data/experiments/demand-alternative-plan-2026-10-23T08-25-45-020Z/`。两次均核对旧任务、判断未变。

对抗式审查：这是在已发现遗漏的同一个样例上调整提示，再执行一次；并非独立留出验证。只能证明这一次规划找回了两条线索，不能证明跨需求稳定、候选适用、运行有效或降低总成本。此阶段不要无理由重复调用模型。

## 两个完整应用的固定资料线索

另行读取完整 README 并按 Git blob SHA 校验，元数据与原文都保存于首次补搜回执目录。它们与产品后续采集的有界、未固定版本 README 是两批材料，不混为一种证据。

| 候选 | 固定提交与资料 | 可以支持的下一步 | 尚不能推出 |
| --- | --- | --- | --- |
| AI Town | [`8e05997f2409275669c8344b84a51692e83f3f33`](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/README.md)，README blob `b1d2df38de9800daaa555905bb33b63b78b0ac97`；元数据 MIT | 优先核查 JS/TS 可交互小镇、Convex 状态路径、模型与本地部署依赖 | 目标/关系/事件确实改变行为，重启恢复满足需求，本机已启动 |
| Stanford Generative Agents | [`fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/README.md)，README blob `2ee1ba3877bd8ba572024a2ea9fc96fd4a525a18`；元数据 Apache-2.0 | 核查研究模拟的记忆注入、计划、保存与回放路径，以及 Python/模型 API 依赖 | 研究环境可直接交付为游戏，旧 API 仍可用，运行成本可控 |

AI Town README 声明共享全局状态、事务、模拟引擎，提供 Convex、Ollama/远程模型、本地及 Docker 等路径。Stanford README 写明 Python 3.9.12 测试环境、模型密钥、三/二十五角色基线、记忆注入与保存模拟，同时提示 API 可能挂起、需要保存并重启，以及当时模拟可能较昂贵。均属作者资料，不是本机运行证明；当前费用和工时未知，分发时还需核查素材等依赖条款。

## 通过产品提交的补充研究

任务：[`86de1f5b-45a6-40d9-b01c-122a1d20bb36`](http://127.0.0.1:4318/research?run=86de1f5b-45a6-40d9-b01c-122a1d20bb36)。输入明确分开原始需求与助手手工找到的待核实项目名，要求先比较单项目采用或改造。使用旧运行服务，不是 v4 发布验收。

- 2026-10-23 08:27:29 UTC 开始；08:31:27 UTC 失败。
- 完成规划、筛选及 AI Town、Stanford Generative Agents、Microverse 三仓库采集。
- 评估阶段报“本机 Codex 调用超时；未调用 DeepSeek API”。没有保存评估、反方结论或推荐。
- 已知成功调用用量为规划 15,586 输入 / 1,281 输出、筛选 36,753 输入 / 1,343 输出 token；失败调用用量未知，不能把已知总量当作完整费用。
- 规划自行写出的候选限制未阻止筛选加入第三个仓库。它不是用户明确设置的候选白名单，也不是执行器已强制实施的范围控制。

`scripts/dogfood-social-alternatives.mjs` 经真实 Edge 表单只提交一次；首次提交后的探针断言受 `innerText` 换行规范化影响，已修正为比较规范化空白。服务任务并未因此重新创建。只读重开、刷新已通过，页面零错误、零写请求。浏览器回执：`.data/browser/social-alternatives/study.json`；终态快照及只读核对：`scripts/verify-social-alternatives-checkpoint.mjs`，产物位于 `.data/experiments/demand-alternative-follow-up-2026-10-23/`。

没有改写原研究或历史选型判断，没有把手工补搜当作产品原输入自动发现，也没有因模型超时切换到其他付费服务。初始研究评估阶段的保存材料续跑尚未实现，现有源码续研恢复不能替代它。下一步应先基于已采材料检查受控输入能否完成比较，不重搜全部候选或盲目延长超时。

## 构建、部署与当前决定

最终 v4：28 项需求分析及 12 项服务测试通过，分析构建、服务类型检查和构建通过。磁盘源码与产物为 `demand-research-v4`；运行中 4318 新任务仍为 `demand-research-v1`，未加载检索修正。此前自动审批拒绝 4318/4317 重启，本轮没有重试或等价绕过，也不把静态页面可读当作后端发布。

第一性原理判断：需求驱动研究方向值得继续，因为它能将采集与比较对齐到一个具体实现决定。当前应先解决候选遗漏和评估无法完成；继续加报告字段或修补原候选，不足以弥补这两个问题。

对抗式结论：本轮发现了会改变研究顺序的遗漏，修正一次规划，并诚实保存了全流程失败；尚未交付可执行的最终选型，也没有独立用户收益证据。目标保持进行中。
