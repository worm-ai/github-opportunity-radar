# Pandoc CLI DOCX 批注对照运行

2026-10-22。此次运行补齐 `2026-10-22-pandoc-docx-comments-countercheck.md` 中尚未下载二进制、未运行 CLI 的部分。官方 Pandoc 3.12.1 Windows x86-64 发布包大小为 42,154,914 字节，SHA-256 为 `6ef431cb20b2c24a0371fc19200dc49d452be54b1b5c9239f3462841ef53e587`；下载脚本按 HTTPS 范围分块获取，并在散列一致后才写入归档。二进制在隔离数据目录运行，没有安装到系统。

## 固定运行

从仓库根目录运行：

```powershell
node experiments/docx-comments/run-pandoc.mjs
```

运行器记录了版本、输入 SHA-256、默认转换、`--track-changes=all`、`accept` 和 `reject` 的原始 Markdown 输出。输入包括同一脚本生成的正负 DOCX，以及 Pandoc 固定版本上游 `test/docx/comments.docx` 回归样本。完整结构化记录与逐模式输出保存在 `.data/experiments/pandoc-comments/`。

## 观察

- Pandoc 3.12.1 默认 GFM 转换会保留正文，但省略批注文本、作者和范围标记。
- 对合成正样本启用 `--track-changes=all` 后，输出包含批注文本 `Needs source.`、作者 `Reviewer`、批注 ID、起止范围及范围文本 `Annotated phrase.`，并通过 HTML `span` 属性表示。
- 同一可见正文的无批注负样本，在默认模式与 `all` 模式输出相同。
- 固定上游批注回归样本使用 `all` 模式也输出批注范围标记。该样本属于维护者测试资产，不是用户需求或生产语料。
- `accept` 和 `reject` 在这组仅含批注的正样本中与默认输出相同；本实验不据此推断它们处理修订标记的完整行为。

## 判断与边界

这直接削弱了“必须把 AnyDoc 正文转换与 GenOffice 批注读取组合，才可在技术上保留 DOCX 批注”的主张：一个现成 CLI 已能在固定样本上输出正文与批注范围。AnyDoc 0.2.4 的既有固定样本实验仍显示它单独转换时正负样本输出相同；GenOffice 单独的结构化读取仍可作为另一条路径。Pandoc 的 HTML span 是否适合目标 LLM、是否保留复杂真实文档的全部语义、是否比现有工作方式节省时间，都没有由本次运行回答。

因此这是一项技术替代证据，不是产品机会或市场验证。合成样本、上游回归资产及公开 Issue 都不能证明用户频率、现有返工成本、替代方案选择或付费意愿。在获得有权使用的真实任务与用户对照前，不应把这条线索升级为已验证需求，也不应仅凭此结果开始构建新转换器。
