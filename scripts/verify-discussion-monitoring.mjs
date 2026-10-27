// Real iii transport, a local GitHub HTTP fixture, temporary SQLite, and the built Edge UI.
// Synthetic remote changes; no production writes, GitHub access, or model calls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { RadarStore } from '../packages/storage/dist/index.js';
import { createRepositorySignal, createIssueContextSignal } from '../packages/contracts/dist/index.js';
import { GitHubClient } from '../packages/sensor-github/dist/index.js';
import { createRuntimeAdapter } from '../packages/runtime/dist/index.js';
import { registerMonitoringRoutes } from '../apps/server/dist/monitoring.js';
import { buildDiscoveryBrief, discoveryProfile } from '../apps/server/dist/discovery.js';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const Fastify = require('fastify'), staticFiles = require('@fastify/static');
const directory = mkdtempSync(join(tmpdir(), 'radar-discussion-monitoring-')), dbPath = join(directory, 'test.sqlite');
const store = new RadarStore(dbPath), app = Fastify();
const runtime = createRuntimeAdapter(process.env.III_URL || 'ws://127.0.0.1:49134', `radar-discussion-${process.pid}`);
const fullName = 'fixture/monitored-component', remoteDate = '2026-10-20T00:00:00Z';
let manager, browser, closed = false, operation = null, merged = false, issueStatus = 200, clock = Date.parse(remoteDate);
const requests = [], writes = [], errors = [];
const upstream = createServer((request, response) => {
  const path = new URL(request.url, 'http://fixture').pathname; requests.push(path);
  response.setHeader('content-type', 'application/json');
  if (path === `/repos/${fullName}`) return response.end(JSON.stringify({ id: 77, full_name: fullName, html_url: `https://github.com/${fullName}`, description: 'Local CSV interfaces for business workflows', language: 'Python', private: false, license: { spdx_id: 'MIT' }, stargazers_count: 10, forks_count: 1, open_issues_count: 1, created_at: '2026-09-01T00:00:00Z', pushed_at: remoteDate }));
  if (path.endsWith('/readme')) return response.end(JSON.stringify({ encoding: 'base64', content: Buffer.from('Read local CSV inputs.').toString('base64') }));
  if (path.endsWith('/releases') || path.endsWith('/issues')) return response.end('[]');
  if (path.endsWith('/issues/7')) {
    response.statusCode = issueStatus;
    return response.end(JSON.stringify(issueStatus === 200 ? { id: 700, number: 7, title: 'Waiting for a workflow implementation', body: 'A proposed implementation is in #8.', html_url: `https://github.com/${fullName}/issues/7`, state: 'open', state_reason: null, closed_at: null, created_at: remoteDate, updated_at: remoteDate, comments: 0, reactions: { total_count: 0 }, author_association: 'NONE', user: { login: 'reporter' } } : { message: 'Not Found' }));
  }
  if (path.endsWith('/comments')) return response.end('[]');
  if (path.endsWith('/pulls/8')) return response.end(JSON.stringify({ number: 8, title: 'Implement the requested workflow', body: 'An implementation to investigate; not market evidence.', state: merged ? 'closed' : 'open', draft: false, merged, merged_at: merged ? '2026-10-21T01:00:00Z' : null, merge_commit_sha: merged ? 'a'.repeat(40) : null, updated_at: merged ? '2026-10-21T01:00:00Z' : remoteDate, base: { repo: { full_name: fullName, private: false } } }));
  response.statusCode = 404; response.end('{}');
});
async function until(check) {
  for (let index = 0; index < 180; index++) { const value = await check(); if (value) return value; await new Promise(done => setTimeout(done, 100)); }
  throw new Error('Discussion monitoring verification timed out');
}
function status() { return { runtime: runtime.mode, engineState: runtime.engineState, completedExecutions: runtime.completedExecutions, github: { tokenConfigured: false }, evidence: { running: operation !== null, projectId: null, operation }, analysis: { mode: 'deepseek', state: 'needs_api_key', model: 'fixture-only', running: false, lastRun: null } }; }
try {
  await new Promise(done => upstream.listen(0, '127.0.0.1', done)); await runtime.ready();
  const client = () => new GitHubClient({ apiBase: `http://127.0.0.1:${upstream.address().port}` });
  const repository = await client().collectRepository(fullName);
  store.saveRepository(repository, createRepositorySignal({ repositoryId: 77, ...repository }), 0, [], [], remoteDate);
  const context = { ...await client().collectIssueContext(fullName, 7), selectedForResearch: true };
  store.saveIssueContext('77', context, createIssueContextSignal('77', fullName, context));
  app.register(async api => {
    manager = registerMonitoringRoutes(api, { store, runtime, client, busy: () => operation !== null, collection: value => { operation = value; }, now: () => new Date(clock) });
    api.get('/projects', async () => store.getProjects().map(project => ({ ...project, discovery: discoveryProfile(project) })));
    api.get('/projects/:id', async request => { const project = store.getProject(request.params.id); return { ...project, discovery: discoveryProfile(project) }; });
    api.get('/projects/:id/observations', async request => store.getProjectObservations(request.params.id));
    api.get('/dashboard', async () => ({ ...store.dashboard(), ...status() })); api.get('/integrations', async () => status());
    api.get('/analysis/runs', async () => store.listAnalysisRuns()); api.get('/opportunities', async () => []); api.get('/research-notes', async () => []);
    api.get('/settings', async () => store.getSettings()); api.get('/experiments', async () => ({ records: [], warnings: [] }));
    api.get('/discovery/brief', async () => buildDiscoveryBrief(store.getProjects(), store.getDiscoveryObservations(), null));
  }, { prefix: '/api/v1' });
  app.register(staticFiles, { root: resolve(process.env.RADAR_TEST_WEB_DIR || '.data/discussion-monitoring-preview'), wildcard: false });
  app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: { message: 'Unknown fixture route' } }) : reply.sendFile('index.html'));
  await app.listen({ host: '127.0.0.1', port: 0 }); const base = app.listeningOrigin;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/v1/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${path}`);
      if (!path.startsWith('/api/v1/projects/77/')) return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${base}/projects/77#issue-7`);
  await page.getByLabel('跟进讨论 #7', { exact: true }).click();
  await until(() => store.getProjectMonitor('77')?.issues.some(issue => issue.number === 7));
  await page.waitForFunction(() => document.querySelector('.issue-monitor-selection input')?.checked === true);
  assert.equal(store.getProjectMonitor('77').enabled, false); assert.equal((await manager.runDue()).attempted, 0);
  await page.getByLabel('持续关注此项目', { exact: true }).check();
  await until(() => store.getProjectMonitor('77')?.issues[0]?.status === 'unchanged');
  assert.deepEqual(store.listMonitorIssueChanges(), []);
  // Only the referenced PR changes; the Issue state, body and timestamp remain unchanged.
  merged = true; clock += 25 * 3_600_000; assert.equal((await manager.runDue()).attempted, 1);
  const changed = store.getProjectMonitor('77').issues[0]; assert.equal(changed.unreadChange, true);
  assert.equal(store.getProject('77').issueContexts['7'].referencedPullRequests.items[0].merged, true);
  await page.goto(base); const notice = page.getByRole('complementary', { name: '讨论变化提醒', exact: true });
  await notice.getByText('1 条跟进讨论有变化，等待复核', { exact: true }).waitFor();
  await notice.locator('summary').click(); await notice.getByText('待核对', { exact: false }).waitFor();
  mkdirSync('.data/browser', { recursive: true }); await page.screenshot({ path: '.data/browser/discussion-change-desktop.png' });
  await notice.getByRole('link', { name: '#7 · Waiting for a workflow implementation', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('issue-7')?.open === true);
  // A later identical check must not clear an unread alert, nor may disabling automatic follow.
  const refreshed = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/projects/77/refresh'));
  await page.getByRole('region', { name: '项目持续关注', exact: true }).getByRole('button', { name: '刷新仓库资料', exact: true }).click(); assert.equal((await refreshed).status(), 200);
  assert.equal(store.getProjectMonitor('77').issues[0].status, 'unchanged'); assert.equal(store.getProjectMonitor('77').issues[0].unreadChange, true);
  await page.getByLabel('持续关注此项目', { exact: true }).uncheck(); await page.goto(base);
  await notice.locator('summary').click(); await notice.getByText('fixture/monitored-component · 自动关注已关闭', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.data/browser/discussion-change-mobile.png' });
  await notice.getByRole('button', { name: '已核对 #7 的变化', exact: true }).click(); await until(() => store.listMonitorIssueChanges().length === 0);
  await notice.waitFor({ state: 'detached' });
  // A deleted/unavailable discussion is a visible failure, preserving both evidence and comparison baseline.
  const beforeFailure = store.getProject('77').issueContexts['7']; issueStatus = 404; clock += 60_000;
  await page.goto(`${base}/projects/77`);
  const failure = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/projects/77/refresh'));
  await page.getByRole('region', { name: '项目持续关注', exact: true }).getByRole('button', { name: '刷新仓库资料', exact: true }).click(); assert.equal((await failure).status(), 200);
  await page.getByRole('region', { name: '项目持续关注', exact: true }).getByText('核查失败', { exact: false }).first().waitFor();
  assert.deepEqual(store.getProject('77').issueContexts['7'], beforeFailure);
  assert.equal(store.getProjectMonitor('77').status, 'partial'); assert.equal(store.getProjectMonitor('77').issues[0].unreadChange, false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.data/browser/discussion-failure-mobile.png' });
  assert.deepEqual(errors, []); assert.ok(!requests.some(path => path.includes('/search/')));
  assert.deepEqual(store.listAnalysisRuns(), []); assert.deepEqual(store.listScanRuns(), []);
  const saved = store.getProjectMonitor('77'), executions = runtime.completedExecutions;
  await browser.close(); browser = null; await manager.stop(); await app.close(); await runtime.close(); store.close(); closed = true;
  const reopened = new RadarStore(dbPath); try { assert.deepEqual(reopened.getProjectMonitor('77'), saved); } finally { reopened.close(); }
  const result = { realEngine: true, executions, localHttpFixture: true, referencePrChangeWithoutIssueChange: true, noImplicitProjectSubscription: true, unreadSurvivesNoChangeAndDisable: true, acknowledgedExplicitly: true, failurePreservesSnapshot: true, reopenedPersistence: true, hashOpensDiscussion: true, desktopAndMobile: true, mobileOverflow: false, pageErrors: errors, apiWrites: writes, productionWrites: 0, modelCalls: 0 };
  writeFileSync('.data/browser/discussion-monitoring-verification.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  await browser?.close(); if (!closed) { await manager?.stop(); await app.close(); await runtime.close(); try { store.close(); } catch {} }
  await new Promise(done => upstream.close(done));
  const target = resolve(directory), parent = resolve(tmpdir()); if (!target.startsWith(`${parent}${sep}radar-discussion-monitoring-`)) throw new Error('Unexpected temporary directory');
  rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
