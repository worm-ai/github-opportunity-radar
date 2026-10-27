import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4350";
const runId = process.env.RADAR_DEMAND_RUN || "1689cc6f-7834-4a51-bb56-278fa1b6c4a2";
const output = ".data/browser/acceptance-20261024";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
const writes = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && request.url().startsWith(`${base}/api/`)) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
});
mkdirSync(output, { recursive: true });
try {
  const response = await page.request.get(`${base}/api/v1/demands/${runId}`);
  assert.equal(response.status(), 200);
  const run = await response.json();
  assert.equal(run.status, "partial");
  assert.equal(run.snapshot.projects.length, 0);
  assert.ok(run.snapshot.searches.length > 0);
  assert.ok(run.snapshot.searches.every(search => search.status === "failed" && search.error.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE")));
  await page.goto(`${base}/research?run=${encodeURIComponent(runId)}`);
  const notice = page.locator(".demand-results .demand-notice[role=alert]");
  await notice.waitFor();
  const heading = await notice.locator("h3").innerText();
  assert.match(heading, /GitHub 搜索全部失败/);
  assert.match(await notice.innerText(), /尚未完成方案比较/);
  assert.match(await notice.innerText(), /保留证书校验/);
  assert.match(await notice.innerText(), /尚无可信选型结论/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/failure-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/failure-mobile.png`, fullPage: true });
  await notice.getByRole("button").click();
  await page.waitForFunction(() => document.querySelector(".demand-composer")?.open === true);
  assert.equal(await page.locator("#demand-question").inputValue(), run.question);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(writes.length, 0, "Viewing and editing must not restart research");
  assert.deepEqual(errors, []);
  const result = { base, runId, checkedAt: new Date().toISOString(), status: run.status, stage: run.snapshot.stage, searches: run.snapshot.searches.map(search => ({ query: search.query, status: search.status, items: search.items.length })), projects: run.snapshot.projects.length, heading, desktop: "passed", mobile: "passed", editPreservesQuestion: true, writes, errors };
  writeFileSync(`${output}/verification.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
