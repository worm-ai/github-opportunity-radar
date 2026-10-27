import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4340";
const folder = ".data/verification/requirement-fallback";
mkdirSync(folder, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], writes = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => { if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method()) && request.url().startsWith(base)) writes.push(request.url()); });
try {
  await page.goto(base + "/experiments");
  await page.getByRole("heading", { name: "技术实测", exact: true }).waitFor();
  // Multiple experiments can be runnable; assert the shared behavior against
  // one registered card instead of assuming a single button exists.
  const button = page.locator(".experiment-run-panel button").first();
  await button.waitFor();
  assert.ok((await page.locator("main").innerText()).includes("重新验证"));
  assert.ok(!/\?{3,}/.test(await page.locator("main").innerText()));
  await page.waitForFunction(() => !document.querySelector(".experiment-run-panel button")?.disabled);
  assert.ok(await button.isEnabled());
  await page.screenshot({ path: folder + "/experiments-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: folder + "/experiments-mobile.png", fullPage: true });
  // Read failure must be visible, and an unknown execution state must not
  // leave an enabled launch action. This fixture never starts an experiment.
  await page.route("**/api/v1/experiments/runs", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "运行状态读取故障验证" } }) }));
  await page.reload();
  await page.getByText(/无法读取实验运行状态：/).waitFor({ timeout: 20000 });
  assert.ok(await button.isDisabled());
  await page.goto(base + "/research");
  await page.getByRole("heading", { name: "需求研究", exact: true }).waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const summary = { errors, writes, readableExperimentLabels: true, desktop: true, mobile: true, failedRunReadDisablesLaunch: true };
  writeFileSync(folder + "/browser.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }
