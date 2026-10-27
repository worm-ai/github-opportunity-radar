import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4359";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
const writes = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  const demands = await (await page.request.get(`${base}/api/v1/demands`)).json();
  const run = demands.find(item => ["partial", "succeeded"].includes(item.status));
  assert.ok(run, "an existing completed demand is required for the first-screen check");
  await page.goto(`${base}/research?run=${encodeURIComponent(run.id)}`);
  const action = page.locator('[aria-label="当前行动摘要"]');
  await action.waitFor();
  const metrics = await action.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const next = element.querySelector(".demand-action-next");
    const lineage = element.parentElement?.querySelector(".demand-lineage");
    const nextRect = next?.getBoundingClientRect();
    const quickActions = [...element.querySelectorAll("a")].map(link => link.getAttribute("href"));
    return { top: rect.top, bottom: rect.bottom, nextTop: nextRect?.top ?? null, nextBottom: nextRect?.bottom ?? null, viewport: innerHeight, hasNextStep: Boolean(next), quickActions, lineageAfter: Boolean(lineage && (element.compareDocumentPosition(lineage) & Node.DOCUMENT_POSITION_FOLLOWING)) };
  });
  assert.ok(metrics.top < metrics.viewport, "the action summary must start in the first mobile viewport");
  assert.ok(metrics.hasNextStep && metrics.nextBottom !== null && metrics.nextBottom < metrics.viewport, "the first-screen action summary must show the next step");
  assert.ok(metrics.quickActions.includes("#demand-experiments"), "the first-screen action summary must link to controlled experiments");
  assert.equal(metrics.lineageAfter, true, "lineage remains available after the action summary");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log(JSON.stringify({ base, runId: run.id, actionTop: Math.round(metrics.top), nextBottom: Math.round(metrics.nextBottom), viewport: metrics.viewport, actionInFirstViewport: true, nextStepInFirstViewport: true, errors, writes }));
  await context.close();
} finally {
  await browser.close();
}
