# Stanford Generative Agents 源码续研

本记录对应隔离数据库 `.data/isolated-v6` 中续研任务 `76a36494-fd1c-411f-90f4-f9f7ce22e3f0`，父需求任务为 `cd24fcdd-8eb2-4f8e-92ff-ec0931856e9b`，原始失败研究为 `86de1f5b-45a6-40d9-b01c-122a1d20bb36`。本次只核查候选 `joonspk-research/generative_agents` 的 C1（角色身份/记忆/目标进入决策）、C3（共同事件到行动）和 C5（保存恢复）。

## 证据边界

- 固定提交：[`fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4`](https://github.com/joonspk-research/generative_agents/tree/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4)。GitHub blob 身份、行号及逐字引文由产品续研任务校验。
- 目录读取：递归 Tree 请求连续三次失败，回退的 12 次有界子目录遍历读到 133 个文件，`complete=false`。未列出路径不能用作能力不存在的证据。
- 源码读取：5 个文件共 47,447 字符；`plan.py` 只读 1-334/1054 行，`reverie.py` 只读 1-296/665 行。`persona.py`、`perceive.py`、`execute.py` 本次读取完整。
- 模型：源码选择和评估/反方审查使用 `codex/gpt-6.1-sol`，两阶段成功。此前同范围任务 `123b5537-a3ca-47ae-8031-beee90be3bbe` 已采到相同固定提交下的不完整目录清单，但 OpenCode 在选文件阶段失败、未读取源码；失败记录保留。
- 未安装或运行上游项目；没有复查 AI Town、许可证、本机启动依赖或费用；不构成游戏或独立用户价值验收。

## 已定位

### C1：记忆与决策

`persona.py` 将关联记忆接入 Persona，并提供 `perceive -> retrieve -> plan` 以及 `execute` 的调用链。`perceive.py` 将事件写入关联记忆，`persona.save` 调用关联记忆的保存接口。

关键引文：`persona.py` 220-222 行把感知结果传给检索、再把检索结果传给计划；`perceive.py` 175-177 行调用 `a_mem.add_event(...)`。但检索、Scratch、AssociativeMemory 的实际实现和 `plan.py` 后续 335-1054 行未读取。因此身份与目标是否真正改变计划和行动仍为未知，记忆进入 prompt 或被保存本身不构成闭环证据。

### C3：共同世界事件与行动

`reverie.py` 创建共享 Maze，并在初始化时把角色当前事件写入地图格；`perceive.py` 读取邻近且处于同 arena 的事件后受注意力带宽筛选。`persona.py` 把计划传入执行模块。执行模块读取路径并返回下一格。

关键反证：`execute.py` 第 91-99 行的无效地址分支可能在赋值前检查 `target_tiles` 长度；异常输入的结果需要运行验证。服务端主循环如何调用 Persona、应用执行输出以及事件是否触发重规划，本次未读全。因此不能宣称共同事件能持续改变世界行为。

### C5：保存与恢复

`reverie.py` 从存档元数据读取模拟步数并按该步加载环境文件；保存时写回步数、遍历角色调用保存接口。`persona.py` 从 bootstrap memory 路径构造 Scratch，并调用关联记忆保存。

仍未知：Scratch/关联记忆实际保存哪些字段，关系、计划和动态世界事件是否一同保存，保存命令是否接入用户可用入口，多份文件在中断或新进程恢复时是否一致。发现入口和函数不等于证明完整续跑。

## 结论与下一步

本次源码证据将“目标/记忆到决策”“事件到行动”“保存恢复”推进到局部实现可定位，但没有证实完整行为链。续研评估与反方审查均保留 `insufficient_evidence`、空路径、无推荐；尚不能改变原选型结论。AI Town 未在本次重读，不能由 Stanford 的局部证据推导两者排序或组合收益。

下一步固定同一提交并补读 `retrieve.py`、`scratch.py`、`associative_memory.py`、`maze.py`，以及 `plan.py` 和 `reverie.py` 未读部分。然后在三角色世界中分别改变目标、历史记忆和同区域事件，记录模型/规则决策输入、计划与实际位置；在移动或交谈期间保存并结束进程，恢复后比较模拟步数、角色位置、记忆、计划及动态事件。任何依赖未运行或来源无法复核的前提都要单列；行为差异或状态恢复一致性未通过时，对应能力不验收。

## 同提交补充续研与去重修正

补充续研 `09e8c398-a705-4691-b099-1adc72a5f287` 读入 `associative_memory.py`，确认事件、思考、聊天节点写入 `nodes.json` 并按节点类型重建；节点恢复时 `last_accessed` 设回 `created`。它是否改变后续检索排序仍未知。续研 `ce9fb637-f8d6-476d-9879-06d9de462d2d` 再次重复读取主文件，未补到 `retrieve.py` 或 Scratch。两次均为证据不足、无推荐。

发现选源输入不知道同一父需求下已完成的源码读取。产品修正为收集同父任务、同项目、同固定提交中成功读取的路径，将其交给选源并硬性拒绝重复。读取失败不计入去重，不同提交仍可重读。修正后的续研 `cd93b7f3-65e9-40aa-be80-dc20c2f3307a` 转而读取四个此前未读的文件，共 36,221 字符：

- [`converse.py`，第 145-150 行](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/converse.py#L145-L150)：对话路径将 `new_retrieve` 结果传入话语生成并加入局部会话列表；尚无模拟主循环调用或世界行为执行证据。
- [`retrieve.py`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/retrieve.py)：完整读取；对话消费 `new_retrieve`。系统同时存在 `retrieve` 与 `new_retrieve` 两个入口，主循环使用哪一条仍待确认。
- [`scratch.py`，第 203-213 行](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/memory_structures/scratch.py#L203-L213)：日程字段从 JSON 恢复；`act_start_time` 为空时会将 `curr_time` 设为 `None`。这是条件性静态风险，未用真实存档复现。
- [`spatial_memory.py`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/memory_structures/spatial_memory.py)：空间记忆树具备 JSON 读取和写入实现；主保存流程是否调用它仍未知。

本次模型选源、评估和反方审查均成功，结果仍为 `insufficient_evidence`、空路径、无推荐。目录清单不完整；`plan.py`、`reverie.py`、`scratch.py` 仍有字符边界截断。模型指出关联记忆 `last_accessed` 重置和 Scratch 时间清空分支，但二者仍只是静态风险。上游未安装或运行；没有执行三角色对照或独立用户价值测试。去重实现的 33 项分析/服务测试、类型检查和生产构建通过；随后重新运行全仓套件，42 个测试文件、437 项全部通过。

## 补读反思模块与计划提示

续研任务 `dd89ea88-9ae2-482d-a8e4-df2b74ff7563` 沿用父需求 `cd24fcdd-8eb2-4f8e-92ff-ec0931856e9b`，固定提交仍为 `fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4`。产品采集器目录请求成功后，模型选择未读的 `reflect.py` 和 `run_gpt_prompt.py`，共 20,562 字符；源码选择、评估和反方阶段均成功。`git clone` 直连失败，因此未创建或运行上游检出目录。

- `reflect.py` 130-132 行把反思输出交给 `persona.a_mem.add_thought(...)`。152-155 行以重要性计数和事件/思想序列是否非空决定触发反思。此处证明反思有记忆写入和触发条件，不证明世界事件改变后续行动。
- `run_gpt_prompt.py` 106-110 行把 `get_str_iss()`、`get_str_lifestyle()`、日期和名字加入日计划 prompt 输入。当前来源正文不够判断这些摘要是否包含目标/记忆；本次也没有计划调用者及计划到世界动作链。
- C1/C3/C5 评估仍保留大量 `not_read`/`unclear`，任务结果 `insufficient_evidence`、空路径、无推荐。主循环、角色调度、事件分派、保存命令入口和状态统一恢复均未验证；没有运行上游、三角色对照或独立用户价值测试。

本轮对抗检查发现，前次去重将成功读取路径一律记为已读，即使来源 `truncated=true`，因此 `plan.py`、`reverie.py`、`scratch.py` 的未读后半段无法重新选择。已修复服务端筛选：仅同项目、同提交、同路径且 `truncated === false` 的记录排除；截断或缺少完整性字段允许补读。回归测试同时验证完整路径排除和截断路径可再次读取。修正后的全仓测试为 42 个测试文件、438 项通过，类型检查与生产构建通过。此续研在旧服务进程内完成，没有使用新去重逻辑；后续真实验证应在隔离进程加载修正后补读长文件和主循环。

## 补齐主循环、保存命令并验证范围续读

发现仅允许重新选中截断路径不会推进覆盖，因为 GitHub blob 接口仍从首行返回。实现已扩展为固定提交行范围续读：历史源码快照按路径记录绝对起止行和完整性；选中未完整路径后，从第一个未覆盖行读取，保留 SHA 校验和绝对行号。已完整读取路径仍被排除，提交变化可从头读。

重载隔离实例后，任务 `782f163c-cb11-4b23-a2c6-ccec871b1bb4` 实际从已有前缀后续读四个区间：`plan.py` 335-575/1054、`scratch.py` 289-638/638、`reverie.py` 297-547/665、`run_gpt_prompt.py` 325-662/2931。Scratch 至此完整。第一次评估及第一次恢复均因模型对长源码行返回超过 700 字的引用而失败，失败快照保留。模型展示现在将超长单行缩为精确头尾片段并标出省略；对超长返回引用最多截取 700 字，再按原始文本和绝对行号核验。最终恢复任务 `872c3542-9d13-4831-987d-042a0ca56cd2` 复用 45,798 字符、无 GitHub 访问，单个 `source_assessment` 调用成功；旧失败任务 `782f...` 与两次失败恢复 `876e...`、`8740...` 均保留。

新增静态证据包括：

- `plan.py` 412-413 行的身份/计划摘要构造与 `new_retrieve`；489 行跨日身份修订后把 `daily_req` 自赋值，显示新身份与旧计划列表可能不同步；572-573 行行动项可被任务分解结果替换。仍未覆盖 persona 决策调用的全部区间，不能断言目标记忆已持续改变世界行为。
- `reverie.py` 349-350 行把角色当前事件写入共享地图；379-381 行主循环调用 `persona.move(...)` 获取下一位置；439、442 行保存命令进入 `self.save()`。地图事件是否被 move 内部实际感知并改变动作、保存函数到底落盘哪些状态、构造时如何恢复均未提供。
- `scratch.py` 289-638/638 行完成续读。`plan.py` 只覆盖至 575/1054，`reverie.py` 至 547/665，计划提示文件至 662/2931；完整读过的 Scratch 不代表其他状态容器完整恢复。

评估和反方阶段成功，但仍为 `insufficient_evidence`、空路径、无推荐。没有安装或运行 Stanford 上游，没有复查 AI Town，没有三角色目标/记忆/事件对照、跨进程重启实验或独立用户价值测试。全仓 42 个测试文件、440 项通过，类型检查与生产构建通过；Web chunk 551.88 KB 警告仍在。隔离服务已加载最新代码并保持 Codex + iii connected，使用 `.data/isolated-v6` 与 `radar-v6`。下一步补齐 `persona.move`、`save()` 与恢复入口的具体行段，判断是否值得做最小三角色运行实验；不得用继续写研究记录替代该实验。
