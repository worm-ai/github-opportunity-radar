import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL ?? "http://127.0.0.1:4360";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
const writes = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });

try {
  await page.goto(`${base}/research`);
  const notebook = page.locator('[aria-label="独立任务对照"]');
  await notebook.waitFor();
  await notebook.locator(".section-head button").click();
  await notebook.locator('[aria-label="独立任务描述"]').fill("Compare three candidates from the research handoff.");
  await notebook.locator('[aria-label="独立任务基线方法"]').fill("Read each source manually");
  await notebook.locator('[aria-label="独立任务使用后方法"]').fill("Use the current action summary");
  await notebook.getByRole("button", { name: "保存本次任务对照" }).click();
  await notebook.locator(".task-measurement-row").waitFor();
  assert.equal(await notebook.locator(".task-measurement-row").count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  assert.equal(writes.filter(item => item.includes("POST http") && item.includes("/api/v1/task-measurements")).length, 1);
  const records = await page.request.get(`${base}/api/v1/task-measurements`).then(response => response.json());
  assert.equal(records.length, 1);
  console.log(JSON.stringify({ base, saved: records.length, unmeasured: records[0].timing === "unmeasured", mobileOverflow: false, errors, writes }));
} finally {
  await context.close();
  await browser.close();
}
