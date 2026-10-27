import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

// Use an isolated instance whose GitHub access is currently failing.
// This submits one real demand; a successful preflight can start model work.
const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4351";
const output = ".data/browser/preflight-20261024";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
mkdirSync(output, { recursive: true });
try {
  const before = await (await page.request.get(`${base}/api/v1/demands`)).json();
  const dashboardBefore = await (await page.request.get(`${base}/api/v1/dashboard`)).json();
  assert.equal(dashboardBefore.analysis.state, "configured");
  assert.equal(dashboardBefore.evidence.running, false);
  await page.goto(`${base}/research`);
  await page.getByRole("button", { name: "使用社会模拟示例", exact: true }).click();
  const question = await page.locator("#demand-question").inputValue();
  assert.ok(question.includes("社会模拟"));
  const button = page.getByRole("button", { name: "开始研究", exact: true });
  await button.waitFor();
  const started = Date.now();
  const responsePromise = page.waitForResponse(response => response.url() === `${base}/api/v1/demands` && response.request().method() === "POST");
  await button.click();
  const response = await responsePromise;
  assert.equal(response.status(), 503, "This verifier requires unavailable GitHub access");
  const body = await response.json();
  assert.equal(body.error.code, "github_preflight_failed");
  assert.match(body.error.message, /尚未创建研究任务或调用模型/);
  const alert = page.locator(".demand-composer [role=alert]").filter({ hasText: "尚未创建研究任务或调用模型" });
  await alert.waitFor();
  assert.equal(await page.locator("#demand-question").inputValue(), question);
  assert.equal(new URL(page.url()).searchParams.has("run"), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  const after = await (await page.request.get(`${base}/api/v1/demands`)).json();
  assert.deepEqual(after, before);
  const dashboardAfter = await (await page.request.get(`${base}/api/v1/dashboard`)).json();
  assert.equal(dashboardAfter.analysis.running, false);
  assert.equal(dashboardAfter.evidence.running, false);
  assert.deepEqual(dashboardAfter.analysis.lastRun, dashboardBefore.analysis.lastRun);
  assert.deepEqual(errors, []);
  const result = { checkedAt: new Date().toISOString(), base, durationMs: Date.now() - started, status: response.status(), error: body.error, demandCountBefore: before.length, demandCountAfter: after.length, questionPreserved: true, desktop: "passed", mobile: "passed", errors };
  writeFileSync(`${output}/verification.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
