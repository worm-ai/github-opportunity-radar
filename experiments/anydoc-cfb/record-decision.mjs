// Real product operation: save one assistant research decision through the UI.
// Only POST /research-notes is permitted. Re-running reuses the existing decision.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { researchSources } from "../../packages/contracts/dist/research.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4317";
const read = async (path) => { const r = await fetch(`${base}/api/v1${path}`); assert.equal(r.status, 200); return r.json(); };
const title = "AnyDoc：停止通用 OLE 重写方向，先修复容器兼容性";
const projectIds = ["1322012299", "12626004"];
const projects = await Promise.all(projectIds.map((id) => read(`/projects/${id}`)));
const beforeRuns = await read("/analysis/runs"), notes = await read("/research-notes");
const sources = researchSources(projects);
const evidence = [
  { kind: "issue", projectId: projectIds[0], issueNumber: 37, quote: "Word-authored `.doc` files convert fine, including this repo's fixtures. So this only matters where macOS-authored `.doc` uploads occur (in our pipeline: e-mail attachments written by TextEdit)." },
  { kind: "comment", projectId: projectIds[0], issueNumber: 37, commentId: 6273610265, quote: "For priority context: textutil/TextEdit-authored `.doc` files are a recurring share of the documents we convert, so we'd be glad to see this handled." },
  { kind: "readme", projectId: projectIds[1], quote: "`CFB.write(cfb, opts)` generates a file based on the container." },
].map(({ quote, ...ref }) => {
  const source = sources.find((source) => Object.entries(ref).every(([key, value]) => source.ref[key] === value));
  assert.ok(source?.text.includes(quote), "Every quotation must exist in the actual collected source");
  return { key: source.key, quote };
});
const question = "针对邮件附件中 TextEdit 生成的 DOC，宽松 OLE 读取后通用重写再交给 AnyDoc，是否能解决原报告的转换失败，值得作为独立组合产品继续？";
const conclusion = "已核查 #37 正文和评论：两位不同使用者描述了 TextEdit DOC 转换边界，其中一位说这类文件反复出现；这是工作流线索，未核实发生率或付费需求。本机固定公开样本实测中，AnyDoc 0.2.4 重现 unsupported/malformed MiniFAT；CFB 1.2.2 能读取但通用重写后仍因 FAT 验证失败。仅修正该样本未使用 MiniFAT 的 512 字节后得到预期两段文字，四个实际流字节一致。因此停止把“通用重写→转换”包装成产品。证据更支持底层兼容性修复；本次不能证明一般文档修复能力。成功和失败结果已归档在“技术实测”的 TextEdit DOC 实验中。";
const nextAction = "优先核对维护方的当前修复；若继续，只用有权处理的独立 TextEdit 样本检验单库修复，并记录原版本/新版本结果。只有证实存在跨格式的重复任务且单库修复不足，才重新考虑组合。未调用模型、未联系作者，也没有市场验证。";
let saved = notes.find((note) => note.title === title && note.author === "assistant");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [], writes = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      const path = new URL(request.url()).pathname; writes.push(path);
      if (!(request.method() === "POST" && path === "/api/v1/research-notes")) return route.abort();
    }
    return route.continue();
  });
  if (!saved) {
    await page.goto(`${base}/opportunities?project=${projectIds[0]}&project=${projectIds[1]}&issue=37`);
    await page.locator(".research-note-editor > summary").click();
    const form = page.getByRole("form", { name: "保存研究判断" });
    await form.getByLabel("判断标题", { exact: true }).fill(title);
    await form.getByLabel("记录的研究问题", { exact: true }).fill(question);
    await form.getByLabel("研究决定", { exact: true }).selectOption("stop");
    await form.getByLabel("判断记录者", { exact: true }).selectOption("assistant");
    await form.getByLabel("判断结论", { exact: true }).fill(conclusion);
    await form.getByLabel("判断下一步", { exact: true }).fill(nextAction);
    for (let i = 0; i < evidence.length; i++) {
      if (i) await form.getByRole("button", { name: "增加一条依据", exact: true }).click();
      await form.getByLabel(`判断来源 ${i + 1}`, { exact: true }).selectOption(evidence[i].key);
      await form.getByLabel(`判断引用 ${i + 1}`, { exact: true }).fill(evidence[i].quote);
    }
    const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/research-notes"));
    await form.getByRole("button", { name: "保存研究判断", exact: true }).click();
    const http = await response; assert.equal(http.status(), 201); saved = await http.json();
    await form.getByRole("status").waitFor();
  }
  assert.equal(saved.author, "assistant"); assert.equal(saved.decision, "stop");
  assert.deepEqual(saved.evidenceStates, ["same", "same", "same"]);
  await page.goto(`${base}/`);
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
  mkdirSync(resolve(root, ".data/browser"), { recursive: true });
  await page.screenshot({ path: resolve(root, ".data/browser/anydoc-research-decision.png"), fullPage: true });
  await page.goto(`${base}/experiments`);
  const published = JSON.parse(readFileSync(resolve(root, ".data/experiments/anydoc-cfb/published.json"), "utf8"));
  const archive = await read("/experiments"); assert.deepEqual(archive.warnings, []);
  const record = archive.records.find((record) => record.id === published.id); assert.ok(record);
  const article = page.locator(".experiment-record").filter({ has: page.getByRole("heading", { name: record.title, exact: true }) });
  await article.waitFor();
  assert.ok(await article.getByText("反驳 · 宽松读取再通用重写就能恢复转换", { exact: true }).isVisible());
  await article.locator("details > summary").click();
  for (const artifact of record.artifacts) {
    const r = await page.request.get(`${base}/api/v1/experiments/${published.id}/artifacts/${artifact.name}`);
    assert.equal(r.status(), 200);
    assert.equal(createHash("sha256").update(await r.body()).digest("hex"), artifact.sha256);
  }
  const artifact = record.artifacts.find((artifact) => artifact.name === "result.json");
  const download = page.waitForEvent("download");
  await article.getByRole("link", { name: artifact.label, exact: true }).click();
  await (await download).saveAs(resolve(root, ".data/browser/anydoc-result-downloaded.json"));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(root, ".data/browser/anydoc-experiment-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(root, ".data/browser/anydoc-experiment-mobile.png") });
  assert.deepEqual(errors, []);
  assert.deepEqual((await read("/analysis/runs")).map((run) => run.id), beforeRuns.map((run) => run.id));
  const output = { observedAt: new Date().toISOString(), decision: saved, experimentId: published.id, artifactsChecked: record.artifacts.length, browser: "Edge", mobileOverflow: false, pageErrors: errors, writes, modelCalls: 0, limits: ["Assistant research, pending human review; no market validation", "Only the fixed public sample was executed"] };
  writeFileSync(resolve(root, ".data/research/anydoc-decision-verification-2026-10-20.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ decisionId: saved.id, experimentId: published.id, artifactsChecked: output.artifactsChecked, errors, writes, modelCalls: 0 }));
} finally { await browser.close(); }
