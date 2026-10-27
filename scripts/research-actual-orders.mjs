// Real research operation: collect Actual #4616 and save one assistant decision.
// Requires the four researched repositories to have been collected already.
// Does not run Amazon extensions, read financial accounts, contact authors or call models.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { researchSources } from "../packages/contracts/dist/research.js";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4317";
const read = async (path) => { const r = await fetch(`${base}/api/v1${path}`); assert.equal(r.status, 200); return r.json(); };
const ids = ["486815039", "1200796004", "1219176154"];
const title = "Actual 订单分类：先验证现有后继工具，保留分批扣款这一关键未知点";
const before = await read("/projects"), beforeRuns = await read("/analysis/runs");
let actual = before.find((p) => p.id === ids[0]); assert.ok(actual);
const automaticNumbers = actual.issues.filter((issue) => !actual.issueContexts?.[String(issue.number)]?.selectedForResearch).map((issue) => issue.number);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [], writes = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/**", (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      writes.push(path);
      if (request.method() !== "POST" || ![`/api/v1/projects/${ids[0]}/issues/import`, "/api/v1/research-notes"].includes(path)) return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${base}/projects/${ids[0]}`);
  if (!actual.issueContexts?.["4616"]?.selectedForResearch) {
    await page.locator(".issue-collector > summary").click();
    const form = page.getByRole("form", { name: "补充指定讨论", exact: true });
    await form.getByLabel("补充的 Issue", { exact: true }).fill("https://github.com/actualbudget/actual/issues/4616");
    const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/projects/${ids[0]}/issues/import`));
    await form.getByRole("button", { name: "收录并核查讨论", exact: true }).click();
    const http = await response; assert.equal(http.status(), 200);
    assert.equal((await http.json()).selectedForResearch, true);
    await page.locator(".issue-collector").getByRole("status").waitFor();
  }
  actual = await read(`/projects/${ids[0]}`);
  assert.equal(actual.issues.filter((issue) => issue.number === 4616).length, 1);
  assert.ok(automaticNumbers.every((number) => actual.issues.some((issue) => issue.number === number)));
  const context = actual.issueContexts["4616"];
  assert.equal(context.issue.state, "closed"); assert.equal(context.commentsComplete, true); assert.equal(context.commentsError, null);
  assert.ok(context.comments.some((comment) => comment.isBot && comment.bodyExcerpt.includes("automatically closed")));
  await page.reload();
  const card = page.locator(".issue-card").filter({ has: page.locator("summary > span", { hasText: "#4616" }) });
  await card.locator(":scope > summary").click();
  await card.getByText("按需选择的讨论", { exact: false }).waitFor();
  mkdirSync(".data/browser", { recursive: true });
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".data/browser/actual-selected-issue-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".data/browser/actual-selected-issue-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await card.getByRole("link", { name: "围绕此问题研究组合", exact: false }).click();
  assert.equal(await page.getByLabel("研究问题起点", { exact: true }).inputValue(), `${ids[0]}:4616`);
  const projects = await Promise.all(ids.map((id) => read(`/projects/${id}`)));
  const sources = researchSources(projects);
  const evidence = [
    { kind: "issue", projectId: ids[0], issueNumber: 4616, quote: "We order a lot of things through Amazon - but the categorization is always manually done on the master transaction. This does not reflect reality: Many Amazon Orders hold Items from very different categories and are split into one or more payments, obfuscating what the real categorization of Amazon orders should be." },
    { kind: "comment", projectId: ids[0], issueNumber: 4616, commentId: 2957774340, quote: "Sadly it's not that simple as Amazon splits bank transactions from orders based on when they are shipped, so it needs some solid logic behind it." },
    { kind: "comment", projectId: ids[0], issueNumber: 4616, commentId: 2719095780, quote: "That means enhancement issues are automatically closed. This doesn’t mean we don’t accept feature requests, though!" },
    { kind: "readme", projectId: ids[1], quote: "This project has been superseded by https://github.com/rr4444/actual-ecommerce-noter" },
    { kind: "readme", projectId: ids[2], quote: "**Structural Split Transactions**: Converts multi-item Amazon orders into parent-child split transactions in your Actual Budget UI, pre-populated with exact item prices and individual notes." },
  ].map(({ quote, ...ref }) => {
    const source = sources.find((source) => Object.entries(ref).every(([key, value]) => source.ref[key] === value));
    assert.ok(source?.text.includes(quote), "Expected original quote is no longer available; reassess before saving");
    return { key: source.key, quote };
  });
  let saved = (await read("/research-notes")).find((note) => note.title === title && note.author === "assistant");
  if (!saved) {
    await page.getByLabel("研究组件 2", { exact: true }).selectOption(ids[1]);
    await page.getByLabel("研究组件 3", { exact: true }).selectOption(ids[2]);
    await page.locator(".research-note-editor > summary").click();
    const form = page.getByRole("form", { name: "保存研究判断", exact: true });
    await form.getByLabel("判断标题", { exact: true }).fill(title);
    await form.getByLabel("记录的研究问题", { exact: true }).fill("对于反复处理大量 Amazon 订单的 Actual 使用者，已有备注工具的后继实现能否正确关联商品、订单与分批银行扣款，再生成可复核的分类拆分？先核查已有能力和最可能失败的映射，不直接假定需要新产品。");
    await form.getByLabel("研究决定", { exact: true }).selectOption("continue");
    await form.getByLabel("判断记录者", { exact: true }).selectOption("assistant");
    await form.getByLabel("判断结论", { exact: true }).fill("这是比单库缺陷更具体的重复任务：作者陈述每年数百订单，另一评论强调按发货分批扣款使订单和银行流水不再一一对应。虽然 Issue 显示 closed/completed，Bot 原文说明功能请求会被自动关闭，不能据此宣称已实现。顺着讨论查到旧 actual-amazon-noter，并继续发现其 README 指向 actual-ecommerce-noter；后者已声称支持商品级父子拆分、CSV 预览和分类集成。因此先验证现有方案，暂不另做同类通用分类器。继续研究只针对分批扣款、同额候选和可复核映射这些边界；尚未运行后继工具，README 自述不等于能力已被本项目验证，更没有付费需求证据。");
    await form.getByLabel("判断下一步", { exact: true }).fill("先读后继项目匹配与拆分代码、实际 CSV 字段和现有 dry-run 输出。仅用公开或合成输入对照单笔订单、分批扣款、同额歧义和退款；不接真实金融账户、不执行写入。如果已有工具满足这些任务，直接采用并停止重复产品化；若失败，再判断是局部修复还是独立的复核工作流。不要在未获授权时登录 Amazon 或联系作者。");
    for (let i = 0; i < evidence.length; i++) {
      if (i) await form.getByRole("button", { name: "增加一条依据", exact: true }).click();
      await form.getByLabel(`判断来源 ${i + 1}`, { exact: true }).selectOption(evidence[i].key);
      await form.getByLabel(`判断引用 ${i + 1}`, { exact: true }).fill(evidence[i].quote);
    }
    const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/research-notes"));
    await form.getByRole("button", { name: "保存研究判断", exact: true }).click();
    const http = await response; assert.equal(http.status(), 201); saved = await http.json();
  }
  assert.equal(saved.author, "assistant"); assert.equal(saved.decision, "continue");
  assert.deepEqual(saved.evidenceStates, evidence.map(() => "same"));
  await page.goto(`${base}/`);
  const note = page.locator(`[data-note-id="${saved.id}"]`);
  await note.getByRole("heading", { name: title, exact: true }).waitFor();
  await note.scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".data/browser/actual-order-decision.png" });
  const exported = await page.request.get(`${base}/api/v1/research-notes/${saved.id}/report.md`);
  assert.equal(exported.status(), 200); assert.ok((await exported.text()).includes("Structural Split Transactions"));
  assert.deepEqual((await read("/analysis/runs")).map((run) => run.id), beforeRuns.map((run) => run.id));
  assert.deepEqual(errors, []);
  const result = { observedAt: new Date().toISOString(), issue: context, decision: saved, automaticNumbers, projectIds: ids, browser: "Edge", writes, pageErrors: errors, mobileOverflow: false, paidModelCalls: 0, limits: ["Assistant research pending human review", "No execution of the existing order tools or private financial inputs", "Public comments and README claims are not market validation"] };
  writeFileSync(".data/research/actual-order-decision-2026-10-20.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ decisionId: saved.id, selectedIssue: 4616, closed: context.issue.state, comments: context.comments.length, writes, errors, modelCalls: 0 }));
} finally { await browser.close(); }
