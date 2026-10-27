import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { explainAnalysisOutcome } from '../packages/contracts/dist/analysis-outcome.js';
import { researchReport } from '../apps/server/dist/reports.js';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.RADAR_BROWSER_URL || 'http://127.0.0.1:4317';
const baseline = await (await fetch(`${base}/api/v1/integrations`)).json();
assert.ok(baseline.analysis.lastRun, 'This browser regression needs one existing run as a response template');
const template = { ...baseline.analysis.lastRun, model: baseline.analysis.model, status: 'succeeded', error: null, reusedFrom: null, usage: null };
const cases = [
  { name: 'empty-proposals', candidateAudits: [], selection: template.selection, rejected: 0 },
  { name: 'empty-selection', candidateAudits: [], selection: { catalogProjects: 165, groups: [], skipped: [] }, rejected: 0 },
  { name: 'legacy-missing', candidateAudits: null, selection: null, rejected: 0 },
  { name: 'legacy-counted', candidateAudits: null, selection: null, rejected: 2 },
  { name: 'rejected', candidateAudits: [{ index: 0, proposal: { title: 'Fixture only' }, evidenceStatus: 'evidence_failed', review: null }], selection: null, rejected: 1 },
  { name: 'failed', candidateAudits: null, selection: null, rejected: 0, status: 'failed', error: 'Fixture failure' },
  { name: 'cached', candidateAudits: [], selection: template.selection, rejected: 0, reusedFrom: 'fixture-cache-source' },
];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], writes = [], checked = [];
try {
  for (const fixture of cases) {
    const run = { ...template, opportunities: 0, decisions: [], ...fixture };
    const outcome = explainAnalysisOutcome(run);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.method() + ' ' + request.url());
    });
    await page.route('**/api/v1/**', route => {
      if (route.request().method() !== 'GET') return route.abort('blockedbyclient');
      return route.continue();
    });
    await page.route('**/api/v1/integrations', route => route.fulfill({ json: { ...baseline, analysis: { ...baseline.analysis, state: 'configured', running: false, lastRun: run } } }));
    await page.route('**/api/v1/opportunities', route => route.fulfill({ json: [] }));
    await page.route('**/api/v1/analysis/runs', route => route.fulfill({ json: [run] }));
    await page.goto(base);
    await page.waitForFunction(label => document.querySelector('.research-brief h2')?.textContent === label, outcome.label);
    await page.goto(`${base}/opportunities`);
    await page.waitForFunction(label => document.querySelector('.opportunity-list .empty-state h3')?.textContent === label, outcome.label);
    assert.ok((await page.locator('.analysis-summary').innerText()).includes(outcome.detail));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, fixture.name);
    await page.goto(`${base}/activity`);
    await page.locator('.analysis-record').first().waitFor();
    const record = page.locator('.analysis-record').first();
    await record.locator('summary').first().click();
    assert.ok((await record.innerText()).includes(outcome.detail));
    const report = researchReport({ scan: null, analysis: run, drafts: [], projectCount: 165, issueCount: 357 });
    assert.ok(report.includes(`结果解释：${outcome.label}；${outcome.detail}`));
    await page.goto(base + '/settings');
    const service = page.getByRole('region', { name: '执行与分析服务', exact: true });
    const settingsOutcome = service.locator('.analysis-service-outcome');
    await settingsOutcome.waitFor();
    assert.ok((await settingsOutcome.innerText()).includes(outcome.label));
    assert.ok((await settingsOutcome.innerText()).includes(outcome.detail));
    const serviceText = await service.innerText();
    assert.equal(serviceText.includes('审查或引用校验拒绝'), false, 'Counters alone do not establish a review verdict');
    assert.equal(serviceText.includes('已完成真实模型分析'), false, 'A cached or historical completion must not claim a new real model execution');
    if (fixture.name === 'cached') {
      assert.ok(serviceText.includes('最近同模型分析复用历史结果'));
      assert.ok(serviceText.includes('本次未调用模型'));
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, fixture.name + ' settings');
    mkdirSync('.data/browser', { recursive: true });
    if (['legacy-counted', 'cached'].includes(fixture.name)) await page.screenshot({ path: '.data/browser/settings-outcome-' + fixture.name + '-mobile.png', fullPage: true });
    checked.push({ fixture: fixture.name, label: outcome.label, settings: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  const result = { source: 'browser_response_fixtures', checked, errors, writes, mobileOverflow: false, productionMutations: 0, newModelRequests: 0 };
  writeFileSync('.data/browser/analysis-outcomes-verification.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
