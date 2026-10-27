import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4340";
const demandId = process.env.RADAR_DEMAND_ID || "88f93fcf-f102-466b-960b-cc53e4978d63";
const output = ".data/verification/demand-experiment-run-link";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], writes = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && request.url().startsWith(`${base}/api/`)) writes.push(`${request.method()} ${request.url()}`); });
try {
  await page.goto(`${base}/research?run=${demandId}`);
  const section = page.locator("#demand-experiments");
  await section.waitFor();
  await page.waitForFunction(() => {
    const node = document.querySelector("#demand-experiments");
    return Boolean(node && !node.textContent?.includes("正在核对实测归档") && node.querySelector(".demand-experiment-run"));
  }, null, { timeout: 30000 });
  const buttons = await section.locator(".demand-experiment-run button").allTextContents();
  assert.ok(buttons.length >= 1, "at least one associated experiment must expose a controlled run action");
  assert.ok((await section.innerText()).includes("最近一次运行成功"), "the latest persisted run status must be visible");
  const action = page.locator(".demand-action").first();
  await action.waitFor();
  const linkedNotes = await (await fetch(`${base}/api/v1/demands/${demandId}/research-notes`)).json();
  const latestNote = linkedNotes[0];
  assert.ok(latestNote?.nextAction, "the demand must expose its latest persisted decision");
  const compact = value => String(value).replace(/\s+/g, "");
  const actionText = compact(await action.innerText());
  const nextActionPrefix = compact(latestNote.nextAction).slice(0, 32);
  assert.ok(nextActionPrefix && actionText.includes(nextActionPrefix), "the current action must use the latest persisted decision");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(mobileOverflow, false);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  const summary = { demandId, buttons, latestDecisionId: latestNote.id, latestRunStatusVisible: true, currentActionUsesLatestDecision: true, mobileOverflow, errors, writes };
  writeFileSync(`${output}/browser.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally {
  await browser.close();
}
