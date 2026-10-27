import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { experimentSchema } from "../../apps/server/dist/experiments.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const run = resolve(root, ".data/experiments/pandoc-comments");
const result = JSON.parse(readFileSync(resolve(run, "cli-comparison.json"), "utf8"));
assert.equal(result.pandoc.version, "pandoc 3.12.1");
assert.ok(Object.values(result.checks).every(Boolean));
const id = "pandoc-docx-comments-cli-20261022";
const target = resolve(root, ".data/technical-experiments", id);
const files = ["cli-comparison.json", "sources.json"];
const digest = (name) => createHash("sha256").update(readFileSync(resolve(run, name))).digest("hex");
const artifacts = files.map((name) => ({ name, label: name === "cli-comparison.json" ? "Pandoc 固定样本逐选项 CLI 输出" : "Pandoc 固定提交、上游 Blob 与 SHA-256 来源清单", sha256: digest(name) }));
const findings = `# Pandoc DOCX comment CLI comparison\n\nExecuted ${result.executedAt} with ${result.pandoc.version} on ${result.environment.platform}/${result.environment.arch}. Reproduce from the repository root with \`node experiments/docx-comments/run-pandoc.mjs\`. The runner records the fixture hashes and full stdout for each option in \`cli-comparison.json\`.\n\n- Default GFM output preserves document text but omits comment text, author, and range markers in the controlled positive fixture.\n- \`--track-changes=all\` preserves the comment text, author, ID, range, and anchored phrase in that fixture; the no-comment negative fixture is unchanged.\n- The upstream Pandoc regression fixture also emits comment-range spans under \`all\`.\n- \`accept\` and \`reject\` match default output on these comment-only fixtures; this does not establish behavior for tracked revisions.\n\nThis is narrow technical evidence. The controlled fixture is synthetic and the upstream fixture is a maintainer regression test. It does not establish general DOCX fidelity, suitability for an LLM workflow, user demand, time savings, or willingness to pay.\n`;
writeFileSync(resolve(run, "findings.md"), findings);
files.push("findings.md");
artifacts.push({ name: "findings.md", label: "CLI 对照结论、复现方法与证据边界", sha256: digest("findings.md") });
const record = experimentSchema.parse({
  id,
  title: "Pandoc DOCX 批注 CLI 固定样本对照",
  question: "固定版本 Pandoc CLI 能否在 GFM 输出中保留 DOCX 批注正文、作者与范围，同时在无批注对照中不引入标记？",
  conclusion: "Pandoc 3.12.1 默认 GFM 转换省略批注元数据；启用 --track-changes=all 后，合成正样本与上游回归样本均输出批注范围、作者及正文，无批注负样本保持不变。这证明固定样本上的可用替代路径，不能证明真实文档普遍保真或用户工作流价值。",
  executedAt: result.executedAt,
  environment: `Windows ${result.environment.arch}; Pandoc ${result.pandoc.version}; 官方发布包 SHA-256 ${result.pandoc.releaseSha256}`,
  inputOrigin: "一个脚本生成的合成正负 DOCX 对照，及 Pandoc 固定提交的公开维护者回归样本；输入逐个记录 SHA-256。",
  projectIds: ["1318187016", "1322012299"],
  sources: [
    { repository: "genspark-ai/genoffice", commit: "04f1457170394eda597f032cc6e0850e3d956847" },
    { repository: "firecrawl/anydoc", commit: "42bf1c5ecdde9eb0d96d6bd75a9e6698cf93b14c" },
    { repository: "jgm/pandoc", commit: "e51c9c6054c8f4ec5c3209d5abe10939dfe2963e" },
  ],
  checks: [
    { label: "批注正样本范围、正文与作者", observation: "--track-changes=all 输出 comment-start/comment-end、data-comment-id、data-author、Needs source. 和锚定文本 Annotated phrase.", outcome: "supported" },
    { label: "默认转换的批注丢失对照", observation: "默认 GFM 保留可见正文，但没有批注文本、作者和范围标记。", outcome: "supported" },
    { label: "无批注负样本", observation: "默认输出与 --track-changes=all 输出逐字一致。", outcome: "supported" },
    { label: "上游复杂回归样本", observation: "固定提交维护者样本在 all 模式输出范围标记，含跨段落和嵌套范围；未据此声称完整往返保真。", outcome: "supported" },
    { label: "真实用户工作流适用性", observation: "未用真实用户文档或目标工作流验证，无法判定 HTML span 是否适合后续 LLM。", outcome: "inconclusive" },
  ],
  limitations: result.limits,
  nextAction: "保持市场状态未验证；取得授权的真实任务与用户对照前，不构建新 DOCX 包装器。",
  artifacts,
});
const serialized = JSON.stringify(record, null, 2);
mkdirSync(target, { recursive: true });
const recordPath = resolve(target, "record.json");
if (existsSync(recordPath)) assert.equal(readFileSync(recordPath, "utf8"), serialized, "Refusing to overwrite a different archived experiment");
for (const name of files) copyFileSync(resolve(run, name), resolve(target, name));
writeFileSync(resolve(target, "record.json.tmp"), serialized);
renameSync(resolve(target, "record.json.tmp"), recordPath);
writeFileSync(resolve(run, "published.json"), JSON.stringify({ id, directory: target, executedAt: result.executedAt }, null, 2));
console.log(JSON.stringify({ id, artifacts: artifacts.length, projects: record.projectIds.length, sources: record.sources.length }));
