import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL ?? "http://127.0.0.1:4340";
const runId = process.env.RADAR_RUN_ID ?? "88f93fcf-f102-466b-960b-cc53e4978d63";
const api = `${base}/api/v1`;
const started = performance.now();
const response = await fetch(`${api}/demands/${encodeURIComponent(runId)}/research-notes`);
assert.equal(response.status, 200);
const notes = await response.json();
const sourceMs = Math.round(performance.now() - started);
assert.ok(notes.some((note) => note.originDemandId === runId && note.projectNames.includes("sbenodiz/agent-world") && note.decision === "continue"));

const errors = [];
const writes = [];
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  const pageResponse = await page.goto(`${base}/research?run=${encodeURIComponent(runId)}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  assert.equal(pageResponse?.status(), 200);
  const action = page.locator(".demand-action").first();
  await action.getByText("已有人工实测，继续验证下一步", { exact: true }).waitFor({ timeout: 5_000 });
  await action.getByText("sbenodiz/agent-world", { exact: false }).waitFor();
  const actionText = await action.innerText();
  assert.match(actionText, /社会模拟的后续验证集中/);
  assert.doesNotMatch(actionText, /Local bridge evidence|Add UI-observable/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  await context.close();
} finally { await browser.close(); }
console.log(JSON.stringify({ base, runId, relatedNotes: notes.length, sourceMs, errors, writes }));
