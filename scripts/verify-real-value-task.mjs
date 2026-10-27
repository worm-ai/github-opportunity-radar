import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

// This is an assistant self-test of one concrete research task. It deliberately
// compares the normal live-GitHub route with the product's read-only local-cache
// fallback; it is not external-user evidence and must not be presented as a
// general time-saving claim.
const run = process.env.RADAR_VALUE_RUN ?? new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const base = process.env.RADAR_BROWSER_URL ?? "http://127.0.0.1:4359";
const output = `.data/verification/real-value-task-${run}`;
mkdirSync(output, { recursive: true });
const task = "为本地优先的多智能体社会模拟原型找到可复用实现，要求共享事件、持久记忆和重启恢复，并给出下一步最小验证。";

const execFileAsync = promisify(execFile);
const baselineStartedAt = new Date().toISOString();
const baselineStart = performance.now();
let baseline = { completed: false, candidates: [], error: null, stderr: "" };
try {
  const result = await execFileAsync("curl.exe", [
    "-sS", "--fail", "--max-time", "15", "-H", "Accept: application/vnd.github+json",
    "https://api.github.com/search/repositories?q=multi-agent+social+simulation&per_page=10",
  ], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  const json = JSON.parse(result.stdout);
  baseline = { completed: Array.isArray(json.items) && json.items.length > 0, candidates: (json.items ?? []).slice(0, 10).map(item => item.full_name), error: null, stderr: result.stderr ?? "" };
} catch (error) {
  baseline = { completed: false, candidates: [], error: error?.message ?? String(error), stderr: error?.stderr ?? "" };
}
const baselineMs = performance.now() - baselineStart;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
const writes = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
const assistedStart = performance.now();
let assisted;
try {
  await page.goto(`${base}/research`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("你的需求").fill(task);
  await page.getByRole("button", { name: "先查本地缓存" }).click();
  const region = page.locator('[aria-label="本地缓存候选"]');
  await region.waitFor();
  const candidates = await region.locator("li").allTextContents();
  const links = await region.locator('a[href^="https://github.com/"]').evaluateAll(elements => elements.map(element => ({ text: element.textContent?.trim() ?? "", href: element.href })));
  const body = await region.innerText();
  assert.match(body, /local_cache/);
  assert.match(body, /README 摘录/);
  assert.ok(candidates.length > 0);
  assisted = { completed: true, candidates, links, evidenceExcerptVisible: true, error: null };
} catch (error) {
  assisted = { completed: false, candidates: [], links: [], evidenceExcerptVisible: false, error: error?.message ?? String(error) };
}
const assistedMs = performance.now() - assistedStart;
await page.setViewportSize({ width: 390, height: 844 });
const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
assert.equal(mobileOverflow, false);
assert.deepEqual(errors, []);
assert.deepEqual(writes, []);
await context.close();
await browser.close();

const requestId = crypto.randomUUID();
const baselineMinutes = Number((baselineMs / 60_000).toFixed(2));
const assistedMinutes = Number((assistedMs / 60_000).toFixed(2));
const measurement = {
  requestId,
  originDemandId: null,
  taskDescription: task,
  baselineMethod: "直接使用 GitHub API 搜索；本机 TLS/网络预检失败时记录失败",
  assistedMethod: "在 /research 使用只读本地缓存线索，查看候选、GitHub 链接和 README 摘录",
  comparable: false,
  bothCompleted: baseline.completed && assisted.completed,
  timing: "measured",
  tasksCompared: 1,
  baselineMinutes,
  assistedMinutes,
  falseKeeps: null,
  missedCandidates: null,
};

const saveResponse = await fetch(`${base}/api/v1/task-measurements`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(measurement) });
assert.equal(saveResponse.status, 201);
const saved = await saveResponse.json();
const summary = {
  run,
  task,
  base,
  baseline: { ...baseline, elapsedMs: Number(baselineMs.toFixed(1)), startedAt: baselineStartedAt },
  assisted: { ...assisted, elapsedMs: Number(assistedMs.toFixed(1)) },
  measurement: { ...measurement, id: saved.id, createdAt: saved.createdAt },
  browser: { errors, writes, mobileOverflowChecked: true, mobileOverflow },
  conclusion: baseline.completed && assisted.completed
    ? "两条路径均完成；该样本不能推出普遍省时。"
    : assisted.completed
      ? "实时 GitHub 路径未完成，本地缓存路径完成了候选与证据摘录交接；这是网络故障下的可用性证据，不是可比省时证据。"
      : "两条路径均未完成。",
};
writeFileSync(`${output}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
