# Stanford Generative Agents 状态恢复实验

日期：2026-10-24  
固定提交：`fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4`  
源码材料：`.data/experiments/stanford-state-20261024/vendor/`  
实验脚本：`scripts/verify-stanford-state-recovery.py`

## 目的

验证社会模拟候选是否至少具备可重复的跨进程状态保存与恢复能力。这里验证的是组件边界，不等同于完整社会模拟已经运行，也不代表用户价值或市场验证。

## 方法

探针从已通过 Git blob SHA-1 校验的 `scratch.py` 和 `associative_memory.py` 加载真实类代码。每个写入和读取步骤在独立 Python 进程中执行，使用隔离临时目录和最小构造状态。没有联网、没有修改上游源码、没有关闭 TLS 校验。

运行时：本机已有的 Python 3.12.7 隔离解释器。  
结果文件：`.data/experiments/stanford-state-20261024/recovery-probe/results.json`

## 结果

| 场景 | 写入 | 独立进程读取 | 观察 |
| --- | --- | --- | --- |
| 正常 `curr_time` 与 `act_start_time` | 成功 | 成功 | `curr_time`、`act_start_time`、行动地址、路径均保持一致 |
| `act_start_time = None` | 失败 | 可读取人工构造的空值 JSON | 保存在 `scratch.py:287` 抛出 `AttributeError: 'NoneType' object has no attribute 'strftime'`；加载空行动时间时，源码把 `curr_time` 错置为 `None` |
| 修改记忆节点 `last_accessed` 后保存 | 成功 | 成功 | 写入前为 `2026-10-24T12:34:56`，恢复后为创建时间 `2026-10-24T09:00:00` |

## 证据边界

- 正常状态的最小组件恢复已通过，但这不证明主循环、环境地图、路径执行、多人事件传播或依赖安装可运行。
- 空行动时间的保存失败和加载误清空当前时间是可复现的源码行为，不是模型推断。
- `last_accessed` 未被保存，恢复后检索排序可能改变；本实验没有把排序变化扩大解释成整体行为差异。
- 测试状态是合成的最小状态，不能证明真实角色数据或完整 bootstrap 文件不会触发其他问题。
- 当前没有 GitHub 在线搜索结果；本记录使用已保存且校验过的固定提交材料，不能声称完成了新鲜网络采集。

## 选型结论

Stanford 候选可作为“需要修复状态协议后再继续验证”的实验对象，暂不能作为可直接采用的完整方案。继续验证前至少要修复并补测：

1. 空 `act_start_time` 的保存与加载语义，并确保不会覆盖 `curr_time`。
2. `last_accessed` 的持久化，或明确恢复后检索排序可接受的重建规则。
3. 真实环境文件、依赖和至少三角色事件到行动的跨进程运行闭环。

在这些证据出现前，不生成“可直接采用”或“组合方案已验证”的推荐。

## 产品归档与回链验收

实验已归档至 [4318 隔离实例](http://127.0.0.1:4318/experiments#experiment-stanford-state-recovery-2026-10-24)，编号 `stanford-state-recovery-2026-10-24`；发布脚本为 `experiments/stanford-state-recovery/publish.mjs`。发布前重新核对五份源码的 Git blob、字节数与提交，逐项检查正常输出及三个反例，再生成带 SHA-256 的五份产物。探针和源码快照属于复现材料；上游源码没有修改，记录不使用“本地改造版”标识。

探针以本地文件存在检查替代 `global_methods`，直接加载两个记忆类。原始结果未保存运行时脚本哈希；归档中的复现脚本是发布时快照，不能追溯证明当时脚本逐字相同。发布时校验源码也不能代替完整运行时依赖核验。

执行 `node experiments/stanford-state-recovery/verify.mjs`，Edge 桌面及 390px 手机验收通过：需求页三个反例和下一步可见，完整实验页可跳转及刷新，五份 API 下载逐项哈希一致，并实际下载结果文件和研究补充包。Stanford 项目 ID 为 `669727723`；未关联仅含 agent-world 的研究任务。原失败研究仍失败，历史任务与研究判断未改变，无浏览器页面错误、API 写请求或横向溢出。回执在 `.data/browser/stanford-state-recovery/verification.json`。归档初版的项目 ID 和改造标识已纠正，最终验收以修正后记录为准。
