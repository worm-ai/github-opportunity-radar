# Pandoc DOCX 批注替代核查

2026-10-22。针对当时可见的 DOCX 批注机会“AnyDoc + GenOffice 保全 DOCX 批注”，核查成熟替代 Pandoc 是否已经处理同一类语义。初始轮只读 GitHub 公开仓库和固定提交的测试资产；后续已下载并校验官方二进制、执行固定 CLI 对照。没有调用模型、改写市场判断或向外发消息。

## 固定来源

- Pandoc release `3.12.1`，提交 `e51c9c6054c8f4ec5c3209d5abe10939dfe2963e`。
- 上游测试 `test/docx/comments.docx` 的 Blob SHA `9df74cf0a76852bcf6f14feded85e2dfb35b71d4`，下载后的 SHA-256 为 `b6df01371955a599f38ec1192d130ecd750a5d83363b7c3755adb0f15679a507`。
- 对应期望 AST `test/docx/comments.native` 与无批注对照 `test/docx/comments_no_comments.native` 均按 GitHub API 返回的 Blob SHA 校验后保存。材料和抓取脚本在 `.data/experiments/pandoc-comments/` 与 `experiments/docx-comments/fetch-pandoc.mjs`。

## 观察

固定版本的 `comments.native` 期望输出包含 `comment-start` / `comment-end` span，并保存 `comment-id`、作者、日期和批注范围文本；样本覆盖跨段落、跨行、嵌套批注等形态。Pandoc 手册同一版本的 `--track-changes=all` 说明也明确写着会纳入 insertions、deletions 和 comments。

这构成一个重要的技术反证：现有候选把“转换层丢失批注”视为必须由 AnyDoc 和 GenOffice 两个项目拼接解决，但至少存在一个成熟转换器，其文档模型已经表达批注语义。它还没有证明 Pandoc 输出的 Markdown 正好满足当前 LLM 工作流，也没有证明它能处理真实客户文档。

## 初始轮的运行边界与后续补测

初始轮因本机到 GitHub release-assets CDN 超时而未能运行 CLI；该状态已由后续实测补齐，不能再作为当前结论。Pandoc `3.12.1` 官方 Windows 发布包 SHA-256 为 `6ef431cb20b2c24a0371fc19200dc49d452be54b1b5c9239f3462841ef53e587`，并在隔离目录运行。固定样本的命令、输出、输入哈希和局限见[CLI 对照运行](./2026-10-22-pandoc-cli-docx-comments-run.md)，可复现实验已归档为 `.data/technical-experiments/pandoc-docx-comments-cli-20261022/`。

实测确认：默认 GFM 输出省略批注元数据；`--track-changes=all` 在合成正样本及上游回归样本中输出批注范围、作者和正文；无批注负样本与默认输出相同。这仍只是固定样本技术证据，不是用户需求或商业证据。

## 对抗性结论

- 这一反证降低了“两组件组合”作为独立机会的技术新颖性，但不能证明 AnyDoc、GenOffice 或 Pandoc 在所有真实 DOCX 上的输出等价。
- 真实合成样本、公开 Issue 和上游测试都不能提供使用频率、返工成本、替代方案切换成本或付费意愿。
- 在获得授权的真实文档或真实工作流耗时前，不实现新的 DOCX 包装器，也不把当前候选提升为已验证机会。下一步若继续，只做固定 Pandoc CLI 与 AnyDoc/GenOffice 的同一输入输出对照，并保留二进制可得性和安全边界。
