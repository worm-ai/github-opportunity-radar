import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4359";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
const writes = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
try {
  await page.goto(base);
  const entry = page.locator(".research-first-start");
  await entry.waitFor();
  const completed = entry.getByRole("link", { name: /查看已完成研究/ });
  // The home page renders the research-first shell before the asynchronous
  // demand query resolves. Waiting for visibility keeps this assertion about
  // the product's rendered state instead of racing the initial React effect.
  await completed.waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await completed.count(), 1, "the home page must expose a real completed research result");
  const href = await completed.getAttribute("href");
  assert.match(href ?? "", /^\/research\?run=/);
  const selectedRunId = new URL(href, base).searchParams.get("run");
  const summaries = await (await page.request.get(`${base}/api/v1/demands`)).json();
  const selectedSummary = summaries.find(run => run.id === selectedRunId);
  assert.ok(selectedSummary, "the homepage link must target a real demand summary");
  const allNotes = await (await page.request.get(`${base}/api/v1/research-notes`)).json();
  const selectedNoteCount = typeof selectedSummary.researchNoteCount === "number"
    ? selectedSummary.researchNoteCount
    : allNotes.filter(note => note.originDemandId === selectedRunId && !note.supersededBy).length;
  assert.ok(selectedNoteCount > 0, "the homepage should prefer a completed research result with reviewable evidence");
  await completed.click();
  await page.waitForURL(/\/research\?run=/);
  const action = page.locator('[aria-label="当前行动摘要"]');
  await action.waitFor();
  assert.ok((await action.innerText()).includes("下一步"));
  const experimentLink = page.locator('a[href="#demand-experiments"]');
  assert.ok((await experimentLink.count()) >= 1, "a completed research result with candidates must expose controlled evidence");
  await experimentLink.first().click();
  await page.locator("#demand-experiments").waitFor();
  const experimentRuns = await (await page.request.get(`${base}/api/v1/experiments/runs`)).json();
  const successfulRun = experimentRuns.find(run => run.status === "succeeded");
  assert.ok(successfulRun, "the product must expose at least one successful controlled run");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log(JSON.stringify({ base, runId: new URL(page.url()).searchParams.get("run"), researchNoteCount: selectedNoteCount, successfulExperimentRun: successfulRun.id, actionVisible: true, controlledEvidenceVisible: true, mobileOverflow: false, errors, writes }));
} finally {
  await context.close();
  await browser.close();
}
