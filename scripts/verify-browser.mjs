import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { explainAnalysisOutcome } from "../packages/contracts/dist/analysis-outcome.js";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4317";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
const writes = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && request.url().startsWith(`${base}/api/`)) writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
mkdirSync(".data/browser", { recursive: true });
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "项目雷达", exact: true }).waitFor();
  await page.locator(".repo-name").first().waitFor();
  assert.equal(await page.locator("header").getByRole("link", { name: "开始需求研究" }).getAttribute("href"), "/research");
  const researchFirst = page.locator(".research-first-start");
  await researchFirst.waitFor();
  assert.match(await researchFirst.innerText(), /先说清楚要实现什么/);
  assert.equal(await researchFirst.getByRole("link", { name: /开始需求研究/ }).getAttribute("href"), "/research");
  const completedResearchLink = researchFirst.getByRole("link", { name: /查看已完成研究/ });
  if (await completedResearchLink.count()) {
    assert.match(await completedResearchLink.getAttribute("href"), /^\/research\?run=/);
    await completedResearchLink.click();
    await page.waitForURL(/\/research\?run=/);
    await page.getByRole("heading", { name: "需求研究", exact: true }).waitFor();
    await page.goBack();
    await page.getByRole("heading", { name: "项目雷达", exact: true }).waitFor();
  }
  await researchFirst.getByRole("link", { name: /开始需求研究/ }).click();
  await page.waitForURL(/\/research$/);
  await page.goBack();
  await page.getByRole("heading", { name: "项目雷达", exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "research-first entry must fit mobile");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: ".data/browser/radar-desktop.png", fullPage: true });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "导出研究简报" }).click();
  const download = await downloadPromise;
  await download.saveAs(".data/browser/research-export.md");
  await page.goto(`${base}/projects`);
  await page.locator(".repo-name").first().waitFor();
  await page.getByRole("combobox", { name: "项目排序" }).selectOption("issues");
  await page.getByRole("checkbox", { name: "有公开 Issue 样本" }).check();
  const sampledProjects = await page.locator(".repo-name").count();
  if (sampledProjects) {
    await page.locator(".repo-name").first().click();
    await page.locator(".issue-card").first().waitFor();
    await page.locator(".issue-card summary").first().click();
    assert.ok(await page.locator(".issue-card p").first().isVisible());
    assert.match(await page.locator(".issue-card .issue-body-notice").first().innerText(), /正文已截断|正文未截断|未记录正文截断状态/);
    assert.match(await page.locator(".issue-card a").first().getAttribute("href"), /^https:\/\/github\.com\/.+\/issues\/\d+$/);
    await page.screenshot({ path: ".data/browser/project-evidence.png", fullPage: true });
  }
  await page.goto(`${base}/opportunities`);
  await page.getByRole("heading", { name: "机会假设", exact: true }).waitFor();
  const sourceProjects = await (await page.request.get(base + "/api/v1/projects")).json();
  const integrityProject = sourceProjects.find((project) => project.fullName === "assafelovic/gpt-researcher");
  const checkedIssue = integrityProject?.issueContexts?.["2218"]?.issue;
  if (checkedIssue) {
    await page.goto(base + "/projects/" + integrityProject.id);
    const card = page.locator("#issue-2218");
    await card.locator("summary").first().click();
    assert.match(await card.locator(".issue-body-notice").innerText(), /正文已截断|正文未截断|未记录正文截断状态/);
    await card.locator(".issue-current-body summary").click();
    assert.equal(await card.locator(".issue-current-body pre").innerText(), checkedIssue.bodyExcerpt);
    const boundary = await card.locator(".issue-context-body-notice").innerText();
    assert.ok(boundary.includes(checkedIssue.bodyTruncated === true ? "正文已截断，仅保留前 " + checkedIssue.bodyExcerpt.length.toLocaleString("en-US") + " 字符" : checkedIssue.bodyTruncated === false ? "正文未截断" : "未记录正文截断状态"));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Checked Issue body must fit mobile");
    await card.screenshot({ path: ".data/browser/gpt-researcher-issue-integrity-mobile.png" });
    await page.setViewportSize({ width: 1440, height: 1050 });
    console.log(JSON.stringify({ checkedIssueBody: "passed", issueNumber: 2218, visibleLength: checkedIssue.bodyExcerpt.length, bodyTruncated: checkedIssue.bodyTruncated }));
    await page.goto(base + "/opportunities");
    await page.getByRole("heading", { name: "机会假设", exact: true }).waitFor();
  }
  const analyses = await (await page.request.get(`${base}/api/v1/analysis/runs`)).json();
  const opportunityRecords = await (await page.request.get(`${base}/api/v1/opportunities`)).json();
  const researchRecords = await (await page.request.get(`${base}/api/v1/research-notes`)).json();
  await page.locator(".opportunity-list .opportunity-row, .opportunity-list .empty-state").first().waitFor();
  const hasExactResearch = opportunityRecords.some((item) => researchRecords.some((note) => !note.supersededBy && note.projectIds.length === item.projectIds.length && note.projectIds.every((projectId) => item.projectIds.includes(projectId))));
  if (hasExactResearch) { await page.locator(".opportunity-list .research-signal").first().waitFor(); assert.ok(await page.locator(".opportunity-list .research-signal").count() > 0, "exact research decisions must be visible in the opportunity list"); }
  const opportunity = page.locator(".opportunity-list .opportunity-row").first();
  let emptyState = false;
  if (await opportunity.count()) {
    await opportunity.click();
    await page.locator(".hypothesis-banner").waitFor();
    const relatedExperiments = page.locator(".related-experiments");
    await relatedExperiments.waitFor();
    assert.match(await relatedExperiments.innerText(), /相关技术实测/);
    assert.match(await relatedExperiments.innerText(), /不等于用户需求或付费验证/);
    if (await relatedExperiments.locator("a[download]").count()) assert.match(await relatedExperiments.locator("a[download]").first().getAttribute("href"), /^\/api\/v1\/experiments\/.+\/artifacts\/.+/);
    const relatedResearch = page.locator(".related-research");
    await relatedResearch.waitFor();
    const opportunityId = new URL(page.url()).pathname.split("/").at(-1);
    const relatedResearchResponse = await page.request.get(`${base}/api/v1/opportunities/${opportunityId}/research-notes`);
    assert.equal(relatedResearchResponse.status(), 200);
    const relatedResearchRecords = await relatedResearchResponse.json();
    if (relatedResearchRecords.length) {
      await page.waitForFunction(() => document.querySelectorAll(".related-research-note").length > 0);
      assert.ok(await relatedResearch.locator(".related-research-note").count() > 0, "related research decisions must be visible on the opportunity");
    }
    const currentExactResearch = relatedResearchRecords.filter((note) => !note.supersededBy && note.relation === "exact");
    const detailExperiments = await (await page.request.get(`${base}/api/v1/experiments`)).json();
    const exactExperiments = detailExperiments.records.filter((record) => record.projectIds.length === opportunityRecords.find((item) => item.id === opportunityId).projectIds.length && record.projectIds.every((id) => opportunityRecords.find((item) => item.id === opportunityId).projectIds.includes(id)));
    if (currentExactResearch.length || exactExperiments.length) {
      const initialProposal = page.locator(".experiment-callout details");
      await initialProposal.waitFor();
      assert.equal(await initialProposal.evaluate((element) => element.open), false, "the original experiment must stay collapsed when exact follow-up evidence exists");
      const sectionOrder = await page.evaluate(() => [".related-research", ".related-experiments", ".experiment-callout"].map((selector) => document.querySelector(selector)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY));
      assert.deepEqual(sectionOrder, [...sectionOrder].sort((a, b) => a - b), "current research and technical results must precede the original experiment");
      const reportResponse = await page.request.get(`${base}/api/v1/opportunities/${opportunityId}/report.md`);
      assert.equal(reportResponse.status(), 200);
      const report = await reportResponse.text();
      assert.ok(report.indexOf("## 后续研究与实测") < report.indexOf("## 原始机会提案"), "the exported report must prioritize follow-up evidence");
      for (const note of currentExactResearch) assert.ok(report.includes(note.title), "the report must include current exact research notes");
      for (const record of exactExperiments) assert.ok(report.includes(record.id), "the report must include exact technical experiments");
    }
    await page.screenshot({ path: ".data/browser/opportunity-detail.png", fullPage: true });
  } else {
    const emptyMessage = page.locator(".empty-state");
    await emptyMessage.waitFor();
    const message = await emptyMessage.innerText();
    if (analyses[0]?.status === "failed") assert.match(message, /最近一次分析未完成/);
    else if (analyses[0]?.status === "succeeded") {
      assert.match(message, /最近一次分析已完成/);
      assert.match(message, /不代表市场没有机会/);
    }
    emptyState = true;
    await page.screenshot({ path: ".data/browser/opportunities-empty.png", fullPage: true });
  }
  const leads = await (await page.request.get(`${base}/api/v1/research/leads`)).json();
  let leadPrefill = false;
  if (leads.leads.length) {
    await page.goto(`${base}/opportunities`);
    await page.locator(".research-lead").first().waitFor();
    const lead = page.locator(".research-lead").first();
    await lead.locator(":scope > summary").click();
    await lead.getByRole("heading", { name: "下一步检查" }).waitFor();
    await page.screenshot({ path: ".data/browser/research-leads-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "research leads must fit a mobile viewport");
    await page.screenshot({ path: ".data/browser/research-leads-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1050 });
    if (leads.leads[0].resume) {
      const resume = leads.leads[0].resume;
      await lead.getByRole("link", { name: "带入研究表单" }).click();
      await page.waitForURL(/question=/);
      await page.waitForFunction((question) => document.querySelector('textarea[aria-label="待证伪的研究问题"]')?.value === question, resume.question);
      const selected = await page.locator('.research-focus-projects select').evaluateAll((elements) => elements.map((element) => element.value).filter(Boolean));
      assert.deepEqual([...selected].sort(), [...resume.projectIds].sort());
      if (resume.originIssue) {
        const originValue = `${resume.originIssue.projectId}:${resume.originIssue.issueNumber}`;
        await page.waitForFunction((value) => document.querySelector('select[aria-label="研究问题起点"]')?.value === value, originValue);
        assert.equal(selected[0], resume.originIssue.projectId);
      }
      leadPrefill = true;
    }
    const after = await (await page.request.get(`${base}/api/v1/analysis/runs`)).json();
    assert.deepEqual(after.map((run) => run.id), analyses.map((run) => run.id), "viewing and prefilling leads must not create paid analyses");
  }
  await page.goto(`${base}/activity`);
  await page.getByRole("heading", { name: "运行轨迹", exact: true }).waitFor();
  const analysisRecords = page.locator(".analysis-record");
  if (await analysisRecords.count()) {
    await analysisRecords.first().waitFor();
    await analysisRecords.first().locator("summary").click();
  } else {
    await page.locator(".empty-state").first().waitFor();
  }
  await page.screenshot({ path: ".data/browser/review-history.png", fullPage: true });
  await page.goto(`${base}/experiments`);
  await page.getByRole("heading", { name: "技术实测", exact: true }).waitFor();
  const experiments = await (await page.request.get(`${base}/api/v1/experiments`)).json();
  assert.deepEqual(experiments.warnings, []);
  for (const experiment of experiments.records) {
    const card = page.locator(".experiment-record").filter({ hasText: experiment.title }).first();
    await card.waitFor();
    const links = card.locator(".capability-list a");
    assert.equal(await links.count(), experiment.sources.length);
    for (const [index, source] of experiment.sources.entries()) {
      assert.equal(await links.nth(index).getAttribute("href"), "https://github.com/" + source.repository + "/tree/" + source.commit, "A source must link to its own fixed commit, regardless of related project count or order");
    }
  }
  if (experiments.records.length) {
    const record = page.locator(".experiment-record").first();
    await record.waitFor();
    const images = record.locator("img");
    for (let index = 0; index < await images.count(); index++) {
      await images.nth(index).scrollIntoViewIfNeeded();
      await images.nth(index).evaluate((image) => image.decode());
    }
    const artifactDetails = record.locator("details").filter({ hasText: "版本、环境与产物下载" }).first();
    await artifactDetails.locator("> summary").click();
    const artifact = experiments.records[0].artifacts.find((item) => item.name.endsWith(".pptx"));
    if (artifact) {
      const artifactDownload = page.waitForEvent("download");
      await record.getByRole("link", { name: artifact.label, exact: true }).click();
      await (await artifactDownload).saveAs(".data/browser/experiment-baseline.pptx");
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: ".data/browser/experiments-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "experiment details must fit a mobile viewport");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: ".data/browser/experiments-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1050 });
  }
  await page.goto(`${base}/settings`);
  await page.locator("#discovery-mode").waitFor();
  assert.equal(await page.locator("#discovery-mode").inputValue(), "balanced");
  const settings = await (await page.request.get(`${base}/api/v1/settings`)).json();
  for (const [selector, field] of [["#profile-user", "targetUser"], ["#profile-work", "recurringWork"], ["#profile-constraints", "constraints"]]) {
    await page.locator(selector).waitFor();
    assert.equal(await page.locator(selector).inputValue(), settings.researchProfile?.[field] ?? "");
  }
  await page.screenshot({ path: ".data/browser/settings-profile-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "research profile settings must fit mobile");
  await page.locator(".github-tls-status").waitFor();
  assert.match(await page.locator(".github-tls-status").innerText(), /当前状态只描述配置/);
  await page.screenshot({ path: ".data/browser/settings-profile-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  const integrations = await (await page.request.get(`${base}/api/v1/integrations`)).json();
  if (integrations.analysis.lastRun) {
    const outcome = explainAnalysisOutcome(integrations.analysis.lastRun);
    const liveSettingsOutcome = await page.locator(".analysis-service-outcome").innerText();
    assert.ok(liveSettingsOutcome.includes(outcome.label));
    assert.ok(liveSettingsOutcome.includes(outcome.detail));
  }
  if (integrations.analysis.mode === "opencode") {
    await page.getByRole("heading", { name: "OpenCode 免费模型分析", exact: true }).waitFor();
    assert.equal(integrations.analysis.freeModelsOnly, true);
    assert.equal(integrations.analysis.automaticPaidFallback, false);
    const modelSection = page.locator(".settings-section").filter({ has: page.getByRole("heading", { name: "OpenCode 免费模型分析", exact: true }) });
    assert.match(await modelSection.innerText(), /不会自动调用 DeepSeek API/);
    for (const model of integrations.analysis.lastRun?.modelsUsed ?? []) assert.ok((await modelSection.innerText()).includes(model));
    await page.screenshot({ path: ".data/browser/settings-opencode-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "OpenCode settings must fit mobile");
    await page.screenshot({ path: ".data/browser/settings-opencode-mobile.png", fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.locator(".research-brief").waitFor();
  await page.locator("#discovery.discovery-workbench").waitFor();
  const homeResearchNotes = await (await page.request.get(`${base}/api/v1/research-notes`)).json();
  const activeHomeResearchNotes = homeResearchNotes.filter((note) => !note.supersededBy);
  await page.waitForFunction((expectedNotes) => {
    const notebook = document.querySelector("#research-notes");
    return Boolean(notebook)
      && !notebook.textContent.includes("正在读取研究判断")
      && notebook.querySelectorAll(".research-note").length === Math.min(expectedNotes, 3);
  }, activeHomeResearchNotes.length);
  assert.ok(await page.locator("#discovery .discovery-card, #discovery .discovery-empty").count() > 0, "mobile discovery must finish loading before capture");
  assert.equal(await page.locator("#research-notes .research-note").count(), Math.min(activeHomeResearchNotes.length, 3), "mobile research notes must render the loaded records");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, "mobile page must not overflow horizontally");
  await page.screenshot({ path: ".data/browser/radar-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log(JSON.stringify({ browser: "Edge", navigation: "passed", issues: sampledProjects, experiments: experiments.records.length, emptyState, researchLeads: leads.leads.length, leadPrefill, download: download.suggestedFilename(), mobileOverflow: overflow, pageErrors: errors, writes }));
} finally { await browser.close(); }
