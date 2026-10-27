import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4359";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
const writes = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  await page.goto(`${base}/research`);
  await page.getByLabel("你的需求").fill("我想查找本地缓存中的多智能体实现线索并比较恢复能力。");
  await page.getByRole("button", { name: "先查本地缓存" }).click();
  const card = page.locator('[aria-label="本地缓存候选"]');
  await card.waitFor();
  await card.getByLabel("缓存关键词").fill("agent memory missing");
  await card.getByRole("button", { name: "检索本地缓存" }).click();
  await card.getByText("精确查询无结果", { exact: false }).waitFor();
  assert.ok(await card.locator("li").count() > 0, "expanded cache search should recover local leads");
  const downloadPromise = page.waitForEvent("download");
  await card.getByRole("link", { name: "下载 JSON 证据" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  assert.ok(downloadPath);
  const downloaded = JSON.parse(await readFile(downloadPath, "utf8"));
  assert.deepEqual(downloaded.expandedQueries, ["agent", "memory"]);
  assert.equal(downloaded.items.length, await card.locator("li").count());
  const markdownDownloadPromise = page.waitForEvent("download");
  await card.getByRole("link", { name: "下载 Markdown 交接简报" }).click();
  const markdownDownload = await markdownDownloadPromise;
  const markdownPath = await markdownDownload.path();
  assert.ok(markdownPath);
  const markdown = await readFile(markdownPath, "utf8");
  assert.match(markdown, /# 本地缓存线索交接简报/);
  assert.match(markdown, /扩展查询：agent、memory/);
  assert.match(markdown, /下一步人工核验/);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log(JSON.stringify({ base, expandedQueries: downloaded.expandedQueries, candidates: downloaded.items.length, markdownHandoff: true, errors, writes }));
  await context.close();
} finally {
  await browser.close();
}
