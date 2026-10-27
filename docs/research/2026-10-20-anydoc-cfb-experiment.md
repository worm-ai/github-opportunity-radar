# 从新文档转换能力到一次可复现的停止判断

2026-10-20。换到数据处理方向，完成真实搜索、收录、讨论核查、隔离实验、产品内归档与阶段判断。本轮没有新增模型调用或市场验证，也没有修改产品架构、数据库版本或机会筛选门槛。

可在[技术实测](http://127.0.0.1:4317/experiments)查看结果，在[首页](http://127.0.0.1:4317/)查看新的代理研究判断。判断编号 `b3b293ab-9f10-4ec7-994f-da453c736d8a`；[固定判断导出](http://127.0.0.1:4317/api/v1/research-notes/b3b293ab-9f10-4ec7-994f-da453c736d8a/report.md)。

## 先找具体任务

通过现有产品、iii 的 GitHub 搜索预览执行四个查询：`csv reconciliation`、`pdf table extraction language:Python stars:>=50`、`csv created:>=2026-07-20 stars:>=10 archived:false` 和 `data reconciliation created:>=2026-01-01 archived:false`。每个查询最多六项，结果不是全站覆盖或推荐：里面有已归档转换器、已经实现对账的工具、练习仓库，以及名字包含 CSV 的游戏。

收录 [firecrawl/anydoc](https://github.com/firecrawl/anydoc)，再围绕它的具体失败收录 [SheetJS/js-cfb](https://github.com/SheetJS/js-cfb)。前者是新发现的多格式转换能力，后者作为已有 OLE 读取/写入组件及对照；没有要求两个都是新项目。收录经 iii/W2A 保存真实资料。GitHub 返回的许可证标识分别为 MIT 和 Apache-2.0，这不替代完整依赖或法律审查。

AnyDoc 的 README 已明确说明本地 PDF 边界、需要显式选择的 hosted OCR 和统一文档模型。补采 `node/README.md`、`bench/README.md`；后者已经列出 MarkItDown、Pandoc、Docling、Unstructured、Mammoth 和 LibreOffice 等替代。没有把维护方的 benchmark 自述作为独立质量证明。

## 核查后的问题强度

| 线索 | 实际核查与含义 |
| --- | --- |
| [#37](https://github.com/firecrawl/anydoc/issues/37) | 正文描述邮件附件中的 TextEdit DOC 转换失败，作者称低紧急度。另一位不同使用者的[评论](https://github.com/firecrawl/anydoc/issues/37#issuecomment-6273610265)称该类文件反复出现，并指出未使用 MiniFAT 填零的容器差异。核查时 open，只有一条评论且已完整读取；这些是工作流线索，不是规模或付费证明。 |
| [#191](https://github.com/firecrawl/anydoc/issues/191)、[#193](https://github.com/firecrawl/anydoc/issues/193) | 核查时均 open、无评论，分别报告 DOCX 审阅批注和符号丢失。两条由同一人提交，不能作为两个独立客户样本。本轮没有运行这两项复现，不能声称现版本已确认或已解决。 |
| #192、#200 | 只保留原有限采样；没有完整讨论核查。#200 作者明示未测试 CHM 样本，不能当实际失败。 |

## 固定版本和公开输入实验

[方法与脚本](../../experiments/anydoc-cfb/README.md)。使用 `@firecrawl/anydoc@0.2.4` 的 Windows 原生绑定与 `cfb@1.2.2`，核对 npm lockfile integrity。提交号来自 npm `gitHead` 声明，未验证原生二进制可由源码复现构建，也未测试未发布的 main。

输入是 #37 作者[公开的两段文字 DOC](https://github.com/H0rowitz/anydoc/blob/apple-doc-sample/issue-samples/textedit-minimal.doc)，19,456 字节。固定 Git Blob 为 `6f1ec72a6697a7ca9f7abb59b36a94c0a48a8755`，SHA-256 为 `fee05b029dc6ee2ce8cdc4388a03cd150fe7dff3eef9a013b387e996d9dcb8e6`。未使用私人邮件或用户文档，未选择 hosted OCR。

| 路径 | 实际结果 |
| --- | --- |
| 原文件 → AnyDoc 自动识别 | `unsupported input: unrecognized file content: name the format explicitly` |
| 原文件 → AnyDoc 显式 `doc` | `Malformed MiniFAT (mini sector 0 pointed to twice)` |
| CFB 宽松读取 → 通用重写 → AnyDoc 显式 `doc` | CFB 能读取，但产物仍失败：`Malformed FAT (FAT has 128 entries, but file has only 37 sectors)`。这条组合没有恢复转换。 |
| 仅修正固定样本未使用的 MiniFAT → AnyDoc | 自动与显式格式均成功，输出 `Alpha paragraph.`、`Beta paragraph.`。实际改变 512 字节；四个实际流的名字、长度与 SHA-256 一致。 |
| 非 OLE 负例 → AnyDoc | 仍被拒绝，没有把任意字节当成功文档。 |

修正仅对固定输入哈希开放，并检查四个流均至少 4,096 字节、不需要 MiniFAT。它用于定位边界，不是可部署的一般修复器。同一读取器下流字节一致也不证明所有语义、版式、签名、元数据或安全属性保真。

实测编号 `anydoc-cfb-20261020141556612`；产品归档中保留真实结果 JSON、来源 JSON 和转换文本，共三份按 SHA-256 校验的产物。公开或修改后的 DOC 没有作为可下载产物再分发。

## 判断与对抗审查

第一性原则是判断两个组件是否真正干预同一个实际障碍，而不是因为能串联就生成机会。本次“宽松 OLE 通用重写再转换”的假设被公开样本反驳；样本的定点修正则支持底层容器兼容性解释。因此保存了**停止这条通用重写产品方向**的判断，author=assistant，待人工复核。

这不否定所有文档摄取机会。最强反对意见是：单库修复可以定位当前问题，但没有回答其他团队是否反复遇到跨格式问题。当前缺少独立语料、任务频率、现有替代方案对照和用户观察，既不能宣布存在商业机会，也不能宣布整个领域无价值。后续只有出现单库修复无法满足的重复工作任务，才重新研究更大的组合；不要继续围绕这一个已定位的样本堆功能。

## 操作成本与验收

这次完整研究使用了四次搜索、两次收录、三次讨论核查和一次成功文档补证；一次包含不支持的 `Cargo.toml` 路径的补证请求被拒绝，改用两份受支持的文档后成功。公开二进制样本下载、npm 版本核对和实验仍由研究者在产品外完成，再由现有归档入口展示；没有为这个单案例添加通用执行器。

Edge 实际表单保存第三条代理判断，首页可见；三份产物通过 HTTP 下载与哈希核验，结果 JSON 的浏览器下载成功；手机视口无横向溢出，未发现页面错误。再次打开复用已有判断，没有重复写入。实验脚本实际运行和四个脚本语法检查通过。没有产品源代码或依赖变更，因此本轮没有声称重新通过全量测试或重新部署。

当前 schema 10、integrity ok：60 项目、95 Issue 样本、98 项目观察、3 条研究判断、2 份技术实验。旧扫描 `234bea84-3a15-4a9d-9540-b7f658de0b5d` 和旧分析 `66103e32-7f36-4b25-b012-706dc8c878f2` 保留，无新付费分析、机会或市场验证。GitHub 认证请求成功，core 配额为每小时 5,000 次；iii 连接正常。

数据库备份 `.data/backups/opportunity-radar-2026-10-20T14-18-33-497Z.sqlite`，schema 10/integrity ok。文件归档另备份为 `.data/backups/technical-experiments-2026-10-20T14-19.zip`，逐文件核对 13 个文件哈希一致；这两类备份需一起保留。实验输入、依赖和原始运行目录仍在 `.data/experiments/anydoc-cfb`，复现方式见脚本说明。
