// Read-only service verification after a blocked release. Does not restart.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const output = '.data/experiments/demand-gap-search-2026-10-23T08-01-27-349Z';
const original = JSON.parse(readFileSync(`${output}/original-stage-provenance.json`, 'utf8'));
const services = [];
for (const port of [4317, 4318]) {
  const base = `http://127.0.0.1:${port}`;
  const readyResponse = await fetch(`${base}/api/v1/health/ready`);
  assert.equal(readyResponse.status, 200);
  const ready = await readyResponse.json();
  assert.ok(ready.ready && ready.engineState === 'connected');
  const featureResponse = await fetch(`${base}/api/v1/demands/features`);
  const features = featureResponse.ok ? await featureResponse.json() : null;
  assert.notEqual(features?.researchVersion, 'demand-research-v2', 'Release was blocked; do not claim code is loaded');
  services.push({ port, ready: ready.ready, engineState: ready.engineState, features, featureStatus: featureResponse.status });
}
const base = 'http://127.0.0.1:4318';
const task = await (await fetch(`${base}/api/v1/demands/${original.taskId}`)).json();
assert.equal(createHash('sha256').update(JSON.stringify(task.snapshot)).digest('hex'), original.snapshotHash);
const history = await (await fetch(`${base}/api/v1/demands`)).json();
assert.equal(history.length, 8);
assert.ok(!history.some(run => run.status === 'running'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], writes = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url()); });
  await page.goto(`${base}/research?run=${task.id}`);
  await page.locator('.demand-result-heading').waitFor();
  assert.equal(await page.locator('.demand-result-heading h2').innerText(), task.question);
  await page.getByRole('button', { name: '导出离线交接简报', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/existing-service.png` });
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
} finally { await browser.close(); }
const receipt = { observedAt: new Date().toISOString(), services, savedTaskUnchanged: true, savedTaskCount: history.length, errors, writes, deployment: 'blocked; running services retain previously loaded backend' };
writeFileSync(`${output}/release-status.json`, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
