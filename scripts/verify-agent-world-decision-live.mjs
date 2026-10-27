import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = "http://127.0.0.1:4340";
const demandId = "88f93fcf-f102-466b-960b-cc53e4978d63";
const noteId = "28095417-f9e6-43f4-ad63-2a0a8d515427";
const output = ".data/verification/agent-world-daphne-20261026";
mkdirSync(output, { recursive: true });
const before = await (await fetch(`${base}/api/v1/research-notes/${noteId}`)).json();
assert.equal(before.decision, "stop");
const errors = [], writes = [];
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  await page.goto(`${base}/research?run=${demandId}`, { waitUntil: "networkidle", timeout: 20000 });
  await page.getByRole("region", { name: "本次选型判断", exact: true }).getByText("停止上游原版直接采用", { exact: true }).waitFor();
  const body = await page.locator("body").innerText();
  assert.ok(body.includes("只继续验证本地异步桥接改造"));
  await page.screenshot({ path: `${output}/decision-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/decision-mobile.png`, fullPage: true });
  await page.reload({ waitUntil: "networkidle", timeout: 20000 });
  await page.getByRole("region", { name: "本次选型判断", exact: true }).getByText("停止上游原版直接采用", { exact: true }).waitFor();
} finally { await browser.close(); }
const after = await (await fetch(`${base}/api/v1/research-notes/${noteId}`)).json();
assert.deepEqual(after, before); assert.deepEqual(errors, []); assert.deepEqual(writes, []);
const summary = { verifiedAt: new Date().toISOString(), demandId, noteId, decision: before.decision, exactEvidenceState: before.evidenceStates, browser: { errors, writes, desktopMobileOverflow: false, deepLinkReload: true }, persistedUnchanged: true };
writeFileSync(`${output}/decision.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
