import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL ?? "http://127.0.0.1:4346";
const runId = process.env.RADAR_RUN_ID ?? "42ce86a1-cc8b-42fd-a09d-939406c336f2";
const output = ".data/verification/browser-owner-audit";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  const response = await page.goto(`${base}/research?run=${encodeURIComponent(runId)}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  assert.equal(response?.status(), 200);
  await page.waitForTimeout(3500);
  const action = await page.locator(".demand-action").first().innerText();
  assert.match(action, /当前行动摘要/);
  assert.match(action, /下一步/);
  assert.doesNotMatch(action, /真实搜索 GitHub.*仍未完全证实/);
  await page.screenshot({ path: `${output}/action-summary.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(mobileOverflow, false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ base, runId, status: response?.status(), action, mobileOverflow, errors, screenshot: `${output}/action-summary.png` }));
} finally {
  await browser.close();
}
