// Synthetic workflow in a temporary SQLite database; no production writes,
// external users, upstream fetches or model calls are part of this test.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { RadarStore } from "../packages/storage/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "radar-progress-browser-"));
const store = new RadarStore(join(directory, "opportunity-radar.sqlite"));
const draft = { id: "fixture-validation", combinationKey: "fixture:validation", title: "隔离测试：文档审阅工作流", targetUser: "测试夹具中的开发者", jobToBeDone: "核对执行记录的保存与恢复", hypothesis: "测试夹具，不是真实机会或市场证据。", projectIds: ["fixture-a", "fixture-b"], projectNames: ["fixture/a", "fixture/b"], score: 50, supportingEvidence: [], counterEvidence: [], validationSteps: ["核查现有替代方案", "观察目标用户的实际工作"], successMetric: "能恢复步骤记录", failureMetric: "执行记录丢失", firstExperiment: "仅用于隔离测试的验证流程" };
store.saveOpportunities([draft]);
store.close();
const reservation = createServer();
await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [resolve(root, "apps/server/dist/index.js")], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, APP_HOST: "127.0.0.1", APP_PORT: String(port), DATA_DIR: directory, III_URL: "", ANALYSIS_PROVIDER: "rules", GITHUB_TOKEN: "", NODE_ENV: "production" } });
let logs = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", (bytes) => { logs = `${logs}${bytes}`.slice(-5000); });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Isolated service stopped: ${logs}`);
    if (await fetch(`${base}/api/v1/health/ready`).then((response) => response.ok).catch(() => false)) { ready = true; break; }
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, logs);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [], writes = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.method() !== "GET") writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await page.route("**/*", (route) => {
    assert.equal(new URL(route.request().url()).origin, base, "The isolated workflow must not contact external services");
    return route.continue();
  });
  await page.goto(`${base}/opportunities/${draft.id}`);
  const panel = page.getByRole("region", { name: "验证执行进度" });
  await panel.waitFor();
  const first = panel.locator(".validation-task").nth(0), second = panel.locator(".validation-task").nth(1);
  await first.getByRole("combobox").selectOption("completed");
  assert.equal(await first.getByRole("button", { name: "保存步骤结果" }).isDisabled(), true);
  await first.getByRole("textbox").fill("隔离测试记录：已核查替代方案，尚无真实用户访谈。");
  await first.getByRole("button", { name: "保存步骤结果" }).click();
  await first.getByText("已保存：已完成", { exact: false }).waitFor();
  await second.getByRole("combobox").selectOption("skipped");
  await second.getByRole("textbox").fill("隔离测试记录：没有授权工作流，暂时跳过。");
  await second.getByRole("button", { name: "保存步骤结果" }).click();
  await second.getByText("已保存：跳过", { exact: false }).waitFor();
  await page.reload();
  await first.getByText("已保存：已完成", { exact: false }).waitFor();
  assert.match(await first.getByRole("textbox").inputValue(), /已核查替代方案/);
  assert.equal(await second.getByRole("combobox").inputValue(), "skipped");
  assert.match(await panel.innerText(), /已完成 1 \/ 2 步 · 跳过 1 步/);
  const record = await (await page.request.get(`${base}/api/v1/opportunities/${draft.id}`)).json();
  assert.equal(record.marketStatus, "unvalidated");
  assert.equal(record.status, "candidate");
  assert.deepEqual(record.validationRecords, []);
  mkdirSync(resolve(root, ".data/browser"), { recursive: true });
  await panel.screenshot({ path: resolve(root, ".data/browser/validation-progress-isolated-desktop.png") });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "导出完整验证方案" }).click();
  const download = await downloadPromise;
  const reportPath = resolve(root, ".data/browser/validation-progress-isolated.md");
  await download.saveAs(reportPath);
  assert.match(readFileSync(reportPath, "utf8"), /隔离测试记录：已核查替代方案/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await panel.screenshot({ path: resolve(root, ".data/browser/validation-progress-isolated-mobile.png") });
  await page.goto(`${base}/opportunities`);
  await page.locator(".validation-progress-summary").getByText("已完成 1/2 步 · 跳过 1 步", { exact: true }).waitFor();
  await page.locator(".opportunity-list .opportunity-row").click();
  await first.getByText("已保存：已完成", { exact: false }).waitFor();
  await first.getByRole("combobox").selectOption("pending");
  await first.getByRole("button", { name: "重置为待执行" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".task-completed").length === 0);
  await page.reload();
  await panel.waitFor();
  assert.equal(await first.getByRole("textbox").inputValue(), "");
  assert.equal(await first.getByRole("combobox").inputValue(), "pending");
  assert.equal(await second.getByRole("combobox").inputValue(), "skipped");
  assert.deepEqual(errors, []);
  assert.ok(writes.every((entry) => entry === `PUT /api/v1/opportunities/${draft.id}/steps/0` || entry === `PUT /api/v1/opportunities/${draft.id}/steps/1`));
  assert.equal(writes.length, 3);
  const result = { source: "synthetic workflow; isolated server and temporary database", completionAndSkip: true, reloadRestoresState: true, explicitReset: true, listProgress: true, reportExport: true, marketUnchanged: true, mobileOverflow: false, errors, writes, productionWrites: 0, modelCalls: 0 };
  writeFileSync(resolve(root, ".data/browser/validation-progress-isolated-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  child.kill();
  if (child.exitCode === null) await new Promise((done) => child.once("exit", done));
  const target = resolve(directory);
  const prefix = resolve(tmpdir(), "radar-progress-browser-");
  if (!target.startsWith(prefix)) throw new Error("Unexpected temporary directory");
  rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
