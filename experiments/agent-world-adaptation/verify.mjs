import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4318';
const runId = 'd79a1f02-17c8-4d6d-bf02-1be4e122452f';
const parentId = '06fffe22-dc24-4182-bed7-1cc70f60e1c5';
const id = 'agent-world-adaptation-2026-10-23';
const originalId = 'agent-world-behavior-2026-10-23';
const output = '.data/browser/agent-world-adaptation';
mkdirSync(output, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function get(path) {
  const response = await fetch(`${base}/api/v1/${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
}
const [run, parent, archive, notes] = await Promise.all([
  get(`demands/${runId}`), get(`demands/${parentId}`), get('experiments'), get(`demands/${runId}/note-sources`),
]);
assert.deepEqual(archive.warnings, []);
const experiment = archive.records.find(record => record.id === id);
assert.ok(experiment);
const modification = experiment.sources[0].modification;
assert.ok(modification);
assert.equal(experiment.artifacts.length, 16);
const artifacts = [];
for (const artifact of experiment.artifacts) {
  const response = await fetch(`${base}/api/v1/experiments/${id}/artifacts/${artifact.name}`);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(sha(bytes), artifact.sha256);
  artifacts.push({ name: artifact.name, sha256: artifact.sha256 });
}
const citation = notes.sources.find(source => source.ref?.experimentId === id);
assert.ok(citation);
for (const text of ['本地改造版', '仅为上游基线', modification.sha256, experiment.sources[0].commit]) assert.ok(citation.notice.includes(text));
const errors = [], writes = [], cases = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  await page.goto(`${base}/research?run=${runId}`);
  const evidence = page.getByRole('region', { name: '相关人工实测', exact: true });
  const subject = evidence.locator('.demand-experiment').filter({ has: page.getByRole('heading', { name: experiment.title, exact: true }) });
  await subject.getByText('sbenodiz/agent-world · 本地改造版 · 上游提交仅为基线', { exact: true }).waitFor();
  await evidence.getByText('sbenodiz/agent-world · 已读源码与实测提交相同', { exact: true }).waitFor();
  await subject.getByText(modification.description, { exact: false }).waitFor();
  const modificationEvent = page.waitForEvent('download');
  await subject.getByRole('link', { name: '下载改造代码与补丁', exact: true }).click();
  await (await modificationEvent).saveAs(`${output}/adaptation.json`);
  assert.equal(sha(readFileSync(`${output}/adaptation.json`)), modification.sha256);
  const patch = JSON.parse(readFileSync(`${output}/adaptation.json`, 'utf8'));
  assert.ok(patch.upstreamPatch.includes('WorldCheckpoint'));
  assert.ok(patch.adapter.includes('class AdaptedWorld'));
  cases.push('research distinguishes local adaptation and unmodified baseline; UI patch download verified');
  const bundleEvent = page.waitForEvent('download');
  await evidence.getByRole('button', { name: '导出研究与补充实测', exact: true }).click();
  await (await bundleEvent).saveAs(`${output}/bundle.json`);
  const bundle = JSON.parse(readFileSync(`${output}/bundle.json`, 'utf8'));
  assert.deepEqual(bundle.run, run);
  const bundled = bundle.experiments.find(item => item.record.id === id);
  assert.deepEqual(bundled.record, experiment);
  assert.equal(bundled.repositories[0].version, 'adapted');
  assert.deepEqual(bundled.repositories[0].modification, modification);
  assert.equal(bundle.experiments.find(item => item.record.id === originalId).repositories[0].version, 'same');
  assert.equal(await page.getByRole('link', { name: '导出完整材料', exact: true }).getAttribute('href'), `/api/v1/demands/${runId}/report.json`);
  const reportBefore = await get(`demands/${runId}/report.json`);
  assert.equal(JSON.stringify(reportBefore).includes(id), false);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await subject.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  }
  await subject.getByRole('link', { name: '查看原始实测与产物下载', exact: true }).click();
  await page.waitForURL(`**/experiments#experiment-${id}`);
  const article = page.locator(`#experiment-${id}`);
  await article.getByText('本地改造版 · 上游提交仅为基线：', { exact: true }).waitFor();
  await page.reload();
  await article.getByText(modification.description, { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/experiment-mobile.png`, fullPage: true });
  cases.push('separate bundle retains adapted identity; original export unchanged; deep link/reload and desktop/mobile layouts');
  assert.deepEqual(await get(`demands/${runId}`), run);
  assert.deepEqual(await get(`demands/${parentId}`), parent);
  assert.deepEqual(await get(`demands/${runId}/report.json`), reportBefore);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const receipt = { observedAt: new Date().toISOString(), runId, parentId, experimentId: id, cases, artifacts, modification, historicalRunsUnchanged: true, errors, writes };
  writeFileSync(`${output}/verification.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} finally { await browser.close(); }
