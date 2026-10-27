import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL ?? "http://127.0.0.1:4340";
const api = `${base}/api/v1`;
const id = process.env.RADAR_EXPERIMENT_ID ?? "agent-world-continuous-crash-2026-10-27-v4";
const output = process.env.RADAR_CONTINUOUS_VERIFY_OUTPUT ?? `.data/verification/${id}`;
mkdirSync(output, { recursive: true });
const get = async path => { const response = await fetch(`${api}/${path}`); assert.equal(response.status, 200, path); return response.json(); };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const archive = await get("experiments");
assert.deepEqual(archive.warnings, []);
const record = archive.records.find(item => item.id === id);
assert.ok(record);
assert.ok(record.checks.filter(item => item.outcome === "supported").length >= 7);
assert.equal(record.checks.filter(item => item.outcome === "inconclusive").length, 1);
for (const artifact of record.artifacts) {
  const response = await fetch(`${api}/experiments/${id}/artifacts/${encodeURIComponent(artifact.name)}`);
  assert.equal(response.status, 200, artifact.name);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(digest(bytes), artifact.sha256, artifact.name);
}

const errors = [];
const writes = [];
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  await page.goto(`${base}/experiments#experiment-${id}`);
  const subject = page.locator(`#experiment-${id}`);
  await subject.waitFor();
  await subject.getByText(record.conclusion, { exact: false }).waitFor();
  await subject.getByText('玩家事件在 WebSocket 与 HTTP 可见', { exact: false }).waitFor();
  await subject.getByText('第 5 tick：WebSocket 可见，HTTP 可见', { exact: false }).waitFor();
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    await page.setViewportSize({ width, height });
    await subject.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  }
  await context.close();
} finally { await browser.close(); }
assert.deepEqual(errors, []);
assert.deepEqual(writes, []);
const receipt = { verifiedAt: new Date().toISOString(), service: base, experimentId: id,
  checks: record.checks, artifacts: record.artifacts, browser: { desktopMobileOverflow: false, errors, writes, deepLink: true } };
writeFileSync(`${output}/summary.json`, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
