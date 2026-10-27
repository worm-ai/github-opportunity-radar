import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4354";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
const writes = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  const demands = await (await page.request.get(`${base}/api/v1/demands`)).json();
  const failed = demands.find(item => item.status === "failed");
  assert.ok(failed, "an existing failed demand is required for this read-only check");
  await page.goto(`${base}/research?run=${encodeURIComponent(failed.id)}`);
  const card = page.locator('[aria-label="本地缓存候选"]');
  await card.waitFor();
  const keyword = card.getByLabel("缓存关键词");
  assert.equal(await keyword.inputValue(), "多智能体");
  await card.getByRole("button", { name: "检索本地缓存" }).click();
  await card.getByText("local_cache", { exact: false }).waitFor();
  assert.ok(await card.locator("li").count() > 0);
  assert.ok(await card.locator("blockquote").count() > 0, "cached matches must show an auditable excerpt");
  const downloadPromise = page.waitForEvent("download");
  await card.getByRole("link", { name: "下载这组缓存证据" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  assert.ok(downloadPath, "the cache evidence link must produce a download");
  const downloaded = JSON.parse(await (await import("node:fs/promises")).readFile(downloadPath, "utf8"));
  assert.equal(downloaded.mode, "local_cache");
  assert.equal(downloaded.query, await keyword.inputValue());
  assert.ok(downloaded.observedAt);
  assert.ok(Array.isArray(downloaded.items));
  assert.ok(downloaded.items.length > 0);
  assert.ok(downloaded.items.some(item => Array.isArray(item.matchedEvidence) && item.matchedEvidence.length > 0), "downloaded evidence must retain excerpts");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log(JSON.stringify({ base, demandId: failed.id, query: await keyword.inputValue(), mode: "local_cache", candidateCount: await card.locator("li").count(), downloadedItems: downloaded.items.length, mobileOverflow: false, errors, writes }));
  await context.close();
} finally {
  await browser.close();
}
