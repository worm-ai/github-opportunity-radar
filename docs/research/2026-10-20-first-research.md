# 首轮可核查研究：自动分析的淘汰结果与人工补证

日期：2026-10-20。产品定位以 [PRD](../PRD.md) 为准。本报告保留自动运行事实，并记录人工补查；人工线索没有写入生产机会列表，也没有冒充自动分析产出。

## 1. 本轮结论

采集、iii 执行和真实 DeepSeek 调用已跑通；“更快发现值得投入的组合”仍需用户使用验证。最近 v4 分析浏览 56 个项目目录，深读 9 个，提出 3 个组合，全部被证据和反方条件淘汰，保留 0 个。零结果说明本轮未形成合格假设，不能推断市场没有机会。

下一步最值得补的是项目的实际输入输出契约和真实工作流程，而非增加模型调用次数。人工发现“地图 → 地区经营汇报”的技术线索，两个组件之间有明确的图片文件边界，但尚无客户需求或运行兼容性证据。

## 2. 真实运行记录

| 项目 | 实际结果 |
| --- | --- |
| 分析编号 | `cb7a352a-050d-4bee-ad05-88773a10a937` |
| 开始 / 结束（UTC） | `2026-10-20T10:07:43.600Z` / `2026-10-20T10:08:21.117Z` |
| 执行路径 | GitHub 官方 API → World2Agent 信号 → iii 函数 → DeepSeek |
| 模型 / 提示版本 | `deepseek-v4-flash` / `deepseek-opportunities-v4.0` |
| 目录 / 深读 / 提案 / 保留 | 56 / 9 / 3 / 0 |
| 输入 / 输出 token | 73,251 / 6,403；三阶段用量回执完整 |
| 实际数据库 | 56 个项目、80 条公开 Issue 样本 |

最近真实扫描为 `234bea84-3a15-4a9d-9540-b7f658de0b5d`：五个有限查询完成，命中 32 个仓库、31 条新信号、1 条判重；新信号数不等于新项目数。v4 这轮没有重复扫描。自动分析原始导出见 [运行简报快照](2026-10-20-v4-export.md)。供应商 token 回执不是费用账单。

## 3. 为什么三个自动组合都不成立

| 模型提出的组合 | 所引用的问题或能力 | 人工核对与反方结论 |
| --- | --- | --- |
| Agent-Reach + SiYuan + GenOffice，做引用溯源 | Agent-Reach 的依赖导入失败、CLI 子命令漂移 | [Issue 825](https://github.com/Panniantong/Agent-Reach/issues/825)、[823](https://github.com/Panniantong/Agent-Reach/issues/823) 不是文档引用溯源问题；没有 GenOffice 保存自定义引用键的证据。不能把命令修复包装成跨工具溯源需求。 |
| review + Playwright，做审查结论复现 | 未读取的 `path:line` 引用、同模型确认措辞 | [Issue 69](https://github.com/hamedghaderi/review/issues/69) 要求静态核对已读代码范围；[70](https://github.com/hamedghaderi/review/issues/70) 要求标明同模型及“未反驳”的含义。浏览器操作不解决这些故障，方案干预层与实际问题不对应。 |
| pi-harness + Prefect，做会话恢复与流程审计 | README 能力表及编排器介绍 | 没有外部事件流、检查点格式、重试幂等边界的具体证据。不能仅凭“恢复”“工作流”等相似词推断可无损对接。 |

目录选择还加入了 halo2 反编译项目作为“字节验证对照”。它没有形成工作流中的必需组件，属于选择阶段的牵强关联。全池浏览增加了覆盖，却尚未证明筛选准确率提高。

## 4. 人工线索：把地区数据变成每周经营汇报

假设用户：定期给客户或管理层制作地区表现汇报的小型咨询团队、渠道运营人员。假设任务：把已有地区数据制成带来源说明的地图，并放入可继续编辑文字和表格的 PPTX。付费者、频率、数据格式和当前耗时均未知。

分工与文件边界：

`用户 CSV → 地区编码/数值校验 → Map Design → 地图 PNG → GenOffice → PPTX`

地图以图片嵌入，地图内部形状和数值不因此变成 PowerPoint 原生可编辑对象。文字、表格的可编辑性与地图的可编辑性必须分开验收。

| 组件 | 原文支持的能力 | 本轮核验边界 |
| --- | --- | --- |
| [ashishkaloge/map-design](https://github.com/ashishkaloge/map-design) | `data` 接受 CSV/JSON 或行数组；`join` 支持州/国家等键；`value` 指定数值列；`size: wide` 为 1600×900；`source` 显示在页脚。README 说明可输出 HTML/SVG/PNG。 | 已读 README 与 spec 文档。没有运行渲染。地区编码、缺失值、图例是否会误导尚需测试。 |
| [genspark-ai/genoffice](https://github.com/genspark-ai/genoffice) | CLI 的 `create --type pptx --ops` 接受 JSON 操作；原文：`Image ops accept a local file path in their bytes field.` 操作文档列出 `addPicture`，形状为 `{bytes:base64\|dataURL,ext?,offset}`。 | CLI 文档额外说明本地路径转换，但尚未实测；完整 target/slide/offset 结构需按 CLI guide 获取，不能靠字段名编造。 |

两个项目的明确边界是图片文件，不需要假定跨项目共用内部数据结构。但“文档能描述对接”与“在当前 Windows 环境实际可跑”是两个结论。当前未安装 `genoffice`，未运行第三方代码；没有成功产物或性能数据。

可核查的关键 CLI 原文命令：

```text
genoffice guide slides addPicture
genoffice create --type pptx --ops deck.json --out deck.pptx
genoffice slides audit deck.pptx --slide 0 --json
genoffice slides render deck.pptx --out shots/
```

这些是下一步实验命令，尚未执行。`deck.json` 需由 guide 的实际 schema 构造，图片路径、slide target 和位置不可省略。渲染与部分命令依赖应用构建或安装包，不能假设只安装一个 npm 包就能工作。

### 两小时技术实验

实验只回答：“一份地区 CSV 能否稳定生成地图并嵌入 PPTX，且来源和数值可核对？”使用明确标为合成数据的三州 CSV，避免把演示数据误当市场证据。

1. 前 20 分钟：记录两个项目的 commit、版本、运行依赖和许可；若无法取得可运行 GenOffice，立即记为环境阻塞，不声称已完成。先检查脚本和依赖，再在单独实验目录运行。
2. 20～50 分钟：用 `state,value` 输入，包含零值和缺失地区，按 Map Design 文档渲染宽屏 PNG。核对地名映射、图例、Source 页脚；错误映射必须失败或明确提示，不能静默着色。
3. 50～90 分钟：通过 CLI guide 获取准确图片操作 schema，生成一页 PPTX；重新读取并渲染，确认图片、标题、来源可见，无拉伸和截断。地图本身保持图片属性。
4. 90～120 分钟：修改一行数据再次生成，保存输入、命令、stdout/exit code、图片和 PPTX；比较数值、来源及文件变化，记录从输入到产物的人工耗时和失败步骤。

技术通过标准：两次输入均产生可打开的 PPTX，正确显示对应地图；Source 未丢失，缺失地区未被误当零。出现静默错配、不可复现产物或无法解释的渲染差异则停止。即使通过，也只证明文件流程可用。

### 需求实验与反证

先用既有工具做基线：Excel 地图 + PowerPoint、Datawrapper 导出 + 幻灯片模板、现有 BI 截图或 PPTX 自动化库。只有实际重复工作存在且新流程减少了清洗、修图、复制或更新成本，组合才有产品意义。开源项目新颖本身不构成差异。

之后由用户授权招募有每周地区汇报任务的人，观察最近一次真实产物和完整流程。提问从“你上次怎么做、花多久、哪里返工”开始，不先推销组合。建议先观察 3 个独立团队：这是方向筛选样本，不能外推市场规模。

继续条件：至少两个团队重复遇到同一环节成本，愿意提供脱敏样例并试一次；在真实样例上比较总人工耗时、数值错误和修改次数。若只是偶发制图、现成模板已足够，或主要困难是数据治理/地理编码而非成品更新，则否决本方向或重新定义问题。目前没有招募、访谈、试用或付款记录。

许可仍需逐项核对：主仓库 MIT 不自动覆盖地图边界、字体、底图服务与第三方资源。内置矢量图与需要联网的城市海报/底图是不同运行路径。PNG 对接也不支持“整张地图原生可编辑”承诺。

## 5. 另一条更直接的问题线索及其边界

[GenOffice Issue 2097](https://github.com/genspark-ai/genoffice/issues/2097) 明确写道：

> Docs 已有 mail-merge engine 和 CLI merge，但普通用户需要手写 MERGEFIELD/占位符再跑 CLI，门槛较高。

它要的是 GUI 选 xlsx/csv、插字段、预览、批量输出 docx/标签，明确不发送邮件。采集时 `authorAssociation: NONE`，只是关系标签，不能据此认证为付费客户。当前 CLI 已有单 JSON 对象模板合并，数组不会展开；不能再包装成“缺少邮件合并引擎”。

这是工作流问题比抽象点子更具体的例子，但也是上游功能请求。Word/LibreOffice 等现有功能、上游很快实现以及独立交付价值过小都可能否定另做产品。无需为了满足“组合”而强行加入一个不必要的仓库。

## 6. 来源、可信度和下一步产品改进

以下为 GitHub API 只读取得的文件 blob SHA；采集时文本与 metadata 保存在本地 `.data/research/sources/`。URL 的 main 内容会变化，SHA 用于标识当时读到的文本，不代表执行版本已经锁定。

| 来源 | Blob SHA | 采集时间（UTC） |
| --- | --- | --- |
| [Map Design spec](https://github.com/ashishkaloge/map-design/blob/main/skills/map-design/references/spec.md) | `8b2c6f5c31733a76eaebaa732b89d7411ac795ec` | 2026-10-20T10:12:39.072Z |
| [GenOffice CLI](https://github.com/genspark-ai/genoffice/blob/main/packages/cli/README.md) | `85b0c56caafb3f95887e0c8a12f7b2690c731963` | 2026-10-20T10:12:39.691Z |
| [GenOffice 图片操作](https://github.com/genspark-ai/genoffice/blob/main/packages/pptx-ops/src/prompts/ops/insert.md) | `87804b4a29305e9ba8545a88e5c3ad3fb19ff2f7` | 2026-10-20T10:18:30.910Z |

review 的 Issues 69、70 为 `OWNER` 提出，应视为维护者路线图，不能当作多个独立客户反馈。自动分析当前没有把已采集的作者关系字段传给模型，也没有作者去重，需求规模判断尤其应谨慎。

本产品提案和反方调用同一个 DeepSeek 模型，共享来源，可能遗漏同一事实。通过只表示未被本轮否决，程序引用校验只确认文本确实存在。不能把分次请求称为独立证实。

下一阶段按收益排序：先对已选组合补充少量明确 CLI/API 文档并保存来源，再把作者关系和问题上下文纳入判断，最后用人工核验的小评估集比较“是否更快找到值得验证的工作流”。不要在未修复输入缺口时反复付费重跑，不应以候选数量作为成功指标。
