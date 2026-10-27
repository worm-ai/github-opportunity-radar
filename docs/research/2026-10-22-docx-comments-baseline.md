# DOCX 批注提取基线

2026-10-22。用一个最小 OOXML 对照样本验证 AnyDoc 是否区分 DOCX 批注文件与无批注文件。该实验只涉及公开软件和合成文档，不调用模型、不连接生产数据库，也不写入生产服务。

## 样本与复现

运行 `node experiments/docx-comments/run.mjs`。脚本固定生成两个文件：

| 文件 | SHA-256 | OOXML 真值 |
| --- | --- | --- |
| `with-comments.docx` | `1d3678067198b218027bc46f514c31156694616dfdc04d9ac0a67e1714c04679` | `word/comments.xml` 有一条作者 `Reviewer` 的批注 `Needs source.`，通过 `commentRangeStart` / `commentRangeEnd` 锚定到 `Annotated phrase.` |
| `without-comments.docx` | `1cbdc6ddb236338e8f92fb247c2253e41eadf20935827ecb00923a15822c6933` | 无批注 part 和关系；正文可见文本相同 |

脚本使用归档在 `.data/experiments/anydoc-cfb` 中的 `@firecrawl/anydoc@0.2.4`，显式按 DOCX 格式转换。另用现有 JSZip 对两个输入独立打开并检查文件清单、正文锚点和 comments part：正样本包含预期 part/anchor，负样本没有 part/anchor。两份输入都成功解析，输出都只有 `Reviewed sentence. Annotated phrase.`；批注正文和作者未出现在输出中，且两个输出逐字相同。结果 JSON、原始输出和合成输入保存在 `.data/experiments/docx-comments/`。

## 判断与反证

这次实测支持一个窄结论：该固定 AnyDoc 版本的该转换路径静默丢弃了此有效样本中的批注正文、作者和锚点信息。成功解析且无批注对照输出相同，降低了“整个 DOCX 未解析”的可能性。它与 AnyDoc #191 的报告一致，但不能证明当前版本、其他 DOCX 或生产工作流普遍如此。

对抗性检查：样本由脚本生成，尚未用 Word/LibreOffice 打开验证互操作性；一次合成样本不是代表性语料；文本被丢弃也不等同于用户有足够频繁或昂贵的实际损失。此实验没有用户访谈、任务频率、替代方案成本或付费意愿证据。

## GenOffice 状态与下一步

本节前一版记录的是损坏源码归档下的历史状态：当时没有运行 GenOffice。随后通过 GitHub API/ZIP 取得同一固定 commit 的完整源码，并在隔离副本安装依赖、构建 CLI、运行了完全相同的两个 DOCX。结果与详细命令、源码 Blob SHA、构建偏差和原始 JSON 见 [GenOffice DOCX 批注读取复核](./2026-10-22-genoffice-docx-comments-run.md)；正式技术实测归档在 `.data/technical-experiments/genoffice-docx-comments-20261022/`。

`docs read --comments --json` 对带批注样本返回 `Reviewer`、`Needs source.` 和 `Annotated phrase.` 锚点；无批注对照返回空数组，两个正文相同。这支持固定版本读取该最小 OOXML 样本的窄结论，但不是 Markdown 批注保全或组合适配器完成的证明。原样 CLI build 还暴露 `chart-workbook` 未导出问题；实验只在隔离副本补了导出映射，没有修改上游或本项目源代码。

下一步优先取得有权使用的真实含批注文档，或至少取得真实工作流的频率、耗时和替代成本，对比 AnyDoc 单独转换、GenOffice 单独转换和外置附录三条路径。若额外价值不清楚就停止组合方向；技术通过仍不能替代真实用户证据，机会继续保持 `marketStatus=unvalidated`。
