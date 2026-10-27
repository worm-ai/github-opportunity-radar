// Real read-only snapshots served behind an isolated preview; running/failure
// states exist only in this browser. No production writes or model calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { chromium } from "@playwright/test";
import { opportunityReport } from "../apps/server/dist/reports.js";

const production = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4317";
const web = resolve(process.env.RADAR_TEST_WEB_DIR || ".data/history-preview");
const read = async (path) => {
  const response = await fetch(`${production}/api/v1${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
};
const [dashboard, integrations, current, runs] = await Promise.all(["/dashboard", "/integrations", "/opportunities", "/analysis/runs"].map(read));
const db = new DatabaseSync(resolve(".data/opportunity-radar.sqlite"), { readOnly: true });
let rows;
try { rows = db.prepare("SELECT id,superseded_at FROM opportunities WHERE analysis_version=2 AND status='candidate' AND superseded_at IS NOT NULL ORDER BY superseded_at DESC,updated_at DESC,id").all(); }
finally { db.close(); }
const history = await Promise.all(rows.map(async (row) => ({ ...await read(`/opportunities/${row.id}`), status: "candidate", supersededAt: row.superseded_at })));
assert.ok(history.length, "The actual workspace must contain a historical candidate");
assert.ok(current.length, "Test latest-empty summary while another research scope survives");
assert.ok(history.every((item) => !current.some((active) => active.id === item.id)));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET") { response.writeHead(405); response.end(); return; }
    const pathname = new URL(request.url, "http://preview").pathname;
    if (pathname.startsWith("/api/")) {
      const upstream = await fetch(`${production}${request.url}`);
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" });
      response.end(Buffer.from(await upstream.arrayBuffer())); return;
    }
    let file = resolve(web, `.${decodeURIComponent(pathname)}`);
    if (file !== web && !file.startsWith(web + sep)) { response.writeHead(400); response.end(); return; }
    if (!existsSync(file) || !statSync(file).isFile()) file = resolve(web, "index.html");
    response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    response.end(readFileSync(file));
  } catch { response.writeHead(500); response.end("Preview request failed"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [], writes = [], checks = [];
let running = false, historyFailed = false, latestFailed = false;
mkdirSync(".data/browser", { recursive: true });
mkdirSync(".data/research", { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, base, "Only local preview requests are allowed");
    if (request.method() !== "GET") { writes.push(`${request.method()} ${url.pathname}`); return route.abort(); }
    const lastRun = { ...runs[0], status: running ? "running" : latestFailed ? "failed" : "succeeded", opportunities: 0, rejected: 0, error: latestFailed ? "Isolated fixture: review unavailable" : null };
    if (url.pathname === "/api/v1/dashboard") return route.fulfill({ json: { ...dashboard, lastScan: { ...dashboard.lastScan, status: "succeeded" }, analysis: { ...dashboard.analysis, running, lastRun } } });
    if (url.pathname === "/api/v1/integrations") return route.fulfill({ json: { ...integrations, analysis: { ...integrations.analysis, running, lastRun } } });
    if (url.pathname === "/api/v1/opportunities") return route.fulfill(url.searchParams.get("view") === "history" ? historyFailed ? { status: 503, json: { error: { message: "Isolated fixture: history unavailable" } } } : { json: history } : { json: current });
    const historical = history.find((item) => url.pathname === `/api/v1/opportunities/${item.id}` || url.pathname === `/api/v1/opportunities/${item.id}/report.md`);
    if (historical) return url.pathname.endsWith("report.md")
      ? route.fulfill({ body: opportunityReport(historical), headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": 'attachment; filename="opportunity-validation.md"' } })
      : route.fulfill({ json: historical });
    return route.continue();
  });
  for (const viewport of [{ width: 1440, height: 1050 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${base}/opportunities`);
    const summary = page.getByRole("status", { name: "最近分析结果" });
    await summary.getByText("最近一次分析保留 0 个候选", { exact: true }).waitFor();
    await page.locator(".opportunity-list .opportunity-row").first().waitFor();
    assert.equal(await page.locator(".opportunity-list .opportunity-row").count(), current.length);
    await page.getByRole("button", { name: "历史候选", exact: true }).click();
    await page.getByText("历史候选 · 需重新核查", { exact: true }).first().waitFor();
    assert.equal(await page.locator(".opportunity-list .opportunity-row").count(), history.length);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `.data/browser/opportunity-history-${viewport.width}.png` });
    await page.locator(".opportunity-list .opportunity-row").first().click();
    await page.getByRole("status", { name: "历史候选说明" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "收藏假设", exact: true }).isEnabled(), true);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "导出完整验证方案" }).click();
    const download = await downloadPromise;
    const output = `.data/browser/historical-opportunity-${viewport.width}.md`;
    await download.saveAs(output);
    assert.match(readFileSync(output, "utf8"), /历史候选[\s\S]*不表示假设已被证伪/);
    checks.push({ viewport, currentCount: current.length, historyCount: history.length, historyDetails: true, historicalExport: true, overflow: false });
    running = true;
    await page.goto(`${base}/projects`);
    const banner = page.locator(".scan-banner");
    await banner.getByText("正在分析已有项目", { exact: false }).waitFor();
    await page.locator(".repo-name").first().waitFor();
    assert.equal(await page.getByRole("button", { name: "开始扫描", exact: true }).isDisabled(), true);
    await banner.getByRole("link", { name: "查看分析进度" }).click();
    await page.getByRole("heading", { name: "运行轨迹", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    checks.push({ viewport, completedCollectionWhileAnalysisRuns: true, projectEvidenceReadable: true, concurrentScanDisabled: true });
    running = false;
  }
  latestFailed = true;
  await page.goto(`${base}/opportunities`);
  await page.getByRole("status", { name: "最近分析结果" }).getByText("最近一次分析未完成", { exact: true }).waitFor();
  await page.locator(".opportunity-list .opportunity-row").first().waitFor();
  historyFailed = true;
  await page.getByRole("button", { name: "历史候选", exact: true }).click();
  await page.locator(".opportunity-list .form-error").getByText("Isolated fixture: history unavailable").waitFor();
  assert.equal(await page.getByText("暂无历史候选", { exact: true }).count(), 0);
  checks.push({ latestFailureVisibleWithOtherCandidates: true, unavailableHistoryNotEmpty: true });
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  assert.deepEqual((await read("/analysis/runs")).map((run) => run.id), runs.map((run) => run.id));
  assert.deepEqual((await read("/opportunities")).map((item) => item.id), current.map((item) => item.id));
  const result = { observedAt: new Date().toISOString(), source: "actual read-only workspace snapshots; running/failure states are isolated browser fixtures", checks, pageErrors: errors, productionWrites: writes, newModelCalls: 0 };
  writeFileSync(".data/research/opportunity-history-verification.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
