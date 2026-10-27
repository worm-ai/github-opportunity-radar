import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4318';
const runId = 'd79a1f02-17c8-4d6d-bf02-1be4e122452f';
const parentId = '06fffe22-dc24-4182-bed7-1cc70f60e1c5';
const experimentId = 'agent-world-behavior-2026-10-23';
const output = '.data/browser/demand-experiments';
mkdirSync(output, { recursive: true });
async function get(path) { const response = await fetch(`${base}/api/v1/${path}`); assert.equal(response.status, 200); return response.json(); }
const [run, parent, archive] = await Promise.all([get(`demands/${runId}`), get(`demands/${parentId}`), get('experiments')]);
const experiment = archive.records.find(record => record.id === experimentId);
assert.ok(experiment);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], writes = [], cases = [];
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(); watch(page);
  await page.goto(`${base}/research?run=${runId}`);
  const evidence = page.getByRole('region', { name: '相关人工实测', exact: true });
  await evidence.getByText('sbenodiz/agent-world · 已读源码与实测提交相同', { exact: true }).waitFor();
  await evidence.getByText(experiment.conclusion, { exact: false }).waitFor();
  await evidence.getByText(experiment.nextAction, { exact: false }).waitFor();
  const downloadEvent = page.waitForEvent('download');
  await evidence.getByRole('button', { name: '导出研究与补充实测', exact: true }).click();
  const download = await downloadEvent;
  const downloadPath = `${output}/bundle.json`; await download.saveAs(downloadPath);
  const bundle = JSON.parse(readFileSync(downloadPath, 'utf8'));
  assert.deepEqual(bundle.run, run);
  const bundledExperiment = bundle.experiments.find(item => item.record.id === experimentId);
  assert.deepEqual(bundledExperiment.record, experiment);
  assert.equal(bundledExperiment.repositories[0].version, 'same');
  assert.ok(Date.parse(bundle.retrievedAt));
  const originalHref = await page.getByRole('link', { name: '导出完整材料', exact: true }).getAttribute('href');
  assert.equal(originalHref, `/api/v1/demands/${runId}/report.json`);
  const originalResponse = await fetch(`${base}${originalHref}`); assert.equal(originalResponse.status, 200);
  const original = await originalResponse.json();
  assert.equal(JSON.stringify(original).includes('demand-with-manual-experiments-v1'), false);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await evidence.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  }
  await evidence.locator('.demand-experiment').filter({ has: page.getByRole('heading', { name: experiment.title, exact: true }) }).getByRole('link', { name: '查看原始实测与产物下载', exact: true }).click();
  await page.waitForURL(`**/experiments#experiment-${experimentId}`);
  const article = page.locator(`#experiment-${experimentId}`);
  await article.waitFor();
  await page.waitForFunction(id => { const r = document.getElementById(id)?.getBoundingClientRect(); return r && r.top >= 0 && r.top < innerHeight; }, `experiment-${experimentId}`);
  await page.reload();
  await page.waitForFunction(id => { const r = document.getElementById(id)?.getBoundingClientRect(); return r && r.top >= 0 && r.top < innerHeight; }, `experiment-${experimentId}`);
  cases.push('real pinned run, separate bundle and original export, desktop/mobile, deep link and reload');
  await page.goto(`${base}/research?run=${parentId}`);
  await evidence.getByText('sbenodiz/agent-world · 研究未固定可核对的源码提交', { exact: true }).waitFor();
  cases.push('real README-only parent remains version unknown');
  await context.close();

  async function fixture(name, change, expected, failure = false) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(); watch(page);
    const data = structuredClone(archive);
    // Isolate the subject of each adversarial fixture from other valid archives.
    data.records = data.records.filter(record => record.id === experimentId);
    change(data);
    await page.route('**/api/v1/experiments', route => route.fulfill({ status: failure ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failure ? { error: { message: 'fixture unavailable' } } : data) }));
    await page.goto(`${base}/research?run=${runId}`);
    const region = page.getByRole('region', { name: '相关人工实测', exact: true });
    await region.getByText(expected, { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (failure || !data.records.length) assert.equal(await region.getByRole('button', { name: '导出研究与补充实测' }).count(), 0);
    cases.push(name); await context.close();
  }
  await fixture('different commit does not appear verified', data => { data.records[0].sources[0].commit = 'f'.repeat(40); }, '已读源码与实测提交不同');
  await fixture('partial multi-repository experiment keeps other component explicit', data => { data.records[0].sources.push({ repository: 'other/component', commit: 'e'.repeat(40) }); }, '实验还涉及本次研究未匹配的仓库：other/component');
  await fixture('wrong repository cannot match via project ID', data => { data.records[0].sources[0].repository = 'other/repo'; }, '没有同仓库实测');
  await fixture('incomplete archive warning is visible', data => { data.records = []; data.warnings = ['归档校验失败，夹具']; }, '归档校验失败，夹具');
  await fixture('unavailable service remains unknown', () => {}, '实测归档读取失败，不能判断是否存在相关实验。', true);
  assert.deepEqual(await get(`demands/${runId}`), run);
  assert.deepEqual(await get(`demands/${parentId}`), parent);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const receipt = { observedAt: new Date().toISOString(), runId, parentId, experimentId, cases, errors, writes, historicalRunsUnchanged: true, bundleSha256: createHash('sha256').update(readFileSync(downloadPath)).digest('hex') };
  writeFileSync(`${output}/verification.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} finally { await browser.close(); }
