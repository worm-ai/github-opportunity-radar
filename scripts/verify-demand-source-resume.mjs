// Read-only unless RADAR_SOURCE_RESUME_START=1. Never resubmits on reload.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4318";
const failedId = process.env.RADAR_SOURCE_FAILED || "83d2a92e-5e81-4b88-aab2-8d5dc50759d4";
const output = process.env.RADAR_SOURCE_OUTPUT || ".data/browser/demand-source-resume";
const get = async id => {
  const response = await fetch(`${base}/api/v1/demands/${id}`);
  assert.equal(response.status, 200);
  return response.json();
};
mkdirSync(output, { recursive: true });
const failedBefore = await get(failedId), parentBefore = await get(failedBefore.continuationOf);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [], writes = [];
let resumedId = process.env.RADAR_SOURCE_RESUMED;
let researchResult = null;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  await page.goto(`${base}/research?run=${failedId}`);
  const button = page.getByRole("button", { name: "用已采源码继续分析", exact: true });
  await button.waitFor();
  assert.equal(await button.isEnabled(), true);
  assert.deepEqual(writes, []);
  if (process.env.RADAR_SOURCE_RESUME_START === "1") {
    const received = page.waitForResponse(response => response.url().endsWith(`/demands/${failedId}/resume-source`) && response.request().method() === "POST");
    await button.click();
    const response = await received;
    assert.equal(response.status(), 202);
    resumedId = (await response.json()).id;
    writeFileSync(`${output}/submitted.json`, JSON.stringify({ failedId, resumedId, startedAt: new Date().toISOString() }, null, 2));
    await page.waitForURL(`**/research?run=${resumedId}`);
  }
  if (resumedId) {
    await page.goto(`${base}/research?run=${resumedId}`);
    await page.locator('#demand-source-evidence > summary').click();
    await page.getByRole("heading", { name: "源码核查（未经运行验证）", exact: true }).waitFor();
    let resumed, deadline = Date.now() + 15 * 60_000;
    do {
      resumed = await get(resumedId);
      if (resumed.status !== "running") break;
      if (Date.now() >= deadline) throw new Error("Source resume remained running past the 15 minute verification window");
      await page.waitForTimeout(2000);
    } while (true);
    researchResult = { status: resumed.status, outcome: resumed.snapshot?.outcome ?? null, recommendedPathId: resumed.snapshot?.recommendedPathId ?? null, error: resumed.error ?? null,
      completedAnalysis: ["succeeded", "partial"].includes(resumed.status), hasRecommendation: Boolean(resumed.snapshot?.recommendedPathId) };
    // Save actual terminal material before making assertions about its quality.
    writeFileSync(`${output}/terminal.json`, JSON.stringify(resumed, null, 2));
    assert.equal(resumed.continuationOf, parentBefore.id);
    assert.equal(resumed.retryOf, failedId);
    assert.equal(resumed.snapshot.sourceStudy.resumedFrom, failedId);
    assert.deepEqual(resumed.snapshot.sources, failedBefore.snapshot.sources);
    const assessmentCalls = resumed.snapshot.calls.filter(call => call.stage === "source_assessment");
    assert.ok(assessmentCalls.length > 0 || failedBefore.snapshot.calls.at(-1)?.stage === "source_synthesis");
    if (resumed.status === "succeeded" || resumed.status === "partial") assert.equal(resumed.snapshot.calls.at(-1)?.stage, "source_synthesis");
    else assert.ok(resumed.error, "A failed analysis must retain its actual failure reason");
    assert.equal(await page.locator(".demand-source-form").count(), 0);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "导出完整材料" }).click();
    await (await downloadPromise).saveAs(`${output}/report.json`);
    await page.reload();
    await page.locator('#demand-source-evidence > summary').click();
    await page.getByRole("heading", { name: "源码核查（未经运行验证）", exact: true }).waitFor();
  }
  assert.deepEqual(await get(failedId), failedBefore, "Failed history must remain immutable");
  assert.deepEqual(await get(parentBefore.id), parentBefore, "Original study must remain immutable");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(writes.length, process.env.RADAR_SOURCE_RESUME_START === "1" ? 1 : 0);
  const result = { failedId, resumedId, researchResult, browserChecksPassed: true, errors, writes, observedAt: new Date().toISOString() };
  writeFileSync(`${output}/verification.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
