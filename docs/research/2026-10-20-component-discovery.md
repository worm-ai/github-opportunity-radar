# 从具体问题寻找池外组件与替代方案

2026-10-20。定位以 [PRD](../PRD.md) 为锚点。本轮改进的是“发现障碍后，到哪里找真正缺失的能力”，没有把扩大项目池或新增组件当成商业机会。

## 判断与产品改动

原库 56 个项目、80 条 Issue 中有大量内部缺陷和维护方规划。把任意两项目配对再让模型写故事，缺少问题与干预之间的因果关系。前一轮允许绑定具体 Issue，但用户仍只能从已收录组件中选择；缺失能力可能根本不在这个小池子里。

研究表单新增 GitHub 组件搜索和按地址收录：

- 搜索输入明确的能力词或 GitHub 查询，默认相关性展示最多六个仓库；不套用新建窗口，可找到成熟替代方案。显示许可证未知、已归档与 Fork，不用 Star 代表可用性。
- 搜索只做预览，不读取 README/Issue，不写项目。点击收录后才读取单仓库元数据、README、Release 和有限 Issue，经 iii 与 World2Agent 保存档案及观察，随后选择第一个空组件位。
- 支持 owner/repository 和 HTTPS GitHub 仓库首页；请求固定发到 GitHub API，拒绝外部域名、凭证、额外端口和分支路径。请求与扫描、补证、分析互斥；失败释放任务槽，部分失败保留旧材料并显示警告。
- 搜索、收录和选中不调用模型，不写机会或市场验证，不改变扫描到期时间；原 Issue 起点保持。最多选三组件，满位后需显式移除。

实现没有增加数据库迁移，仍为 schema 8。相关 API、模块和限制已进入详细设计与运行配置文档。

## 真实研究：邮件合并需要的究竟是什么

起点为 [GenOffice #2097](https://github.com/genspark-ai/genoffice/issues/2097)。原始片段明确要求在 Docs Ribbon 中增加“邮件”选项卡，使普通用户不用手写域代码即可选择本地 xlsx/csv、图形化插字段、逐条预览，并输出合并文档。它明确排除邮件发送、远程数据库与通讯簿。作者关联为 NONE，旧样本未采集登录名，不能视为已核实客户或多个需求样本。

在真实 Edge 页面输入 `"mail merge" docx`：GitHub 返回 61 个匹配，展示六个，其中包括：

| 项目 | 搜索时可见的材料 | 对研究的作用 |
|---|---|---|
| Bouke/docx-mailmerge | Python、MIT、已归档 | 已有合并引擎与维护状态反例 |
| senny/sablon | Ruby、MIT、docx 模板与合并字段 | 现有引擎替代，不能直接补原生界面 |
| chrisfcarroll/MailMerge | C#、GPL-3.0 | 合并组件与许可边界线索 |
| mmonterroca/docxgo | Go、许可证未知 | 文档生成/模板替代，许可待核 |

这些是项目自述，没有运行验证；结果也不覆盖所有替代。预览前后项目数量未变，说明搜索没有暗中收录。

随后从实际表单粘贴 `https://github.com/gradio-app/gradio`，真实收录成功、无 warning，项目进入第二组件位，Issue #2097 保持选中，研究问题未自动填写或提交。原库由 56 增至 57 项目、80 增至 85 条 Issue、94 增至 95 条观察；渠道为“按需收录”。Gradio 的 Apache-2.0 是 API 返回的 SPDX 标识，未做完整法律审查。README 的 `gr.Interface(fn=..., inputs=..., outputs=...)` 说明了通用函数输入输出界面，不证明有 GenOffice 集成、Word 域编辑器或原生 Ribbon 插件。

因此将 Gradio 保留为界面研究候选，不写成组合推荐。其余搜索结果未收录。

## 固定源码核查与停止条件

从 GitHub 官方 Contents API 只读核对 GenOffice 提交 `1cb2925afe173b266c1545a3871a397429e11b7e`，保存路径、Blob SHA 和文本快照到 `.data/research/2026-10-20-mailmerge-source.json`：

- [CLI README](https://github.com/genspark-ai/genoffice/blob/1cb2925afe173b266c1545a3871a397429e11b7e/packages/cli/README.md)：`genoffice merge <template> --data <values> --out <file>` 从 JSON 对象填充 `{{key}}` 占位符；嵌套对象展开为 dotted keys，数组不会展开；返回 used/unused/unresolved 等结果，`--strict` 将未解决占位符变为错误。
- [CLI merge 实现](https://github.com/genspark-ai/genoffice/blob/1cb2925afe173b266c1545a3871a397429e11b7e/packages/cli/src/commands/merge.ts)：确认这一接口和数据读取路径，不能直接当作“CSV 多记录邮件合并”的完整契约。
- [docx-engine mail-merge](https://github.com/genspark-ai/genoffice/blob/1cb2925afe173b266c1545a3871a397429e11b7e/packages/docx-engine/src/mail-merge.ts)：存在 MERGEFIELD、记录、控制字段及块树合并相关导出，说明仓库已有另一层邮件合并能力，但没有在本轮运行或确认它对外的稳定调用与部署契约。

关键反证是：同叫 merge，CLI 的 JSON 模板填充与原生编辑器邮件合并不等价。给 CLI 增加 Gradio 界面，可能只改善文件选择和参数输入，尚不能完成图形插字段、编辑器内逐条预览或原生选项卡。

本轮停止在组合提案之前，没有新增付费调用。若继续这一方向，应先确认原生扩展入口、已有功能路线和用户是否接受外部界面；不能将“更容易提交 CLI 参数”改写为满足原 Issue。也可能只需 GenOffice 内部界面开发，第二组件并无必要。这是可复查的研究结论，尚不是需求或商业验证。

## 验证与运维

- 117 项测试通过，覆盖只预览不保存、单仓采集、非法地址、404/422/限流、私有仓库排除、部分失败保留旧证据、重复收录、任务冲突和无模型调用；包编译、服务端编译与 Web 类型检查、生产构建通过。
- 真实 iii + 临时 GitHub HTTP/SQLite 的 `verify-components.mjs` 通过 W2A 保存与失效输入校验。启用浏览器后，写请求拦截转到临时服务，验证收录后选择、起点保留、材料呈现、390px 无溢出；生产零测试写入、无页面错误。
- 原有真实 iii + 临时模型/库的完整 pipeline 再次通过浏览器研究提交、起点引用、失败 checkpoint、缓存与导出；旧生产 Edge 导航/下载/移动检查通过。替身结果不代表真实模型质量。
- 新测试直接传实例名称时曾在真实 Engine 被拒：同名 worker 仍注册到 default。适配器现显式传 SDK `namespace`，并使用同一名称作函数前缀，生产与临时实例已验证同时运行；不以静默本地模式绕过。
- 更新前备份 `.data/backups/opportunity-radar-2026-10-20T12-48-07-496Z.sqlite`，schema 8、完整性 `ok`。前端构建完成后重启；旧管理进程退出时会关闭其 Engine，首次重启遇到退出竞态，确认进程终止后正常启动，API/Engine 恢复，无运行中作业被打断。

真实研究结果为 `.data/research/2026-10-20-mailmerge-component-research.json`；截图为 `.data/browser/real-component-search-desktop.png` 和 `real-component-import-mobile.png`。该演练脚本会写真实 Gradio 档案，不作为只读回归。最近付费分析仍为 `66103e32-7f36-4b25-b012-706dc8c878f2`，最近扫描仍为 `234bea84-3a15-4a9d-9540-b7f658de0b5d`。

公开边界复查后，组件搜索附加 `is:public` 并过滤意外私有结果，按地址收录在读取详情前检查公开性。补充用例、全套 117 项测试和编译通过；收录后的第二份备份 `.data/backups/opportunity-radar-2026-10-20T12-59-43-986Z.sqlite` 完整性 `ok`。确认旧管理进程与 Engine 均已退出后重启成功；最终就绪接口 200、iii connected，真实公开搜索、隔离组件流程、真实材料与发现浏览器检查通过，57/85/95 计数与上述分析/扫描编号保持，无页面错误或移动溢出。

## 阶段复盘

当前可以从具体工作障碍出发，在产品内查到池外组件和已有方案，识别“能力重复”及“接口名字相同但含义不同”，从而决定停止一次没有充分依据的组合。未测量真实用户节省多少时间，没有访谈、试用或付费证据，不宣布目标完成。

下一阶段应验证问题起点的当前状态、已有方案与组件最小干预路径，再形成可以实际执行的组合假设。改进研究材料覆盖与可核查性优先于继续扩大 UI 或反复让模型生成更多方向。
