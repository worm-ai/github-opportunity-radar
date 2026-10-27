// Real iii, isolated GitHub HTTP and temporary SQLite. No model or production writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHubClient, buildDiscoveryPlan } from '../packages/sensor-github/dist/index.js';
import { RadarStore } from '../packages/storage/dist/index.js';
import { createRepositorySignal } from '../packages/contracts/dist/index.js';
import { createRuntimeAdapter } from '../packages/runtime/dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'radar-discovery-'));
const path = join(directory, 'test.sqlite');
let store = new RadarStore(path), failAutomation = false, incompleteEarly = false;
const requests = [];
const upstream = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  response.setHeader('content-type', 'application/json');
  if (url.pathname === '/search/repositories') {
    const query = url.searchParams.get('q'), page = Number(url.searchParams.get('page'));
    requests.push({ query, page });
    if (failAutomation && query.includes('topic:automation')) { response.statusCode = 422; return response.end('{}'); }
    const id = page * 100 + (query.includes('topic:automation') ? 1 : query.includes('topic:data-engineering') ? 2 : query.includes('stars:10..1000') ? 3 : query.includes('topic:ai-agent') ? 4 : 5);
    return response.end(JSON.stringify({ total_count: 99, incomplete_results: incompleteEarly && query.includes('stars:10..1000'), items: [{ id, full_name: `fixture/capability-${id}`, html_url: `https://github.com/fixture/capability-${id}`, description: 'Reusable component with a documented interface.', language: 'TypeScript', license: { spdx_id: 'MIT' }, stargazers_count: 45, forks_count: 0, open_issues_count: 0, created_at: '2026-10-01T00:00:00Z', pushed_at: '2026-10-21T00:00:00Z', default_branch: 'main' }] }));
  }
  if (url.pathname.endsWith('/readme')) return response.end(JSON.stringify({ encoding: 'base64', content: Buffer.from('Documented file input and JSON output.').toString('base64') }));
  response.end('[]');
});
const runtime = createRuntimeAdapter(process.env.III_URL || 'ws://127.0.0.1:49134', `radar-discovery-${process.pid}`);
try {
  await new Promise((done) => upstream.listen(0, '127.0.0.1', done));
  await runtime.ready(); assert.equal(runtime.mode, 'iii');
  const client = new GitHubClient({ apiBase: `http://127.0.0.1:${upstream.address().port}` });
  const settings = store.getSettings();
  const collect = () => runtime.run(async () => {
    const run = store.createScanRun(), date = new Date(run.startedAt), progress = store.getDiscoveryProgress();
    store.recordDiscovery(run.id, buildDiscoveryPlan(settings, date, progress));
    const result = await client.discover(settings, progress, date);
    for (const repository of result.repositories) store.saveRepository(repository, createRepositorySignal({ repositoryId: repository.id, ...repository }), 0, [], [], new Date().toISOString());
    store.completeDiscovery(run.id, result.tracks);
    store.finishScanRun(run, { status: result.warnings.length ? 'partial' : 'succeeded', found: result.repositories.length, inserted: result.repositories.length, duplicates: 0, error: null }, result.warnings);
    return result;
  });
  assert.deepEqual((await collect()).tracks.map((track) => track.page), [1, 1, 1, 1, 1]);
  store.close(); store = new RadarStore(path);
  assert.deepEqual(buildDiscoveryPlan(settings, new Date(), store.getDiscoveryProgress()).map((track) => track.page), [2, 2, 2, 2, 2]);
  failAutomation = true; incompleteEarly = true;
  const partial = await collect();
  assert.equal(partial.warnings.length, 2);
  assert.deepEqual(buildDiscoveryPlan(settings, new Date(), store.getDiscoveryProgress()).map((track) => track.page), [1, 2, 2, 1, 1]);
  failAutomation = false; incompleteEarly = false;
  assert.deepEqual((await collect()).tracks.map((track) => track.page), [1, 2, 2, 1, 1]);
  const plan = buildDiscoveryPlan(settings, new Date(), store.getDiscoveryProgress());
  assert.deepEqual(plan.map((track) => track.page), [3, 1, 1, 3, 3]);
  assert.equal(store.getProjects().length, 10);
  assert.equal(store.listAnalysisRuns().length, 0);
  console.log(JSON.stringify({ realEngine: true, executions: runtime.completedExecutions, searchRequests: requests.length, projects: store.getProjects().length, nextPages: plan.map((track) => track.page), restart: true, partialRetry: true, modelCalls: 0, productionWrites: 0 }));
} finally {
  await runtime.close();
  await new Promise((done) => upstream.close(done));
  store.close(); rmSync(directory, { recursive: true, force: true });
}
