import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4354";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
const writes = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  await page.goto(`${base}/projects`);
  await page.locator(".project-table, .empty-state").first().waitFor();
  const input = page.getByPlaceholder("筛选项目");
  await input.fill("agent");
  await page.getByText("本地缓存检索", { exact: false }).waitFor();
  const response = await page.request.get(`${base}/api/v1/projects/search?q=agent`);
  assert.equal(response.status(), 200);
  const body = await response.json();
  assert.equal(body.mode, "local_cache");
  assert.ok(body.items.length > 0);
  assert.ok(body.observedAt);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log(JSON.stringify({ base, mode: body.mode, resultCount: body.items.length, observedAt: body.observedAt, mobileOverflow: false, errors, writes }));
} finally {
  await browser.close();
}
