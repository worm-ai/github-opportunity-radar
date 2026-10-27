// Real workspace operation: explicitly follows three collected repositories via Edge.
// It makes real GitHub requests through the running service, never submits analysis.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4317';
const ids = ['1423935509', '1375382253', '1418250230'];
async function read(path) {
  const response = await fetch(`${base}/api/v1${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
}
function databaseState() {
  const db = new DatabaseSync('.data/opportunity-radar.sqlite', { readOnly: true });
  try {
    const counts = {};
    for (const table of ['projects', 'signals', 'project_observations', 'research_notes', 'analysis_runs', 'job_runs']) {
      counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    }
    return { schema: db.prepare('PRAGMA user_version').get().user_version, integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, counts };
  } finally { db.close(); }
}
const startedAt = new Date().toISOString();
const before = { dashboard: await read('/dashboard'), integration: await read('/integrations'), monitoring: await read('/monitoring'), database: databaseState() };
assert.ok(ids.every(id => !before.monitoring.items.some(item => item.projectId === id)), 'Initial monitors are already enabled; inspect the saved report or use the UI instead of replaying this rollout.');
assert.equal(before.integration.runtime, 'iii');
assert.equal(before.integration.engineState, 'connected');
assert.equal(before.integration.github.tokenConfigured, true);
assert.equal(before.integration.analysis.running, false);
assert.equal(before.integration.evidence.running, false);
const projectsBefore = await Promise.all(ids.map(id => read(`/projects/${id}`)));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/v1/**', route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (request.method() !== 'GET') {
    assert.ok(request.method() === 'PUT' && ids.some(id => path === `/api/v1/projects/${id}/monitor`), `Unexpected production write ${request.method()} ${path}`);
    writes.push(`${request.method()} ${path}`);
  }
  return route.continue();
});
try {
  for (const id of ids) {
    await page.goto(`${base}/projects/${id}`);
    const checkbox = page.getByRole('region', { name: '项目持续关注', exact: true }).getByLabel('持续关注此项目', { exact: true });
    await checkbox.waitFor();
    if (!await checkbox.isChecked()) {
      const response = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/projects/${id}/monitor`));
      await checkbox.check(); assert.equal((await response).status(), 200);
    }
  }
  console.log(JSON.stringify({ stage: 'enabled-via-browser', repositories: projectsBefore.map(item => item.fullName), writes }));
  let monitors;
  for (let attempt = 0; attempt < 100; attempt++) {
    monitors = (await read('/monitoring')).items.filter(item => ids.includes(item.projectId));
    if (monitors.length === 3 && monitors.every(item => item.lastFinishedAt && item.lastFinishedAt >= startedAt && item.status !== 'running')) break;
    if (attempt % 8 === 0) console.log(JSON.stringify({ stage: 'waiting-for-real-scheduler', states: monitors.map(item => ({ name: item.fullName, status: item.status })) }));
    await new Promise(done => setTimeout(done, 2000));
  }
  assert.equal(monitors.length, 3);
  for (const monitor of monitors) {
    assert.equal(monitor.enabled, true);
    assert.equal(monitor.status, 'succeeded', JSON.stringify(monitor));
    assert.ok(monitor.lastSuccessAt >= startedAt);
  }
  const after = { dashboard: await read('/dashboard'), integration: await read('/integrations'), monitoring: await read('/monitoring'), database: databaseState() };
  assert.equal(after.dashboard.lastScan.id, before.dashboard.lastScan.id);
  assert.equal(after.integration.analysis.lastRun.id, before.integration.analysis.lastRun.id);
  for (const table of ['projects', 'analysis_runs', 'job_runs', 'research_notes']) assert.equal(after.database.counts[table], before.database.counts[table], table);
  assert.equal(after.database.counts.project_observations, before.database.counts.project_observations + 3);
  assert.ok(after.integration.completedExecutions >= before.integration.completedExecutions + 3);
  assert.equal(after.database.integrity, 'ok'); assert.equal(after.database.schema, 11);
  const projectsAfter = await Promise.all(ids.map(id => read(`/projects/${id}`)));
  mkdirSync('.data/browser', { recursive: true });
  await page.goto(base);
  for (const id of ids) await page.locator(`[data-monitor-id="${id}"]`).getByText('已检查', { exact: false }).waitFor();
  await page.getByRole('region', { name: '持续关注动态', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.data/browser/monitoring-real-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.data/browser/monitoring-real-mobile.png' });
  assert.deepEqual(errors, []);
  const result = { startedAt, finishedAt: new Date().toISOString(), realGitHub: true, realEngine: true, explicitlyEnabledByAgent: true, before, after, projectsBefore, projectsAfter, writes, pageErrors: errors, modelCalls: 0 };
  writeFileSync('.data/browser/monitoring-production.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, monitors, before: before.database, after: after.database, completedExecutions: after.integration.completedExecutions, modelCalls: 0, pageErrors: errors }));
} finally { await browser.close(); }
