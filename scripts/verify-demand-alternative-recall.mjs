// Planning and read-only searches only. Selection is an explicit empty stub;
// no collection, evaluation, recommendation, task write or service restart.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { researchDemand } from '../packages/analysis/src/demand.ts';
import { analysisConfiguration } from '../apps/server/src/analysis-config.ts';
import { CodexTransport, configuredCodexModel, findCodexBinary } from '../packages/analysis/src/codex.ts';

process.loadEnvFile('.env');
const base = 'http://127.0.0.1:4318/api/v1';
const taskId = '06fffe22-dc24-4182-bed7-1cc70f60e1c5';
const benchmark = ['a16z-infra/ai-town', 'joonspk-research/generative_agents'];
const output = `.data/experiments/demand-alternative-plan-${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(output, { recursive: true });
const save = (name, value) => writeFileSync(`${output}/${name}.json`, JSON.stringify(value, null, 2));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const get = async path => {
  const response = await fetch(`${base}/${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
};
const ready = await get('health/ready');
assert.ok(ready.ready && !ready.analysis.running && !ready.evidence.running);
const history = await get('demands');
assert.ok(!history.some(run => run.status === 'running'));
const before = { tasks: await Promise.all(history.map(run => get(`demands/${run.id}`))), notes: await get('research-notes') };
const original = before.tasks.find(run => run.id === taskId);
assert.ok(original?.snapshot);
const configuration = analysisConfiguration();
assert.ok(configuration.transport);
let transport = configuration.transport;
if (ready.analysis.model.startsWith('codex/')) {
  const model = configuredCodexModel(process.env.CODEX_MODEL);
  const binary = findCodexBinary(process.env.CODEX_BIN);
  assert.ok(binary && model && `codex/${model}` === ready.analysis.model);
  transport = new CodexTransport({ binary, model });
}
save('provenance', { taskId, originalSnapshotHash: hash(original.snapshot), originalQueries: original.snapshot.plan.queries, originalPreviews: original.snapshot.searches.flatMap(search => search.items.map(item => item.fullName)), benchmark, runningModel: ready.analysis.model, scope: 'One live planning call and at most four read-only searches; selection explicitly stubbed, no collection or recommendation' });
const cache = new Map();
const reuse = process.argv.find(arg => arg.startsWith('--reuse-searches='))?.slice('--reuse-searches='.length);
if (reuse) {
  const receipts = JSON.parse(readFileSync(reuse, 'utf8'));
  for (const receipt of receipts) if (receipt.status === 200) cache.set(receipt.query.toLowerCase(), receipt.result);
  save('reuse-provenance', { file: reuse, sha256: createHash('sha256').update(readFileSync(reuse)).digest('hex'), queries: [...cache.keys()] });
}
let stage, liveCalls = 0;
const calls = [], searches = [];
const result = await researchDemand(original.question, {
  transport: {
    provider: transport.provider, model: transport.model,
    async complete(system, input, schema) {
      if (stage === 'selection') return { content: JSON.stringify({ selected: [], skipped: input.candidates.map(item => ({ fullName: item.fullName, reason: 'Explicit verification stub: preview only, no capability assessment or collection' })) }), finishReason: 'stop', model: 'explicit-selection-stub' };
      assert.equal(stage, 'plan', 'No live model stages beyond planning');
      assert.equal(liveCalls++, 0, 'At most one model call');
      const receipt = { startedAt: new Date().toISOString(), system, input, schema };
      calls.push(receipt); save('model-calls', calls);
      try {
        const completion = await transport.complete(system, input, schema);
        Object.assign(receipt, { completedAt: new Date().toISOString(), completion });
        return completion;
      } catch (error) {
        Object.assign(receipt, { completedAt: new Date().toISOString(), error: error.message });
        throw error;
      } finally { save('model-calls', calls); }
    },
  },
  async search(query) {
    assert.ok(searches.length < 4, 'At most four searches in this stage verification');
    const cached = cache.get(query.toLowerCase());
    const response = cached ? null : await fetch(`${base}/components/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
    const found = cached ?? await response.json();
    searches.push({ query, reused: Boolean(cached), status: response?.status ?? 200, result: found });
    save('searches', searches);
    assert.equal(response?.status ?? 200, 200);
    console.log(JSON.stringify({ query, reused: Boolean(cached), total: found.total, candidates: found.items.map(item => item.fullName) }));
    return found;
  },
  async collect() { throw new Error('Collection is outside this verification'); },
  checkpoint(snapshot) { stage = snapshot.calls.at(-1)?.stage; save('snapshot', snapshot); },
});
save('result', result);
const after = { tasks: await Promise.all(history.map(run => get(`demands/${run.id}`))), notes: await get('research-notes') };
assert.equal(hash(after), hash(before));
assert.deepEqual(await get('demands'), history);
const candidates = new Set(result.searches.flatMap(search => search.items.map(item => item.fullName.toLowerCase())));
const verification = { output, observedAt: new Date().toISOString(), stage: result.stage, error: result.error, version: result.version, liveCalls, actualSearchRequests: searches.filter(search => !search.reused).length, reusedSearches: searches.filter(search => search.reused).length, queries: result.plan?.queries, benchmarkRecall: benchmark.map(fullName => ({ fullName, recalled: candidates.has(fullName.toLowerCase()) })), tasksAndNotesUnchanged: true, noRecommendation: result.recommendedPathId === null, limitation: 'Single demand, planning and preview retrieval only; no quality, runtime or independent user-value conclusion' };
save('verification', verification);
console.log(JSON.stringify(verification));
assert.equal(result.stage, 'finished', result.error ?? 'Planning/search verification failed');
assert.equal(result.projects.length, 0);
assert.equal(result.recommendedPathId, null);
