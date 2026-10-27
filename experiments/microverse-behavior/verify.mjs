import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4318', id = 'microverse-behavior-2026-10-23';
const runId = 'd79a1f02-17c8-4d6d-bf02-1be4e122452f';
const output = '.data/browser/microverse-behavior';
mkdirSync(output, { recursive: true });
async function get(path) {
  const response = await fetch(`${base}/api/v1/${path}`);
  assert.equal(response.status, 200);
  return response.json();
}
const archive = await get('experiments'), originalRun = await get(`demands/${runId}`);
assert.deepEqual(archive.warnings, []);
const record = archive.records.find(item => item.id === id);
assert.ok(record);
for (const artifact of record.artifacts) {
  const response = await fetch(`${base}/api/v1/experiments/${id}/artifacts/${artifact.name}`);
  assert.equal(response.status, 200);
  assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), artifact.sha256);
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], writes = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url()); });
  await page.goto(`${base}/research?run=${runId}`);
  const region = page.getByRole('region', { name: '相关人工实测', exact: true });
  await region.getByRole('heading', { name: record.title, exact: true }).waitFor();
  await region.getByText('KsanaDock/Microverse · 已读源码与实测提交相同', { exact: true }).waitFor();
  await region.getByText(record.conclusion, { exact: false }).waitFor();
  await region.locator('.demand-experiment').filter({ has: page.getByRole('heading', { name: record.title, exact: true }) }).getByRole('link', { name: '查看原始实测与产物下载', exact: true }).click();
  await page.waitForURL(`**/experiments#experiment-${id}`);
  const article = page.locator(`#experiment-${id}`);
  await article.getByRole('heading', { name: record.title, exact: true }).waitFor();
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await article.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  }
  assert.deepEqual(await get(`demands/${runId}`), originalRun);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const verification = { id, runId, artifactsVerified: record.artifacts.length, historicalRunUnchanged: true, errors, writes, observedAt: new Date().toISOString() };
  writeFileSync(`${output}/verification.json`, JSON.stringify(verification, null, 2));
  console.log(JSON.stringify(verification));
} finally { await browser.close(); }
