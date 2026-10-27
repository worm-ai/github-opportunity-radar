import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const data = resolve(root, ".data/experiments/pandoc-comments");
const binary = resolve(data, "runtime/pandoc-3.12.1/pandoc.exe");
const fixtures = [
  { name: "controlled-with-comments", path: resolve(root, ".data/experiments/docx-comments/with-comments.docx") },
  { name: "controlled-without-comments", path: resolve(root, ".data/experiments/docx-comments/without-comments.docx") },
  { name: "upstream-comments-regression", path: resolve(data, "test_docx_comments.docx") },
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (args) => {
  const result = spawnSync(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Pandoc exited ${result.status}: ${result.stderr}`);
  return result.stdout;
};

mkdirSync(data, { recursive: true });
const version = run(["--version"]).split(/\r?\n/, 1)[0];
assert.equal(version, "pandoc 3.12.1");
const outputs = {};
for (const fixture of fixtures) {
  const bytes = readFileSync(fixture.path);
  const inputHash = digest(bytes);
  const plain = run(["--from=docx", "--to=gfm", fixture.path]);
  const all = run(["--from=docx", "--to=gfm", "--track-changes=all", fixture.path]);
  const accept = run(["--from=docx", "--to=gfm", "--track-changes=accept", fixture.path]);
  const reject = run(["--from=docx", "--to=gfm", "--track-changes=reject", fixture.path]);
  writeFileSync(resolve(data, `${fixture.name}.default.md`), plain);
  writeFileSync(resolve(data, `${fixture.name}.all.md`), all);
  writeFileSync(resolve(data, `${fixture.name}.accept.md`), accept);
  writeFileSync(resolve(data, `${fixture.name}.reject.md`), reject);
  outputs[fixture.name] = { input: fixture.path.slice(root.length + 1), inputSha256: inputHash, default: plain, all, accept, reject };
}

const positive = outputs["controlled-with-comments"];
const negative = outputs["controlled-without-comments"];
assert.match(positive.all, /class="comment-start"/);
assert.match(positive.all, /data-author="Reviewer"/);
assert.match(positive.all, /Needs\s+source\./);
assert.match(positive.all, /Annotated phrase\./);
assert.doesNotMatch(positive.default, /Needs\s+source\.|Reviewer|comment-start/);
assert.equal(negative.all, negative.default);
assert.match(outputs["upstream-comments-regression"].all, /class="comment-start"/);

const result = {
  executedAt: new Date().toISOString(),
  environment: { platform: process.platform, arch: process.arch },
  pandoc: { version, releaseAsset: "pandoc-3.12.1-windows-x86_64.zip", releaseSha256: "6ef431cb20b2c24a0371fc19200dc49d452be54b1b5c9239f3462841ef53e587" },
  options: ["--from=docx --to=gfm", "--from=docx --to=gfm --track-changes=all", "--track-changes=accept", "--track-changes=reject"],
  checks: {
    positiveAllPreservesCommentTextAuthorAndRange: true,
    positiveDefaultOmitsCommentMetadata: true,
    negativeAllMatchesNegativeDefault: true,
    upstreamRegressionAllIncludesCommentRange: true,
  },
  fixtures: outputs,
  limits: [
    "The controlled DOCX files are synthetic; the upstream regression DOCX is a maintainer test asset.",
    "This proves CLI behavior for these inputs and options, not general DOCX fidelity or suitability in a user's LLM workflow.",
    "No user documents, workflow frequency, replacement cost, independent user selection, or willingness-to-pay evidence was collected.",
  ],
};
writeFileSync(resolve(data, "cli-comparison.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ executedAt: result.executedAt, version, checks: result.checks, fixtureHashes: Object.fromEntries(Object.entries(outputs).map(([name, value]) => [name, value.inputSha256])) }));
