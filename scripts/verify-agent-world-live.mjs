import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = "http://127.0.0.1:4340";
const api = `${base}/api/v1`;
const demandId = "88f93fcf-f102-466b-960b-cc53e4978d63";
const experimentId = "agent-world-adaptation-2026-10-23";
const output = ".data/verification/agent-world-adaptation-20261026";
mkdirSync(output, { recursive: true });

const get = async path => {
  const response = await fetch(`${api}/${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
};
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

const [beforeRun, beforeNotes, archive, ready] = await Promise.all([
  get(`demands/${demandId}`),
  get("research-notes"),
  get("experiments"),
  get("health/ready"),
]);
assert.equal(ready.ready, true);
assert.deepEqual(archive.warnings, []);
const record = archive.records.find(item => item.id === experimentId);
assert.ok(record);
assert.equal(record.sources[0].repository, "sbenodiz/agent-world");
assert.equal(record.sources[0].commit, "13d62dbdeeca07c7b5bb3b8aa264ca9834b01882");
assert.equal(record.checks.filter(item => item.outcome === "supported").length, 9);
assert.equal(record.artifacts.length, 16);

const artifactHashes = [];
for (const artifact of record.artifacts) {
  const response = await fetch(`${api}/experiments/${experimentId}/artifacts/${encodeURIComponent(artifact.name)}`);
  assert.equal(response.status, 200, artifact.name);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(digest(bytes), artifact.sha256, artifact.name);
  artifactHashes.push({ name: artifact.name, sha256: artifact.sha256 });
}

const errors = [];
const writes = [];
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(`${base}/research?run=${demandId}`);
  const evidence = page.getByRole("region", { name: "相关人工实测", exact: true });
  await evidence.getByText(record.title, { exact: true }).waitFor();
  await evidence.getByText(record.conclusion, { exact: false }).waitFor();
  await evidence.getByText(record.nextAction, { exact: false }).waitFor();
  const subject = evidence.locator(".demand-experiment").filter({ has: page.getByRole("heading", { name: record.title, exact: true }) });
  await subject.waitFor();

  const exportEvent = page.waitForEvent("download");
  await evidence.getByRole("button", { name: "导出研究与补充实测", exact: true }).click();
  const exportDownload = await exportEvent;
  const bundlePath = `${output}/bundle.json`;
  await exportDownload.saveAs(bundlePath);
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  assert.deepEqual(bundle.run, beforeRun);
  assert.deepEqual(bundle.experiments.find(item => item.record.id === experimentId).record, record);

  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    await page.setViewportSize({ width, height });
    await evidence.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  }

  await subject.getByRole("link", { name: "查看原始实测与产物下载", exact: true }).click();
  await page.waitForURL(`**/experiments#experiment-${experimentId}`);
  await page.locator(`#experiment-${experimentId}`).getByText(record.conclusion, { exact: true }).waitFor();
  await page.reload();
  await page.locator(`#experiment-${experimentId}`).getByText(record.conclusion, { exact: true }).waitFor();
  await context.close();
} finally {
  await browser.close();
}

const afterRun = await get(`demands/${demandId}`);
const afterNotes = await get("research-notes");
assert.deepEqual(afterRun, beforeRun);
assert.deepEqual(afterNotes, beforeNotes);
assert.deepEqual(errors, []);
assert.deepEqual(writes, []);

const receipt = {
  verifiedAt: new Date().toISOString(),
  service: base,
  demandId,
  experimentId,
  experimentExecutedAt: record.executedAt,
  runtimeRun: {
    status: "succeeded",
    subprocesses: 27,
    agents: 3,
    ticks: 30,
    decisions: 90,
    checkpointReloadEqual: true,
    resumedTrajectoryEqual: true,
    queuedEventsRestored: true,
    supportedChecks: 9,
  },
  artifacts: artifactHashes,
  browser: { desktopMobileOverflow: false, errors, writes, exportRoundTrip: true, deepLinkReload: true },
  historicalDemandAndNotesUnchanged: true,
  boundary: "本地改造核心与确定性规则的真实运行证据；不等于未修改上游、完整 Web/MCP、外部 LLM、Godot 图形或独立用户收益验收。",
};
writeFileSync(`${output}/browser.json`, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
