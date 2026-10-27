// Read-only by default; RADAR_SOURCE_START=1 explicitly submits the selected saved social-simulation task.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4318";
const parentId = process.env.RADAR_SOURCE_PARENT || "06fffe22-dc24-4182-bed7-1cc70f60e1c5";
const output = process.env.RADAR_SOURCE_OUTPUT || ".data/browser/demand-source";
const selectedProjectIds = (process.env.RADAR_SOURCE_PROJECT_IDS || "").split(",").filter(Boolean);
const selectedCapabilityIds = (process.env.RADAR_SOURCE_CAPABILITY_IDS || "").split(",").filter(Boolean);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [], writes = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  const parentBefore = await (await fetch(`${base}/api/v1/demands/${parentId}`)).json();
  assert.equal(parentBefore.id, parentId);
  await page.goto(`${base}/research?run=${parentId}`);
  await page.getByRole("heading", { name: "针对缺口继续研究", exact: true }).waitFor();
  const form = page.locator(".demand-source-form");
  const projects = parentBefore.snapshot.projects.filter(project => selectedProjectIds.length ? selectedProjectIds.includes(project.id) : parentBefore.snapshot.projects.indexOf(project) < 2);
  const capabilities = parentBefore.snapshot.plan.capabilities.filter(capability => selectedCapabilityIds.length ? selectedCapabilityIds.includes(capability.id) : parentBefore.snapshot.plan.capabilities.indexOf(capability) < 3);
  assert.ok(projects.length > 0 && projects.length <= 2);
  assert.ok(capabilities.length > 0 && capabilities.length <= 3);
  for (const project of projects) await form.getByLabel(project.fullName, { exact: true }).check();
  for (const capability of capabilities) await form.getByLabel(capability.description, { exact: true }).check();
  assert.deepEqual(writes, [], "Selecting a scope must not call the model");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/selection-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/selection-mobile.png`, fullPage: true });
  let childId = process.env.RADAR_SOURCE_ID;
  if (process.env.RADAR_SOURCE_START === "1") {
    const received = page.waitForResponse(response => response.url().endsWith(`/demands/${parentId}/continue`) && response.request().method() === "POST");
    await form.getByRole("button", { name: "补读源码并重评" }).click();
    const result = await received;
    assert.equal(result.status(), 202);
    childId = (await result.json()).id;
    writeFileSync(`${output}/submitted.json`, JSON.stringify({ parentId, childId, observedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ submitted: childId, parentId }));
    await page.waitForURL(`**/research?run=${childId}`);
  }
  if (childId) {
    await page.goto(`${base}/research?run=${childId}`);
    await page.locator('#demand-source-evidence > summary').click();
    await page.getByRole("heading", { name: "源码核查（未经运行验证）", exact: true }).waitFor();
    let child, deadline = Date.now() + 15 * 60_000;
    do {
      child = await (await fetch(`${base}/api/v1/demands/${childId}`)).json();
      if (child.status !== "running") break;
      if (Date.now() >= deadline) throw new Error("Source study remained running past the 15 minute verification window");
      await page.waitForTimeout(2000);
    } while (true);
    assert.equal(child.continuationOf, parentId);
    assert.deepEqual(await (await fetch(`${base}/api/v1/demands/${parentId}`)).json(), parentBefore, "The original task is immutable");
    assert.equal(await page.locator(".demand-source-form").count(), 0, "No recursive continuation");
    if (child.status !== "running") {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("link", { name: "导出完整材料" }).click();
      const download = await downloadPromise;
      await download.saveAs(`${output}/report.json`);
    }
    await page.reload();
    await page.locator('#demand-source-evidence > summary').click();
    await page.getByRole("heading", { name: "源码核查（未经运行验证）", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/result-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/result-desktop.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  assert.equal(writes.length, process.env.RADAR_SOURCE_START === "1" ? 1 : 0);
  const result = { parentId, childId: childId ?? null, errors, writes, checkedAt: new Date().toISOString() };
  writeFileSync(`${output}/verification.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
