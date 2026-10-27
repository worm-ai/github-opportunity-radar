// Publishes measured artifacts to the existing read-only technical experiment archive.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { experimentSchema } from "../../apps/server/dist/experiments.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
const run = resolve(root, ".data/experiments/anydoc-cfb");
const core = JSON.parse(readFileSync(resolve(run, "result.json"), "utf8"));
assert.ok(Object.values(core.checks).every((value) => value === true));
assert.equal(core.source.sha256, core.original.sha256);
assert.equal(core.patch.changedBytes, 512);
const id = `anydoc-cfb-${core.executedAt.replace(/[^0-9]/g, "")}`;
const target = resolve(root, process.env.DATA_DIR || ".data", "technical-experiments", id);
mkdirSync(target, { recursive: true });
const files = [["result.json", "原文件、通用重写与定点修正的真实输出及流哈希"], ["source.json", "公开样本来源、Git Blob SHA 与 SHA-256"], ["output.md", "仅固定样本修正后的两段转换文本"]];
const artifacts = files.map(([name, label]) => ({ name, label, sha256: createHash("sha256").update(readFileSync(resolve(run, name))).digest("hex") }));
const record = experimentSchema.parse({
  id, title: "TextEdit DOC → AnyDoc：通用 OLE 重写未能修复，固定样本定位成功",
  question: "能否用 CFB 的宽松读取与通用重写修复 AnyDoc #37，还是只需要处理底层容器的特定兼容性？",
  conclusion: "公开样本在 AnyDoc 0.2.4 重现失败。CFB 1.2.2 能读取它，但通用重写后仍被 AnyDoc 的 FAT 校验拒绝。仅将该样本未使用的 MiniFAT 表改为 FREESECT 后，得到预期两段文字，四个实际流字节一致。当前更支持定位和修复底层兼容性，停止将这条通用重写组合包装为产品。",
  executedAt: core.executedAt,
  environment: `${core.environment.platform}/${core.environment.arch}；Node ${core.environment.node}；@firecrawl/anydoc 0.2.4（Windows 原生包）与 cfb 1.2.2。包版本与 npm lockfile integrity 已核对；来源提交为 npm gitHead 声明，未验证源码可复现构建。`,
  inputOrigin: "AnyDoc #37 作者公开的 TextEdit 两段文字 DOC，19,456 字节；固定 Blob 6f1ec72a6697a7ca9f7abb59b36a94c0a48a8755，下载后校验 SHA-256。未使用私人邮件或客户文件。512 字节修正及非 OLE 负例由实验人工生成。",
  projectIds: ["1322012299", "12626004"],
  sources: core.packages.map(({ repository, commit }) => ({ repository, commit })),
  checks: [
    { label: "原报告可以复现", observation: `自动识别：${core.original.auto.code}；显式 doc：${core.original.explicit.message}。`, outcome: "supported" },
    { label: "宽松读取再通用重写就能恢复转换", observation: `CFB 可读出四个实际流，但重写后失败：${core.rewrite.explicit.message}。这个两库组合在该输入上未成立。`, outcome: "refuted" },
    { label: "固定样本的兼容性边界", observation: "四个流均为 4,096 字节，不引用 MiniFAT。仅修正未使用表中的 128 个条目后，自动和显式转换均输出 Alpha paragraph. 与 Beta paragraph.；流名、长度、SHA-256 相同。", outcome: "supported" },
    { label: "任意文件都能修复", observation: "脚本只接受固定输入哈希；没有建立一般修复器。非 OLE 负例仍被拒绝。未覆盖实际邮件格式分布、损坏文件、宏、签名或其他平台。", outcome: "inconclusive" },
    { label: "独立商业机会", observation: "原 Issue 与另一使用者评论提供工作流线索；没有客户访谈、规模统计、对照现有方案或付费证据。一次局部兼容性实验不能支持商业结论。", outcome: "inconclusive" },
  ],
  limitations: core.limits.map((value, index) => [
    "仅一个公开的两段文字样本，不代表真实邮件附件语料。",
    "修正被输入哈希限制，不能直接部署为文档修复策略。",
    "同一读取器下的流字节一致，不保证一般语义、版式、元数据或安全保真。",
    "包来源提交来自发布者的 npm gitHead，未核对源码构建与原生二进制一致性；没有测试未发布的 main 分支。",
    "没有调用模型或 hosted OCR，没有用户文件、访谈或付费意愿证据。",
  ][index] ?? value),
  nextAction: "停止通用 OLE 重写的产品化方向。若继续该具体问题，应先核对维护方修复并用有权使用的独立 TextEdit 样本检验兼容性；在证明单库修复不足、且有跨格式的重复任务之前，不增加编排或新转换平台。",
  artifacts,
});
const serialized = JSON.stringify(record, null, 2), recordPath = resolve(target, "record.json");
if (existsSync(recordPath)) assert.equal(readFileSync(recordPath, "utf8"), serialized, "Refusing to overwrite a different archived experiment");
for (const [name] of files) copyFileSync(resolve(run, name), resolve(target, name));
writeFileSync(resolve(target, "record.json.tmp"), serialized);
renameSync(resolve(target, "record.json.tmp"), recordPath);
writeFileSync(resolve(run, "published.json"), JSON.stringify({ id, directory: target, executedAt: core.executedAt }, null, 2));
console.log(JSON.stringify({ id, artifacts: artifacts.length, modelCalls: 0, directory: target }));
