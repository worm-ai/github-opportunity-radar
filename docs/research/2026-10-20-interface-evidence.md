# 2026-10-20 技术补证与 v4.1 真实复验

这轮完成了可使用的补证入口，但没有发现通过审查的商业机会，也没有发生用户访谈、试用或付费验证。

## 真实证据已经进入产品

项目详情可以单独采集同仓库技术文档。GenOffice 两份文档和 Map Design 两份文档已通过实际 iii `collect-evidence` 函数进入 W2A signal 和 SQLite，可从页面展开、刷新后查看。

| 项目与文档 | 采集内容的 Git Blob SHA |
| --- | --- |
| [GenOffice CLI](https://github.com/genspark-ai/genoffice/blob/HEAD/packages/cli/README.md) | `85b0c56caafb3f95887e0c8a12f7b2690c731963` |
| [GenOffice 图片操作](https://github.com/genspark-ai/genoffice/blob/HEAD/packages/pptx-ops/src/prompts/ops/insert.md) | `87804b4a29305e9ba8545a88e5c3ad3fb19ff2f7` |
| [Map Design 输入规范](https://github.com/ashishkaloge/map-design/blob/HEAD/skills/map-design/references/spec.md) | `8b2c6f5c31733a76eaebaa732b89d7411ac795ec` |
| [Map Design 底图参考](https://github.com/ashishkaloge/map-design/blob/HEAD/skills/map-design/references/basemaps.md) | `d95c84665eb5d9547260c27f6ea2037a53a76feb` |

以上链接随 HEAD 变化，SHA 对应采集时内容；产品保存原文摘录和各自采集时间，未冒充提交 permalink。首次自动发现将一般 reference 指南与 spec 同级排序，漏选输入规范；增加真实仓库结构的回归样本后，规范优先于通用参考指南，页面实际自动采集验证通过。

这使[首轮人工研究中的地图 → PPTX 线索](2026-10-20-first-research.md)具备产品内可核查的接口原文，仍未证明两组件在本机兼容，更未证明存在买家。没有安装或执行这些仓库的代码。

## 付费模型复验结果

| 项目 | 实际结果 |
| --- | --- |
| 运行编号 | `23c1005d-7248-4899-830d-793f67701d87` |
| 模型 / 提示 | `deepseek-v4-flash` / `deepseek-opportunities-v4.1` |
| 目录 / 深读 | 56 / 9 个项目，3 组 |
| 提案 / 保留 | 3 / 0 |
| 输入 / 输出 token | 79,193 / 6,240，供应商回执完整 |

模型选择的是审查工具 + 浏览器 + 行情 JSON、素材生成 + 图像编辑 + 视频工作区，以及三个编排器的组合。**没有选择 GenOffice 或 Map Design，因此这轮不能证明新增接口文档改善了组合研究质量。**

- 三个编排器的提案没有通过逐字引用、组件覆盖或 Issue 引用核验，程序未交给反方审查。
- 审查工具组合再次把静态 path:line、基准 CI 的问题转为浏览器行为复现，且行情数据没有相关组件分工，反方否决。OWNER Issue 的维护方属性在此次理由中被明确识别，仍不能用单次输出衡量作者上下文是否稳定有效。
- 素材组合缺少素材交换接口证据，把假定的跨应用交接问题写成既有工作障碍，反方否决。

原始产品导出见 [v4.1 研究简报](2026-10-20-v4.1-export.md)。程序硬条件保留；没有把零结果改写为成功商业发现。

## 对抗式审查与下一步

1. 补证解决“接口信息缺失”，不解决“目录选择总能注意到值得研究的方向”。本轮已直接观察到后一个缺口。
2. 让同一模型自由选择目录再审查，仍可能在不相关组合上消耗 token。同模型反方是过滤器，不是独立证实。
3. 旧 Issue 没有作者登录名时仍为未知；新采集会保留作者及关系。提示要求同作者不能作为多个独立样本，但当前没有程序层作者聚合或客户身份验证。
4. 下一步适合增加明确标为人工研究线索的定向深读：选定两个组件和具体待证伪问题，复用相同引用与反方门槛。这可以检验“选择遗漏”和“证据不足”分别在哪里，避免继续无差别重跑整个目录。
5. “地图图片 → PPTX”的下一项技术实验仍是公开数据的文件交接；用户工作、替代方案、许可原文与需求强度均需另查。技术连通不能替代需求验证。
