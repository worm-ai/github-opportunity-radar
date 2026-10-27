// Real saved input, fixture model, in-memory Fastify/SQLite and routed built UI.
// No listening server, live writes, paid calls, or GitHub calls.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { RadarStore } from '../packages/storage/dist/index.js';
import { InProcessRuntimeAdapter } from '../packages/runtime/dist/index.js';
import { validateDemandEvaluationResume } from '../packages/analysis/dist/index.js';
import { registerDemandRoutes } from '../apps/server/dist/demand.js';

const Fastify = createRequire(new URL('../apps/server/package.json', import.meta.url))('fastify');

const base = 'http://127.0.0.1:4318', origin = 'https://radar.test';
const liveId = '86de1f5b-45a6-40d9-b01c-122a1d20bb36';
const output = '.data/browser/demand-evaluation-resume';
const liveGet = async path => { const response = await fetch(`${base}/api/v1/${path}`); assert.equal(response.status, 200); return response.json(); };
const liveBefore = await liveGet(`demands/${liveId}`);
validateDemandEvaluationResume(liveBefore.snapshot);
const dashboard = await liveGet('dashboard');
dashboard.analysis = { ...dashboard.analysis, running: false, state: 'configured' };
dashboard.lastScan = null;
if (dashboard.evidence) dashboard.evidence.running = false;
const app = Fastify(), store = new RadarStore(':memory:'), runtime = new InProcessRuntimeAdapter();
const seed = store.createDemandRun(randomUUID(), liveBefore.question, null);
store.checkpointDemandRun(seed.id, structuredClone(liveBefore.snapshot));
const original = store.getDemandRun(seed.id);
let slot = null, mode = 'success', legacy = false, modelCalls = 0, githubCalls = 0;
registerDemandRoutes(app, { store, runtime, missingMessage: 'Fixture model unavailable',
  transport: { provider: 'codex', model: 'fixture-no-live-model', complete: async () => {
    modelCalls++;
    if (mode === 'timeout') throw new Error('Fixture evaluation timeout; no real model invoked');
    return { content: JSON.stringify({ paths: [], gapQueries: [], conclusion: '测试模型：已有资料仍不足，不形成采用建议。' }), finishReason: 'stop', promptTokens: 0, completionTokens: 0 };
  } },
  client: () => { githubCalls++; throw new Error('Fixture forbids all GitHub access'); },
  busy: () => Boolean(slot), reserve: value => { slot = value; },
});
app.get('/research-notes', async () => []);
app.get('/demands/:id/note-sources', async () => ({ sources: [], warnings: [] }));
app.get('/experiments', async () => ({ records: [], warnings: [] }));
app.get('/dashboard', async () => dashboard);
const root = resolve('apps/web/dist'), errors = [], posts = [];
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function open() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route(`${origin}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.startsWith('/api/v1/')) {
      if (request.method() === 'POST') posts.push({ path, input: request.postDataJSON() });
      const response = await app.inject({ method: request.method(), url: path.slice('/api/v1'.length), ...(request.postData() ? { payload: request.postDataJSON() } : {}) });
      let body = response.body;
      if (legacy && path.endsWith('/demands/features')) { const data = JSON.parse(body); delete data.evaluationResume; body = JSON.stringify(data); }
      return route.fulfill({ status: response.statusCode, contentType: 'application/json', body });
    }
    assert.equal(request.method(), 'GET');
    const file = path.startsWith('/assets/') ? resolve(root, `.${path}`) : resolve(root, 'index.html');
    assert.ok(file.startsWith(`${root}${sep}`));
    return route.fulfill({ status: 200, contentType: ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { context, page };
}
try {
  legacy = true;
  let { context, page } = await open();
  await page.goto(`${origin}/research?run=${seed.id}`);
  await page.getByRole('heading', { name: liveBefore.question, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '用已采材料继续比较', exact: true }).count(), 0);
  assert.equal(posts.length, 0);
  await context.close(); legacy = false;
  ({ context, page } = await open());
  await page.goto(`${origin}/research?run=${seed.id}`);
  const button = page.getByRole('button', { name: '用已采材料继续比较', exact: true });
  await button.waitFor(); assert.equal(await button.isEnabled(), true);
  await page.screenshot({ path: `${output}/before.png` });
  await button.click();
  await page.waitForURL(url => url.searchParams.get('run') !== seed.id);
  const resumedId = new URL(page.url()).searchParams.get('run');
  await page.getByText('测试模型：已有资料仍不足，不形成采用建议。', { exact: true }).waitFor();
  const resumed = store.getDemandRun(resumedId);
  assert.equal(resumed.status, 'partial');
  assert.equal(resumed.retryOf, seed.id);
  assert.deepEqual(resumed.snapshot.sources, original.snapshot.sources);
  assert.deepEqual(resumed.snapshot.projects, original.snapshot.projects);
  assert.deepEqual(resumed.snapshot.plan, original.snapshot.plan);
  assert.deepEqual(resumed.snapshot.calls.map(call => call.stage), ['evaluation']);
  assert.ok((await page.locator('body').innerText()).includes('用量仅计本次新增调用'));
  await page.reload();
  await page.getByText('测试模型：已有资料仍不足，不形成采用建议。', { exact: true }).waitFor();
  assert.equal(modelCalls, 1); assert.equal(posts.length, 1);
  await page.screenshot({ path: `${output}/resumed.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/mobile.png` });
  await context.close();
  mode = 'timeout';
  ({ context, page } = await open());
  await page.goto(`${origin}/research?run=${seed.id}`);
  await page.getByRole('button', { name: '用已采材料继续比较', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('run') !== seed.id);
  await page.getByText('Fixture evaluation timeout; no real model invoked', { exact: true }).waitFor();
  const failedId = new URL(page.url()).searchParams.get('run');
  assert.equal(store.getDemandRun(failedId).status, 'failed');
  assert.deepEqual(store.getDemandRun(failedId).snapshot.sources, original.snapshot.sources);
  await page.reload();
  await page.getByText('Fixture evaluation timeout; no real model invoked', { exact: true }).waitFor();
  assert.equal(modelCalls, 2); assert.equal(posts.length, 2);
  await page.screenshot({ path: `${output}/timeout.png` });
  dashboard.analysis.running = true;
  await page.reload();
  await page.getByRole('button', { name: '用已采材料继续比较', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '用已采材料继续比较', exact: true }).isDisabled(), true);
  assert.deepEqual(store.getDemandRun(seed.id), original);
  assert.deepEqual(await liveGet(`demands/${liveId}`), liveBefore);
  assert.equal(githubCalls, 0); assert.deepEqual(errors, []); assert.equal(store.listDemandRuns().length, 3);
  const receipt = { observedAt: new Date().toISOString(), liveId, inputVersion: liveBefore.snapshot.version,
    liveUnchanged: true, inputSources: original.snapshot.sources.length, inputSha256: createHash('sha256').update(JSON.stringify(liveBefore)).digest('hex'),
    fixtureModelOnly: true, listeningServer: false, legacyFeatureHidden: true, reloadDoesNotResubmit: true, busyDisablesSubmit: true,
    originalImmutable: true, materialCopiesUnchanged: true, modelCalls, githubCalls, fixturePosts: posts.length, errors };
  writeFileSync(`${output}/verification.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
  await context.close();
} finally { await browser.close(); await app.close(); await runtime.close(); store.close(); }
