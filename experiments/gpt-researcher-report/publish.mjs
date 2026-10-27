import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { experimentSchema } from "../../apps/server/dist/experiments.js";

const id = "gpt-researcher-report-failure-20261022";
const working = resolve(".data/experiments", id);
const target = resolve(".data/technical-experiments", id);
const result = JSON.parse(readFileSync(resolve(working, "result.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(working, "sources.json"), "utf8"));
const current = manifest.snapshots.find((item) => item.label === "current");
assert.equal(result.commit, current.commit);
assert.equal(result.mode, "unchanged_upstream_functions_with_dependency_stubs");
assert.equal(result.liveModelRequests, 0);
assert.equal(result.productionWrites, 0);
assert.equal(result.cases.length, 6);
const byName = new Map(result.cases.map((item) => [item.case, item]));
assert.equal(byName.get("both_connection_failures").returned, "");
assert.equal(byName.get("both_connection_failures").reportWrittenEvent, true);
assert.equal(byName.get("no_source_material").nonblankGate, "accepted");
const upstream = current.sources.map((source) => {
  const bytes = readFileSync(resolve(working, source.name));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
  return { ...source, content: bytes.toString("utf8") };
});
writeFileSync(resolve(working, "upstream-source.json"), JSON.stringify({ commit: current.commit, sources: upstream }, null, 2));
const command = ".data/experiments/actual-ecommerce-noter/python/python.exe -I -B -X utf8 experiments/gpt-researcher-report/run.py";
writeFileSync(resolve(working, "reproduction.json"), JSON.stringify({ command, files: ["prepare.mjs", "run.py", "publish.mjs", "README.md"].map((name) => ({ name, content: readFileSync(resolve("experiments/gpt-researcher-report", name), "utf8") })) }, null, 2));
const files = ["result.json", "sources.json", "upstream-source.json", "reproduction.json"];
const artifacts = files.map((name) => ({ name, label: name, sha256: createHash("sha256").update(readFileSync(resolve(working, name))).digest("hex") }));
const record = experimentSchema.parse({
  id, title: "GPT Researcher 报告失败：固定源码函数级隔离对照",
  question: "上游报告失败是否会被误记为成功，以及简单非空校验是否足以证明交付有效？",
  conclusion: "在固定上游函数和替身依赖下，两次连接异常后返回空串，writer 仍发出 report_written；空白与 None 也被记为写出。非空门槛拒绝这些结果，但会接受无资料时的非空拒答，也不能暴露被重试吞掉的首个编程异常。这支持先处理原库错误传播和输出状态；不证明独立周报交付产品的需求。",
  executedAt: new Date(result.executedAt).toISOString(),
  environment: "Windows; CPython " + result.python + "; AST 编译原函数；提示、提供商、研究上下文及事件传输为显式替身；没有安装运行完整上游依赖栈。",
  inputOrigin: "公开 GitHub 固定提交源码；研究上下文及六组成功/失败返回由实验脚本合成，无真实用户任务或文档。",
  projectIds: ["639835356"], sources: [{ repository: manifest.repository, commit: current.commit }],
  checks: [
    { label: "连接错误后的假成功事件", observation: "两次替身连接异常后原 generate_report 返回空串，原 writer 发出 report_written。", outcome: "supported" },
    { label: "空输出最低门槛", observation: "非空字符串门槛拒绝空串、纯空白与 None，同时保留正常非空输出。", outcome: "supported" },
    { label: "非空即有效交付", observation: "没有研究资料时，上游返回非空拒答且不调用提供商；简单门槛仍放行，不能据此判成功交付。", outcome: "refuted" },
    { label: "编程异常可见性", observation: "首个 TypeError 被原重试捕获，第二次非空输出通过门槛；不能证明根因得到修复。", outcome: "refuted" },
    { label: "当前与报告版本", observation: "采集时 main 与 Issue 指定提交相同；未穷尽其他分支、PR 或发行版本。", outcome: result.reportedAndCurrentCommitSame ? "supported" : "inconclusive" },
    { label: "真实使用价值", observation: "没有真实提供商调用、端到端用户研究任务、耗时对照或用户确认。", outcome: "inconclusive" },
  ],
  limitations: result.limitations,
  nextAction: "保持机会未验证。先检查完整库的错误传播与现有修复；只有授权真实任务仍暴露额外交付缺口时，再研究独立适配器。", artifacts,
});
const serialized = JSON.stringify(record, null, 2), recordPath = resolve(target, "record.json");
if (existsSync(recordPath)) assert.equal(readFileSync(recordPath, "utf8"), serialized, "Refusing to replace a different archived experiment");
mkdirSync(target, { recursive: true });
for (const name of files) copyFileSync(resolve(working, name), resolve(target, name));
writeFileSync(resolve(target, "record.json.tmp"), serialized);
renameSync(resolve(target, "record.json.tmp"), recordPath);
console.log(JSON.stringify({ id, artifacts: artifacts.length, commit: result.commit, productionDatabaseWrites: 0 }));
