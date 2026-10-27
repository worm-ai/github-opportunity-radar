import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4318';
const id = 'stanford-state-recovery-2026-10-24';
const runId = '86de1f5b-45a6-40d9-b01c-122a1d20bb36';
const unrelatedId = 'd79a1f02-17c8-4d6d-bf02-1be4e122452f';
const output = '.data/browser/stanford-state-recovery';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const get = async path => {
  const response = await fetch(`${base}/api/v1/${path}`);
  assert.equal(response.status, 200);
  return response.json();
};
mkdirSync(output, { recursive: true });
const [run, unrelated, notes, archive, sources, unrelatedSources] = await Promise.all([
  get(`demands/${runId}`), get(`demands/${unrelatedId}`), get('research-notes'), get('experiments'),
  get(`demands/${runId}/note-sources`), get(`demands/${unrelatedId}/note-sources`),
]);
assert.deepEqual(archive.warnings, []);
const record = archive.records.find(item => item.id === id);
assert.ok(record);
assert.deepEqual(record.projectIds, ['669727723']);
assert.equal(record.sources[0].repository, 'joonspk-research/generative_agents');
assert.equal(record.sources[0].modification, undefined);
assert.equal(record.artifacts.length, 5);
assert.ok(sources.sources.some(item => item.ref?.experimentId === id && item.ref.projectId === '669727723' && item.text.includes(record.conclusion)));
assert.equal(unrelatedSources.sources.some(item => item.ref?.experimentId === id), false);
for (const artifact of record.artifacts) {
  const response = await fetch(`${base}/api/v1/experiments/${id}/artifacts/${artifact.name}`);
  assert.equal(response.status, 200);
  assert.equal(sha(Buffer.from(await response.arrayBuffer())), artifact.sha256);
}
const errors = [], writes = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method() + ' ' + request.url()); });
  await page.goto(`${base}/research?run=${runId}`);
  const evidence = page.getByRole('region', { name: '相关人工实测', exact: true });
  const subject = evidence.locator('.demand-experiment').filter({ has: page.getByRole('heading', { name: record.title, exact: true }) });
  await subject.getByText(record.conclusion, { exact: false }).waitFor();
  await subject.getByText(record.nextAction, { exact: false }).waitFor();
  assert.equal(await subject.getByText('本地改造版', { exact: false }).count(), 0);
  await subject.locator('summary').click();
  for (const label of ['空行动时间的保存语义', '空行动时间的载入语义', '记忆最近访问时间持久化']) {
    await subject.getByText('反驳 · ' + label, { exact: true }).waitFor();
  }
  const bundleEvent = page.waitForEvent('download');
  await evidence.getByRole('button', { name: '导出研究与补充实测', exact: true }).click();
  await (await bundleEvent).saveAs(`${output}/bundle.json`);
  const bundle = JSON.parse(readFileSync(`${output}/bundle.json`, 'utf8'));
  assert.deepEqual(bundle.run, run);
  assert.deepEqual(bundle.experiments.find(item => item.record.id === id).record, record);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await subject.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  }
  await subject.getByRole('link', { name: '查看原始实测与产物下载', exact: true }).click();
  await page.waitForURL(`**/experiments#experiment-${id}`);
  await page.reload();
  const article = page.locator(`#experiment-${id}`);
  await article.getByText(record.conclusion, { exact: true }).waitFor();
  assert.equal(await article.getByText('本地改造版', { exact: false }).count(), 0);
  await article.getByText('版本、环境与产物下载', { exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await article.getByRole('link', { name: record.artifacts[0].label, exact: true }).click();
  await (await downloadEvent).saveAs(`${output}/results.json`);
  assert.equal(sha(readFileSync(`${output}/results.json`)), record.artifacts[0].sha256);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.goto(`${base}/research?run=${unrelatedId}`);
  await page.getByRole('region', { name: '相关人工实测', exact: true }).waitFor();
  await page.getByRole('heading', { name: '社会模拟选型：agent-world 真实服务入口的一致性反证', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: record.title, exact: true }).count(), 0);
  assert.deepEqual(await get(`demands/${runId}`), run);
  assert.deepEqual(await get(`demands/${unrelatedId}`), unrelated);
  assert.deepEqual(await get('research-notes'), notes);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  const receipt = { verifiedAt: new Date().toISOString(), experimentId: id, runId, artifacts: record.artifacts.length, correctRepositoryOnly: true, upstreamModified: false, counterEvidenceVisible: true, historicalDemandAndNotesUnchanged: true, desktopMobileOverflow: false, errors, writes };
  writeFileSync(`${output}/verification.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally { await browser.close(); }
