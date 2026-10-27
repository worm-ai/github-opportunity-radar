import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL ?? "http://127.0.0.1:4359";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));

try {
  await page.goto(`${base}/research`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const question = "Build a local-first multi-agent social simulation with persistent memory and restart recovery.";
  await page.locator("#demand-question").fill(question);
  await page.reload();
  await page.locator(".demand-draft-notice").waitFor();
  assert.equal(await page.locator("#demand-question").inputValue(), question);
  await page.locator(".demand-draft-notice button").click();
  assert.equal(await page.locator("#demand-question").inputValue(), "");
  assert.equal(await page.evaluate(() => localStorage.getItem("radar:demand-draft:v1")), null);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ base, draftRestored: true, clearWorks: true, mobileOverflow: false, errors }));
} finally {
  await context.close();
  await browser.close();
}
