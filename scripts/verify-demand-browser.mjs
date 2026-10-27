// Read-only by default. RADAR_DEMAND_START=1 explicitly submits the built-in example.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4318";
const output = ".data/browser/demand";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [], writes = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) writes.push(request.method() + " " + request.url()); });
  const history = await (await fetch(`${base}/api/v1/demands`)).json();
  let id = process.env.RADAR_DEMAND_ID || history[0]?.id;
  await page.goto(`${base}/research${id ? `?run=${encodeURIComponent(id)}` : ""}`);
  await page.getByRole("heading", { name: "需求研究", exact: true }).waitFor();
  if (process.env.RADAR_DEMAND_START === "1") {
    assert.equal(history.some(run => run.status === "running"), false, "Do not start another concurrent study");
    const retry = Boolean(id && process.env.RADAR_DEMAND_RETRY === "1");
    if (retry) await page.getByRole("button", { name: "编辑需求 / 重试" }).click();
    else {
      if (!await page.locator('.demand-composer').evaluate(element => element.open)) await page.locator('.demand-composer > summary').click();
      await page.getByRole("button", { name: "使用社会模拟示例" }).click();
    }
    const response = page.waitForResponse(response => response.url().endsWith("/api/v1/demands") && response.request().method() === "POST");
    await page.getByRole("button", { name: retry ? "按当前需求重新研究" : "开始研究", exact: true }).click();
    const submitted = await response;
    assert.equal(submitted.status(), 202);
    id = (await submitted.json()).id;
    await page.waitForURL(`**/research?run=${id}`);
  }
  if (id) {
    await page.locator(".demand-result-heading").waitFor();
    await page.reload();
    await page.locator(".demand-result-heading").waitFor();
    const run = await (await fetch(`${base}/api/v1/demands/${id}`)).json();
    assert.equal(run.id, id);
    assert.equal(await page.locator(".demand-result-heading h2").innerText(), run.question);
    if (run.status !== "running") {
      const downloaded = page.waitForEvent("download");
      await page.getByRole("link", { name: "导出完整材料" }).click();
      const download = await downloaded;
      await download.saveAs(`${output}/report.json`);
      assert.equal(download.suggestedFilename(), "implementation-research.json");
      const before = writes.length;
      await page.getByRole("button", { name: "编辑需求 / 重试" }).click();
      assert.equal(await page.getByLabel("你的需求", { exact: true }).inputValue(), run.question);
      assert.equal(writes.length, before, "Editing must not invoke a model");
    }
  }
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Desktop overflow");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Mobile overflow");
  const navigation = await page.locator(".main-nav").evaluate(nav => {
    const bar = nav.getBoundingClientRect();
    return [...nav.querySelectorAll(".nav-link")].map(link => {
      const rect = link.getBoundingClientRect();
      return { label: link.textContent, contained: rect.top >= bar.top && rect.bottom <= bar.bottom && rect.left >= bar.left && rect.right <= bar.right };
    });
  });
  assert.equal(navigation.length, 7, "All navigation destinations must be present");
  assert.ok(navigation.every(item => item.contained), `Mobile navigation outside bar: ${JSON.stringify(navigation)}`);
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(writes.length, process.env.RADAR_DEMAND_START === "1" ? 1 : 0);
  const result = { base, id, errors, writes, navigation, checked: ["desktop", "mobile", "mobile-navigation", "reload", ...(id ? ["history", "saved-question"] : [])] };
  writeFileSync(`${output}/verification.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
