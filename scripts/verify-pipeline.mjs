// Integration fixtures are isolated from the user's database and never call a paid model.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { RadarStore } from "../packages/storage/dist/index.js";
import { createDocumentationSignal, createRepositorySignal } from "../packages/contracts/dist/index.js";
import { root } from "./engine.mjs";

const directory = mkdtempSync(join(tmpdir(), "radar-e2e-"));
const store = new RadarStore(join(directory, "opportunity-radar.sqlite"));
const descriptions = ["Extract structured tables from PDF documents.", "Create editable spreadsheets from structured JSON."];
const document = { path: "docs/api.md", url: "https://github.com/fixture/component-0/blob/HEAD/docs/api.md", sha: "a".repeat(40), excerpt: "The CLI accepts a local PDF path and emits JSON tables.", observedAt: "2026-10-20T00:00:00Z" };
const issue = { id: 7, number: 7, title: "Need editable tables without manually copying every PDF row", bodyExcerpt: "Every week I copy supplier PDF table rows into a spreadsheet by hand.", url: "https://github.com/fixture/component-0/issues/7", state: "open", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z", comments: 0, reactions: 0, authorAssociation: "OWNER", authorLogin: "fixture-maintainer" };
for (let index = 0; index < 13; index++) {
  const repository = {
    id: index + 1, fullName: `fixture/component-${index}`, description: descriptions[index] ?? "Standalone model desktop client without document processing capabilities.",
    language: "TypeScript", license: "MIT", stars: 1, forks: 0, openIssues: 1,
    createdAt: "2026-10-01T00:00:00Z", pushedAt: "2026-10-10T00:00:00Z",
    url: `https://github.com/fixture/component-${index}`, readmeExcerpt: null, releaseTag: null, releaseUrl: null,
    raw: { id: index + 1 }, warning: null,
    issues: index === 0 ? [issue,
      { ...issue, id: 8, number: 8, url: issue.url.replace("/7", "/8"), bodyExcerpt: "x".repeat(2000), bodyTruncated: true },
      { ...issue, id: 9, number: 9, url: issue.url.replace("/7", "/9"), bodyExcerpt: "x".repeat(2000), bodyTruncated: false },
    ] : [], issuesFetchSucceeded: true, issuesFetchedAt: "2026-10-20T00:00:00Z",
  };
  store.saveRepository(repository, createRepositorySignal({ repositoryId: repository.id, ...repository }), 30, [], [], "2026-10-20T00:00:00Z");
}
const documentation = { documents: [document], attemptedPaths: [document.path], warnings: [], observedAt: document.observedAt };
store.saveDocumentation("1", documentation, createDocumentationSignal("1", "fixture/component-0", documentation));
store.close();

let calls = 0;
const profile = { targetUser: "隔离测试采购团队", recurringWork: "每周整理供应商 PDF 表格", constraints: "本地运行并保留核查记录" };
const focusA = { projectIds: ["1", "2"], question: "采购每周从 PDF 报价单整理电子表格，这两个组件能否减少复制与纠错时间？" };
const focusB = { ...focusA, question: "整理供应商 PDF 表格时，这两个组件能否减少生成可编辑工作簿的人工步骤？" };
const focusFailure = { ...focusA, question: "采购整理 PDF 报价时能否保留可复核的工作簿？本次模拟反方响应不完整。" };
const focusOrigin = { ...focusA, originIssue: { projectId: "1", issueNumber: 7 } };
const model = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  assert.equal(payload.model, "fixture-model");
  calls += 1;
  const task = JSON.parse(payload.messages[1].content).taskData;
  assert.deepEqual(task.researchProfile, calls <= 4 ? profile : null);
  if (calls === 2) {
    assert.equal(task.catalog.length, 13);
    assert.deepEqual(task.catalog.find((project) => project.id === "1").issues.map((sample) => sample.bodyTruncated), [null, true, true]);
  }
  if ([3, 5, 7, 9, 11].includes(calls)) {
    assert.equal(task.sources.length, 2);
    assert.equal(task.sources[0].documentation[0].sha, document.sha);
    assert.deepEqual(task.sources[0].issues.map((sample) => sample.bodyTruncated), [null, true, true]);
  }
  if (calls >= 5) {
    assert.ok(calls <= 12, "Cache hits must never make another model call");
    assert.deepEqual(task.researchFocus, calls <= 6 ? focusA : calls <= 8 ? focusB : calls <= 10 ? focusFailure : focusOrigin);
    assert.deepEqual(task.sources.map((source) => source.id).sort(), ["1", "2"]);
    assert.equal(task.catalog, undefined, "Directed research must not run catalog selection");
    assert.equal(payload.messages[0].content.includes(task.researchFocus.question), false);
  }
  const content = calls === 1 ? { groups: "malformed fixture" } : calls === 2 ? { groups: [{ projectIds: ["1", "2"], researchQuestion: "能否减少采购人员从 PDF 报价单复制表格的时间", reason: "文档提取和电子表格导出是不同能力，格式适配与用户需要仍待验证" }], skipped: [{ projectId: "3", reason: "同类桌面客户端没有提供文档处理互补能力" }] } : calls === 10 ? { reviews: [] } : [3, 5, 7, 9, 11].includes(calls) ? { candidates: [{
    title: "采购报价单到电子表格整理助手", targetUser: "每周整理供应商 PDF 报价单的采购人员", jobToBeDone: "提取报价单表格并生成可以复核和比较的工作簿",
    hypothesis: "用第一个组件提取表格，第二个生成工作簿，假设可以减少人工整理耗时，市场尚未验证。",
    projectIds: ["1", "2"], supportingEvidence: [{ projectId: "1", field: "documentation", documentPath: document.path, quote: document.excerpt }, { projectId: "2", field: "description", quote: descriptions[1] }],
    components: [{ projectId: "1", role: "提取 PDF 中的结构化表格", input: "采购提供的公开 PDF 报价单", output: "需要核查格式的结构化表格数据" }, { projectId: "2", role: "生成可编辑复核的电子工作簿", input: "经过适配的结构化 JSON 数据", output: "采购可以编辑核查的工作簿文件" }],
    integrationPlan: "核实两侧格式并制作 JSON 适配器，当前尚未实测", alternatives: "手工复制或现有表格转换工具，需用户访谈比较", whyNow: "两种独立组件出现了可组合的能力线索，仍属假设", firstExperiment: "用公开 PDF 跑一次提取和转换并记录纠错耗时", problemEvidence: calls === 11 ? [{ projectId: "1", issueNumber: 7, quote: issue.bodyExcerpt }] : [],
    uncertainties: ["两种组件的数据结构尚未进行兼容性测试"], validationSteps: ["请三位采购人员提供可公开报价样本并观察工作流程", "制作只读原型并对比现有工具和人工整理耗时"],
    successMetric: "两位用户愿意实际试用并提供下一批样本", failureMetric: "没有用户愿意试用或现有工具已足够好用",
  }] } : { reviews: [{ index: 0, verdict: "keep", reason: "技术分工明确但仍需实测接口兼容性和用户需求", risks: ["现有转换工具可能已满足需求，尚无访谈证据"], checks: { distinctRoles: true, evidenceSupportsRoles: true, plausibleIntegration: true, specificTestableProblem: true, claimsStayHypothetical: true, problemSignalsRelevant: true, profileFit: calls <= 4 ? "plausible" : "not_applicable" } }] };
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 30, completion_tokens: 40 } }));
});
await new Promise((done) => model.listen(0, "127.0.0.1", done));
const reservation = createServer();
await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
const appPort = reservation.address().port;
await new Promise((done) => reservation.close(done));
const base = `http://127.0.0.1:${appPort}/api/v1`;
let logs = "";
const child = spawn(process.execPath, [resolve(root, "apps/server/dist/index.js")], {
  cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, DATA_DIR: directory, APP_HOST: "127.0.0.1", APP_PORT: String(appPort), III_URL: process.env.III_URL || "ws://127.0.0.1:49134", III_NAMESPACE: `radar-pipeline-${process.pid}`, ANALYSIS_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "integration-fixture-only", DEEPSEEK_MODEL: "fixture-model", DEEPSEEK_BASE_URL: `http://127.0.0.1:${model.address().port}`, GITHUB_TOKEN: "", NODE_ENV: "production" },
});
for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { logs = `${logs}${data}`.slice(-4000); });
async function until(check) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error(`Test application exited: ${logs}`);
    const result = await check().catch(() => null);
    if (result) return result;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Integration check timed out: ${logs}`);
}

try {
  await until(async () => (await fetch(`${base}/health/ready`)).ok);
  const integration = await (await fetch(`${base}/integrations`)).json();
  assert.equal(integration.runtime, "iii");
  assert.equal(integration.analysis.state, "configured");
  const sampledProject = await (await fetch(base + "/projects/1")).json();
  assert.equal(sampledProject.issues[0].bodyTruncated, undefined);
  assert.equal(sampledProject.issues[1].bodyTruncated, true);
  assert.equal(sampledProject.issues[2].bodyTruncated, false);
  const settings = await (await fetch(`${base}/settings`)).json();
  assert.equal(settings.researchProfile, null);
  const putSettings = (body) => fetch(`${base}/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const savedProfile = await putSettings({ ...settings, researchProfile: profile });
  assert.equal(savedProfile.status, 200);
  assert.deepEqual((await savedProfile.json()).researchProfile, profile);
  const { researchProfile: omittedProfile, ...legacySettings } = settings;
  assert.deepEqual((await (await putSettings(legacySettings)).json()).researchProfile, profile, "An old client must preserve the existing profile");
  assert.equal((await putSettings({ ...settings, researchProfile: { ...profile, constraints: "x".repeat(401) } })).status, 400);
  assert.deepEqual((await (await fetch(`${base}/settings`)).json()).researchProfile, profile, "Rejected settings must not overwrite the profile");
  const invalidDocument = await fetch(`${base}/projects/1/documentation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paths: ["https://external.invalid/api.md"] }) });
  assert.equal(invalidDocument.status, 400);
  const failure = await fetch(`${base}/analysis`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(failure.status, 202);
  const failed = await until(async () => {
    const status = await (await fetch(`${base}/integrations`)).json();
    return !status.analysis.running && status.analysis.lastRun?.status === "failed" ? status : null;
  });
  assert.deepEqual(failed.analysis.lastRun.usage, { promptTokens: 30, completionTokens: 40, complete: true });
  assert.deepEqual(failed.analysis.lastRun.researchProfile, profile, "A failure before any checkpoint must retain the requested profile");
  assert.equal((await (await fetch(`${base}/opportunities`)).json()).length, 0, "A failed analysis must not save hypotheses");
  assert.ok((await (await fetch(`${base}/reports/latest.md`)).text()).includes("输入/输出 token：30/40"));
  const first = await fetch(`${base}/analysis`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(first.status, 202);
  const completed = await until(async () => {
    const status = await (await fetch(`${base}/integrations`)).json();
    if (status.analysis.lastRun?.status === "failed") throw new Error(status.analysis.lastRun.error);
    return !status.analysis.running && status.analysis.lastRun?.status === "succeeded" ? status : null;
  });
  const opportunities = await (await fetch(`${base}/opportunities`)).json();
  assert.deepEqual(completed.analysis.lastRun.usage, { promptTokens: 90, completionTokens: 120, complete: true });
  assert.equal(completed.analysis.lastRun.selection.catalogProjects, 13);
  assert.equal(completed.analysis.lastRun.analyzedProjects.length, 2);
  assert.equal(completed.analysis.lastRun.candidateAudits[0].proposal.firstExperiment.length > 0, true);
  assert.equal(completed.analysis.lastRun.candidateAudits[0].review.checks.specificTestableProblem, true);
  assert.equal(opportunities.length, 1);
  assert.match(opportunities[0].combinationKey, /^deepseek-/);
  assert.equal(opportunities[0].marketStatus, "unvalidated");
  assert.deepEqual(opportunities[0].researchProfile, profile);
  assert.deepEqual(completed.analysis.lastRun.researchProfile, profile);
  assert.equal(opportunities[0].supportingEvidence[0].url, document.url);
  assert.equal(opportunities[0].supportingEvidence[0].sourcePath, document.path);
  assert.equal(opportunities[0].supportingEvidence[0].sourceSha, document.sha);
  assert.equal(calls, 4);
  const second = await fetch(`${base}/analysis`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(second.status, 202);
  await until(async () => {
    const status = await (await fetch(`${base}/integrations`)).json();
    return !status.analysis.running && status.completedExecutions > completed.completedExecutions;
  });
  assert.equal(calls, 4, "Identical evidence must reuse cached results without further model requests");
  assert.equal(JSON.stringify(integration).includes("integration-fixture-only"), false);
  const report = await (await fetch(`${base}/reports/latest.md`)).text();
  assert.ok(report.includes(opportunities[0].title));
  assert.ok(report.includes("最初提案的实验建议"));
  assert.ok(report.includes(opportunities[0].firstExperiment));
  assert.ok(report.includes("目录筛选（模型推断）"));
  assert.ok(report.includes(document.path));
  assert.ok(report.includes(document.sha));
  assert.ok(report.includes(profile.recurringWork));
  const blankProfile = { targetUser: " ", recurringWork: "\n", constraints: "" };
  assert.equal((await (await putSettings({ ...settings, researchProfile: blankProfile })).json()).researchProfile, null);
  assert.deepEqual((await (await fetch(`${base}/opportunities/${opportunities[0].id}`)).json()).researchProfile, profile, "Changing settings must not rewrite an opportunity snapshot");
  assert.ok((await (await fetch(`${base}/analysis/runs/${completed.analysis.lastRun.id}/report.md`)).text()).includes(profile.recurringWork));
  assert.ok((await (await fetch(`${base}/opportunities/${opportunities[0].id}/report.md`)).text()).includes(profile.constraints));
  let profileBrowser = "not_requested";
  if (process.env.RADAR_TEST_BROWSER === "1") {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${appPort}/settings`);
      await page.locator("#profile-user").fill(profile.targetUser);
      await page.locator("#profile-work").fill(profile.recurringWork);
      await page.locator("#profile-constraints").fill(profile.constraints);
      const saved = page.waitForResponse((response) => response.url() === `${base}/settings` && response.request().method() === "PUT");
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      assert.deepEqual((await (await saved).json()).researchProfile, profile);
      await page.reload();
      await page.locator("#profile-user").waitFor();
      assert.equal(await page.locator("#profile-work").inputValue(), profile.recurringWork);
      await page.getByRole("button", { name: "清空研究画像", exact: true }).click();
      const cleared = page.waitForResponse((response) => response.url() === `${base}/settings` && response.request().method() === "PUT");
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      assert.equal((await (await cleared).json()).researchProfile, null);
      await page.reload();
      await page.locator("#profile-user").waitFor();
      assert.equal(await page.locator("#profile-work").inputValue(), "");
      await page.goto(`http://127.0.0.1:${appPort}/opportunities/${opportunities[0].id}`);
      const snapshot = page.getByRole("region", { name: "本次研究画像", exact: true });
      await snapshot.waitFor();
      assert.ok((await snapshot.innerText()).includes(profile.recurringWork));
      assert.ok((await snapshot.innerText()).includes("不证明需求或付费"));
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(calls, 4, "Editing a profile must not run an analysis");
      profileBrowser = "passed_in_temporary_database";
    } finally { await browser.close(); }
  }
  assert.equal((await (await putSettings({ ...settings, researchProfile: null })).json()).researchProfile, null);
  for (const focus of [{ ...focusA, projectIds: ["1", "1"] }, { ...focusA, projectIds: ["1", "unknown"] }, { ...focusA, question: "short" }, { ...focusOrigin, originIssue: { projectId: "1", issueNumber: 9999 } }, { ...focusOrigin, originIssue: { projectId: "3", issueNumber: 7 } }]) {
    const invalid = await fetch(`${base}/analysis`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ focus }) });
    assert.equal(invalid.status, 400);
  }
  assert.equal(calls, 4, "Invalid research requests must fail before calling the model");
  const submitResearch = async (focus) => {
    const previous = (await (await fetch(`${base}/integrations`)).json()).analysis.lastRun.id;
    const response = await fetch(`${base}/analysis`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ focus }) });
    assert.equal(response.status, 202);
    return until(async () => {
      const status = await (await fetch(`${base}/integrations`)).json();
      if (status.analysis.lastRun?.id === previous || status.analysis.running) return null;
      assert.equal(status.analysis.lastRun.status, "succeeded");
      return status.analysis.lastRun;
    });
  };
  const focusedA = await submitResearch(focusA);
  assert.equal(calls, 6, "Directed proposal and review require exactly two model requests");
  assert.deepEqual(focusedA.focus, focusA);
  assert.equal(focusedA.selection, null);
  assert.equal(focusedA.analyzedProjects.length, 2);
  assert.deepEqual(focusedA.usage, { promptTokens: 60, completionTokens: 80, complete: true });
  const focusedB = await submitResearch(focusB);
  assert.equal(calls, 8, "A different research question must not reuse another question's result");
  assert.deepEqual(focusedB.focus, focusB);
  assert.equal((await (await fetch(`${base}/opportunities`)).json()).length, 3, "Focused studies must preserve other scopes");
  const reused = await submitResearch(focusA);
  assert.equal(calls, 8);
  assert.equal(reused.reusedFrom, focusedA.id);
  assert.equal(reused.usage, null, "Cache reuse must not double count tokens");
  assert.deepEqual(reused.candidateAudits, focusedA.candidateAudits);
  const focusedReport = await (await fetch(`${base}/analysis/runs/${focusedA.id}/report.md`)).text();
  assert.ok(focusedReport.includes(focusA.question));
  assert.ok(focusedReport.includes("待证伪，不是需求证据"));
  assert.ok(focusedReport.includes('"specificTestableProblem": true'));
  assert.ok(focusedReport.includes('"firstExperiment":'));
  const reusedReport = await (await fetch(`${base}/analysis/runs/${reused.id}/report.md`)).text();
  assert.ok(reusedReport.includes("本次未调用模型"));
  const historicalReport = await (await fetch(`${base}/analysis/runs/${completed.analysis.lastRun.id}/report.md`)).text();
  assert.ok(historicalReport.includes("输入/输出 token：90/120"));
  assert.ok(historicalReport.includes("目录浏览：13 个项目"));
  assert.equal((await fetch(`${base}/analysis/runs/unknown/report.md`)).status, 404);
  let browserWrites = "not_requested";
  if (process.env.RADAR_TEST_BROWSER === "1") {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${appPort}/projects/1`);
      for (const [number, notice] of [[7, "未记录正文截断状态"], [8, "正文已截断，仅保留前 2,000 字符"], [9, "正文未截断"]]) {
        const card = page.locator("#issue-" + number);
        await card.locator("summary").first().click();
        assert.ok((await card.locator(".issue-body-notice").innerText()).includes(notice));
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Issue evidence must fit the mobile viewport");
      mkdirSync(resolve(root, ".data/browser"), { recursive: true });
      await page.screenshot({ path: resolve(root, ".data/browser/issue-body-integrity-isolated-mobile.png"), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      const panel = page.getByRole("region", { name: "补充技术文档" });
      await panel.locator(".documentation-card summary").click();
      assert.ok((await panel.innerText()).includes(document.sha));
      assert.ok((await panel.locator("pre").innerText()).includes(document.excerpt));
      await page.goto(`http://127.0.0.1:${appPort}/activity`);
      const latestRecord = page.locator(".analysis-record").filter({ hasText: "浏览 13 个项目目录" }).first();
      await latestRecord.locator("summary").first().click();
      assert.ok((await latestRecord.getByRole("region", { name: "目录选择依据" }).innerText()).includes("浏览 13 个项目目录"));
      const failedRecord = page.locator(".analysis-record").filter({ hasText: "分析未完成" }).first();
      await failedRecord.locator("summary").first().click();
      assert.ok((await failedRecord.locator(".context-note").filter({ hasText: "输入/输出 token" }).innerText()).includes("输入/输出 token：30/40"));
      await page.goto(`http://127.0.0.1:${appPort}/opportunities`);
      const researchForm = page.getByRole("region", { name: "定向研究", exact: true });
      await researchForm.getByLabel("研究组件 1", { exact: true }).selectOption("1");
      await researchForm.getByLabel("研究组件 2", { exact: true }).selectOption("2");
      await researchForm.getByLabel("待证伪的研究问题", { exact: true }).fill(focusA.question);
      await researchForm.getByRole("button", { name: "研究这个组合", exact: true }).click();
      await researchForm.getByText("定向研究已提交", { exact: false }).waitFor();
      const focusedRecord = researchForm.locator(".analysis-record");
      await focusedRecord.locator("summary").first().click();
      assert.ok((await focusedRecord.innerText()).includes("本次未调用模型"));
      assert.ok((await focusedRecord.innerText()).includes(focusA.question));
      const snapshot = focusedRecord.getByRole("region", { name: "候选与审查快照" });
      await snapshot.locator("summary").click();
      assert.ok((await snapshot.innerText()).includes('"firstExperiment":'));
      assert.ok((await snapshot.innerText()).includes("specificTestableProblem：通过"));
      assert.match(await focusedRecord.getByRole("link", { name: "导出本次研究" }).getAttribute("href"), /\/analysis\/runs\/.+\/report\.md$/);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Directed research form must fit a mobile screen");
      await page.setViewportSize({ width: 1280, height: 900 });
      assert.equal(calls, 8, "Submitting a cached question from the UI must not call the model");
      await page.goto(`http://127.0.0.1:${appPort}/opportunities/${opportunities[0].id}`);
      assert.ok((await page.locator(".evidence-item").first().innerText()).includes(document.sha));
      await page.getByRole("button", { name: "收藏假设", exact: true }).click();
      await page.getByRole("button", { name: "已收藏", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "已收藏", exact: true }).waitFor();
      await page.getByRole("button", { name: "开始验证", exact: true }).click();
      await page.getByLabel("验证方式", { exact: true }).selectOption("trial");
      await page.getByLabel("结果对假设的影响").selectOption("refutes");
      await page.getByLabel("记录任务对照数据").check();
      await page.getByLabel("任务描述（不要填写个人身份信息）").fill("从同一批公开材料中筛选需要继续核查的候选。");
      await page.getByLabel("基线方法").fill("逐条搜索并人工核对来源。");
      await page.getByLabel("使用后方法").fill("使用项目雷达筛选后仍需人工复核。");
      await page.getByLabel("参与任务数").fill("1");
      await page.getByLabel("外部结果记录").fill("仅为隔离数据库中的交互测试，没有真实访谈或试用，不可用作市场证据。");
      await page.getByRole("button", { name: "记录验证结果", exact: true }).click();
      await page.locator(".validation-record").waitFor();
      const recorded = await (await fetch(`${base}/opportunities/${opportunities[0].id}`)).json();
      assert.equal(recorded.validationRecord.outcome, "refutes");
      assert.equal(recorded.validationRecord.method, "trial");
      assert.equal(recorded.marketStatus, "evidence_recorded");
      assert.deepEqual(recorded.validationRecord.trialMeasurement, { taskDescription: "从同一批公开材料中筛选需要继续核查的候选。", baselineMethod: "逐条搜索并人工核对来源。", assistedMethod: "使用项目雷达筛选后仍需人工复核。", comparable: false, bothCompleted: false, timing: "unmeasured", tasksCompared: 1, baselineMinutes: null, assistedMinutes: null, falseKeeps: null, missedCandidates: null });
      assert.ok((await page.locator(".validation-record").innerText()).includes("反驳假设"));
      assert.ok((await page.locator(".validation-record").innerText()).includes("任务条件不可比，不计算耗时收益"));
      const opportunityReport = await (await fetch(`${base}/opportunities/${opportunities[0].id}/report.md`)).text();
      assert.ok(opportunityReport.includes("基线分钟：未记录"));
      assert.ok(opportunityReport.includes("误留：未记录"));
      await page.reload();
      await page.locator(".validation-record").waitFor();
      assert.ok((await page.locator(".validation-record").innerText()).includes("误留候选数：未记录"));
      await page.getByLabel("验证方式", { exact: true }).selectOption("trial");
      await page.getByLabel("记录任务对照数据").check();
      assert.equal(await page.getByLabel("误留候选数").inputValue(), "");
      await page.getByLabel("任务描述（不要填写个人身份信息）").fill("隔离测试：对同一批公开材料进行完整候选核对。");
      await page.getByLabel("基线方法").fill("隔离测试人工搜索。");
      await page.getByLabel("使用后方法").fill("隔离测试雷达筛选并复核。");
      await page.getByLabel("前后任务条件可比").check();
      await page.getByLabel("前后任务均已完成").check();
      await page.getByLabel("计时类型").selectOption("measured");
      await page.getByLabel("基线分钟").fill("20");
      await page.getByLabel("使用后分钟").fill("30");
      await page.getByLabel("误留候选数").fill("0");
      await page.getByLabel("外部结果记录").fill("仅为隔离测试的虚构计时，用后更慢；不是真实用户价值或市场证据。");
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Trial measurement form must fit a mobile screen");
      mkdirSync(resolve(root, ".data/browser"), { recursive: true });
      await page.locator(".validation-entry").screenshot({ path: resolve(root, ".data/browser/trial-measurement-isolated-mobile.png") });
      await page.getByRole("button", { name: "记录验证结果", exact: true }).click();
      await page.getByText("实测耗时增加 10 分钟", { exact: false }).waitFor();
      const measured = await (await fetch(`${base}/opportunities/${opportunities[0].id}`)).json();
      assert.equal(measured.validationRecords.length, 2);
      assert.equal(measured.validationRecord.trialMeasurement.falseKeeps, 0);
      assert.equal(measured.validationRecord.trialMeasurement.missedCandidates, null);
      await page.reload();
      await page.getByText("实测耗时增加 10 分钟", { exact: false }).waitFor();
      assert.ok((await page.locator(".validation-record").first().innerText()).includes("未记录"), "A later measured trial must preserve earlier missing data");
      const measuredReport = await (await fetch(`${base}/opportunities/${opportunities[0].id}/report.md`)).text();
      assert.ok(measuredReport.includes("实测耗时增加 10 分钟"));
      assert.ok(measuredReport.includes("误留：0；漏选：未记录"));
      assert.deepEqual(errors, []);
      browserWrites = "passed_in_temporary_database";
    } finally { await browser.close(); }
  }
  const brokenReview = await fetch(`${base}/analysis`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ focus: focusFailure }) });
  assert.equal(brokenReview.status, 202);
  const preserved = await until(async () => {
    const status = await (await fetch(`${base}/integrations`)).json();
    return !status.analysis.running && status.analysis.lastRun?.focus?.question === focusFailure.question && status.analysis.lastRun.status === "failed" ? status.analysis.lastRun : null;
  });
  assert.equal(calls, 10);
  assert.equal(preserved.candidateAudits[0].evidenceStatus, "passed");
  assert.equal(preserved.candidateAudits[0].review, null, "Incomplete review must not invent six passed checks");
  assert.ok(preserved.candidateAudits[0].proposal.firstExperiment.length > 0);
  assert.deepEqual(preserved.usage, { promptTokens: 60, completionTokens: 80, complete: true });
  assert.equal((await (await fetch(`${base}/opportunities`)).json()).length, 3, "A failed review must preserve every existing scope");
  const failedReport = await (await fetch(`${base}/analysis/runs/${preserved.id}/report.md`)).text();
  assert.ok(failedReport.includes('"firstExperiment":'));
  assert.ok(failedReport.includes("无有效审查快照"));
  const originRun = await submitResearch(focusOrigin);
  assert.equal(calls, 12, "Selecting an origin must not reuse a study with no selected issue");
  assert.deepEqual(originRun.focus, focusOrigin);
  assert.ok((await (await fetch(`${base}/analysis/runs/${originRun.id}/report.md`)).text()).includes("指定问题起点：项目 ID 1 #7"));
  const originReuse = await submitResearch(focusOrigin);
  assert.equal(calls, 12);
  assert.equal(originReuse.reusedFrom, originRun.id);
  let originBrowser = "not_requested";
  if (process.env.RADAR_TEST_BROWSER === "1") {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${appPort}/opportunities?project=1&project=2&issue=7`);
      const form = page.getByRole("region", { name: "定向研究", exact: true });
      await form.getByRole("article", { name: "选定的问题原文" }).waitFor();
      assert.ok((await form.getByRole("article", { name: "选定的问题原文" }).innerText()).includes("未记录正文截断状态"));
      assert.equal(await form.getByLabel("研究问题起点", { exact: true }).inputValue(), "1:7");
      await form.getByLabel("待证伪的研究问题", { exact: true }).fill(focusOrigin.question);
      const submitted = page.waitForRequest((request) => request.method() === "POST" && request.url() === `${base}/analysis`);
      await form.getByRole("button", { name: "研究这个组合", exact: true }).click();
      assert.deepEqual((await submitted).postDataJSON(), { focus: focusOrigin });
      await until(async () => {
        const status = await (await fetch(`${base}/integrations`)).json();
        // Cache lookup returns the latest successful run, which may itself be a reuse.
        return !status.analysis.running && status.analysis.lastRun?.id !== originReuse.id && status.analysis.lastRun?.reusedFrom === originReuse.id;
      });
      assert.equal(calls, 12, "Submitting an origin-bound cached study from the UI must not call the model");
      originBrowser = "passed_in_temporary_database";
    } finally { await browser.close(); }
  }
  const persistedStore = new RadarStore(join(directory, "opportunity-radar.sqlite"));
  assert.deepEqual(persistedStore.getAnalysisRun(originRun.id).focus, focusOrigin);
  assert.equal(persistedStore.getAnalysisResult(originRun.id).drafts[0].problemEvidence[0].quote, issue.bodyExcerpt);
  persistedStore.close();
  console.log(JSON.stringify({ realEngine: "passed", modelHttp: "fixture-only", researchProfile: "passed", profileBrowser, originIssueBinding: "passed", originPersistenceAndCache: "passed", originBrowser, failedUsagePersisted: "passed", failedReviewProposalPreserved: "passed", proposalAndReview: "passed", directedResearch: "passed", researchScopeIsolation: "passed", persistence: "passed", cacheAvoidsExtraCalls: "passed", historicalExport: "passed", secretRedaction: "passed", export: "passed", browserWrites }));
} finally {
  child.kill();
  if (child.exitCode === null) await new Promise((done) => child.once("exit", done));
  await new Promise((done) => model.close(done));
  const resolved = resolve(directory);
  if (!resolved.startsWith(`${resolve(tmpdir())}\\radar-e2e-`) && !resolved.startsWith(`${resolve(tmpdir())}/radar-e2e-`)) throw new Error("Unexpected test directory");
  rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
