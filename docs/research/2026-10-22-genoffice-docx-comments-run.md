# GenOffice DOCX 批注读取复核

日期：2026-10-22

## 结论

使用与研究快照对应的 GenOffice 源码 commit `04f1457170394eda597f032cc6e0850e3d956847`，在隔离目录构建 CLI 并运行 `docs read --comments --json`。带批注 DOCX 返回一条批注，无批注对照返回空数组；两份文件的正文均被读取。结果支持“此固定版本的 DOCX 解析器能读取这份 OOXML 合成样本中的批注正文、作者和锚点”这一窄结论。

这不是 GenOffice 将批注转换为 Markdown 的验证。该命令输出结构化 JSON；还没有验证批注保全层如何嵌入下游 Markdown 工作流。它也不证明用户遇到该问题的频率、损失或付费意愿，因此机会的 `marketStatus` 仍应为 `unvalidated`。

## 固定输入与结果

输入与 [DOCX 批注基线](./2026-10-22-docx-comments-baseline.md) 相同：

| 文件 | SHA-256 | 预期 OOXML 批注 |
| --- | --- | --- |
| `with-comments.docx` | `1d3678067198b218027bc46f514c31156694616dfdc04d9ac0a67e1714c04679` | `Needs source.`，作者 `Reviewer`，锚点 `Annotated phrase.` |
| `without-comments.docx` | `1cbdc6ddb236338e8f92fb247c2253e41eadf20935827ecb00923a15822c6933` | 无批注 part、关系或锚点 |

GenOffice `@genoffice/cli@0.10.0` 的实际结果：

| 输入 | 正文 | `comments` |
| --- | --- | --- |
| 带批注 | `Reviewed sentence.Annotated phrase.` | `[{id: "0", author: "Reviewer", text: "Needs source.", blockIndex: 0, anchorText: "Annotated phrase.", done: false}]` |
| 无批注 | `Reviewed sentence.Annotated phrase.` | `[]` |

作为必要性反事实，同一 CLI 的 standalone `convert <file.docx> --to md` 也分别成功退出（0），但正、负样本都只输出 `Reviewed sentence.Annotated phrase.\n`，逐字相同，未包含 `Needs source.`、`Reviewer` 或锚点。这个固定版本的直接转换路径因此不能替代单独的批注读取。

复现命令：

```powershell
node packages/cli/dist/genoffice.cjs docs read <fixture.docx> --comments --json
```

CLI 分别以退出码 0 运行了正样本和负样本。正文在这个最小 fixture 中句间没有空格，这是样本文档自身的 run 拼接方式，不影响对批注 part 的判断。

## 构建来源与偏差

官方固定 commit 的完整源码 ZIP 已下载到隔离实验目录。`packages/cli/src/commands/docs.ts`、`packages/cli/src/formats/docx.ts`、`packages/docx-engine/src/index.ts`、`packages/docx-engine/src/notes.ts` 和 `packages/docx-engine/src/parse.ts` 的 Git blob SHA 均与该 commit 的 GitHub tree 相符。

原样运行 CLI build 时，esbuild 因 `packages/docx-engine/src/chart.ts` 引用 `@genoffice/pptx-engine/chart-workbook`，而该 commit 的 `packages/pptx-engine/package.json` 未导出此子路径而失败。为完成只读解析实验，仅在 `.data/experiments/genoffice-full/` 下的隔离源码副本增加了 `./chart-workbook` 导出映射；没有修改本项目或上游源文件。故本次证明的是解析器代码路径可运行，不是该 commit 可无修改地构建。

## 对抗性审查与后续

- 正负样本正文相同、解析均成功且批注数组不同，降低了“整份 DOCX 解码失败”的解释可能性。
- 样本由脚本合成，尚未在 Word 或 LibreOffice 往返打开；不能代表真实文档的复杂批注结构。
- 旧 AnyDoc `0.2.4` 对同一输入输出正文 Markdown，未输出批注；GenOffice CLI 则结构化读取批注。两者接口和任务不同，不能据此直接声称市场空缺或实现了 Markdown 批注导出。
- AnyDoc `#191` 在 2026-10-22 仍开放，但没有评论，开放状态不能证明当前版本普遍存在缺陷。
- GenOffice standalone `convert --to md` 的正负对照同样丢弃批注；这降低了“只需改用 GenOffice 转换命令”的替代解释，但仍不证明外置包装器值得付费。
- 下一项高价值验证是取得真实使用者的匿名化样本或有频率/耗时信息的工作流证据；在这之前不扩大工程实现，也不把 `candidate` 提升为已验证机会。
