// Bounded live-stage verification, NOT a new end-to-end study or user validation.
// Planning, initial searches, collection and review are replayed/stubbed explicitly.
// Only evaluation/refinement model stages and gap GitHub searches are live.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { researchDemand } from '../packages/analysis/src/demand.ts';
import { analysisConfiguration } from '../apps/server/src/analysis-config.ts';
import { CodexTransport, configuredCodexModel, findCodexBinary } from '../packages/analysis/src/codex.ts';

process.loadEnvFile('.env');
const base = 'http://127.0.0.1:4318';
const taskId = '792667cf-5d44-4e5a-bb36-dd8b33a5364f';
const output = `.data/experiments/demand-gap-search-${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(output, { recursive: true });
const save = (name, value) => writeFileSync(`${output}/${name}.json`, JSON.stringify(value, null, 2));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function get(path) {
  const response = await fetch(`${base}/api/v1/${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
}
const ready = await get('health/ready');
assert.ok(ready.ready && !ready.analysis.running && !ready.evidence.running);
const history = await get('demands');
assert.ok(!history.some(run => run.status === 'running'));
const savedTasks = await Promise.all(history.map(run => get(`demands/${run.id}`)));
const savedNotes = await get('research-notes');
const original = savedTasks.find(run => run.id === taskId);
assert.ok(original?.snapshot);
const snapshot = original.snapshot;
save('original-stage-provenance', { taskId, snapshotHash: hash(snapshot), originalGapQueries: snapshot.evaluations[0].gapQueries });
const configured = analysisConfiguration();
assert.ok(configured.transport, 'Use the existing configured transport; never silently switch provider');
// The running isolated server may intentionally have OpenCode disabled in its
// inherited environment. Match its observed model instead of CLI discovery here.
let transport = configured.transport;
if (ready.analysis.model.startsWith('codex/')) {
  const model = configuredCodexModel(process.env.CODEX_MODEL);
  const binary = findCodexBinary(process.env.CODEX_BIN);
  assert.ok(binary && model && `codex/${model}` === ready.analysis.model);
  transport = new CodexTransport({ binary, model });
}
const liveCalls = [], searches = [], cache = new Map();
const reuseSearches = process.argv.find(arg => arg.startsWith('--reuse-searches='))?.slice('--reuse-searches='.length);
if (reuseSearches) {
  for (const item of JSON.parse(readFileSync(reuseSearches, 'utf8'))) if (item.status === 200) cache.set(item.query, item.result);
  save('reused-search-provenance', { file: reuseSearches, queries: [...cache.keys()] });
}
async function liveSearch(query) {
  if (cache.has(query)) return structuredClone(cache.get(query));
  assert.ok(searches.length < 6, 'At most six actual read-only GitHub requests for this verification');
  const response = await fetch(`${base}/api/v1/components/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const result = await response.json();
  searches.push({ query, status: response.status, result });
  save('github-searches', searches);
  assert.equal(response.status, 200, query);
  cache.set(query, result);
  console.log(JSON.stringify({ query, total: result.total, candidates: result.items.map(item => ({ fullName: item.fullName, description: item.description })) }));
  return structuredClone(result);
}
// Recheck the observed defect using the same read-only preview endpoint.
for (const item of snapshot.evaluations[0].gapQueries) await liveSearch(item.query);

for (const mode of ['live-refinement', 'live-evaluation']) {
  let stage, selections = 0;
  const result = await researchDemand(original.question, {
    transport: {
      provider: transport.provider, model: transport.model,
      async complete(system, input, schema) {
        const live = (mode === 'live-evaluation' && stage === 'evaluation') || stage === 'gap_search_refinement';
        if (live) {
          assert.ok(liveCalls.length < 3, 'Bound changed-stage model calls');
          const receipt = { mode, stage, startedAt: new Date().toISOString(), input, system, schema };
          liveCalls.push(receipt); save('model-calls', liveCalls);
          try {
            const completion = await transport.complete(system, input, schema);
            Object.assign(receipt, { completedAt: new Date().toISOString(), completion });
            save('model-calls', liveCalls);
            return completion;
          } catch (error) {
            Object.assign(receipt, { completedAt: new Date().toISOString(), error: error.message });
            save('model-calls', liveCalls);
            throw error;
          }
        }
        let value;
        if (stage === 'plan') value = snapshot.plan;
        else if (stage === 'selection' && selections++ === 0) value = snapshot.selections[0].selection;
        else if (stage === 'selection') value = { selected: [], skipped: input.candidates.map(item => ({ fullName: item.fullName, reason: 'Verification stub: preview only, do not collect new repositories or infer support' })) };
        else if (stage === 'evaluation') value = snapshot.evaluations[0];
        else if (stage === 'review') value = {
          reviews: input.evaluation.paths.map(path => ({ pathId: path.id, verdict: 'reject', reason: 'Verification stub; this replay does not validate a recommendation', risks: ['Live model review and runtime verification are outside this bounded check'], checks: { capabilitiesGrounded: false, constraintsRespected: false, singleProjectCompared: false, integrationHonest: false, experimentFalsifiable: false } })),
          recommendedPathId: null, conclusion: 'No recommendation from a partial-stage replay',
        };
        else throw new Error(`Unexpected replay stage ${stage}`);
        return { content: JSON.stringify(value), finishReason: 'stop', model: 'explicit-replay-fixture' };
      },
    },
    async search(query) {
      const initial = snapshot.searches.find(item => item.phase === 'initial' && item.query === query);
      if (initial) return structuredClone(initial);
      return liveSearch(query);
    },
    async collect(fullName) {
      const project = snapshot.projects.find(item => item.fullName === fullName);
      assert.ok(project, 'Only replay previously collected repositories');
      const sources = snapshot.sources.filter(item => item.projectId === project.id);
      return { ...project, description: sources.find(item => item.field === 'description')?.content ?? null, readmeExcerpt: sources.find(item => item.field === 'readme')?.content ?? null };
    },
    checkpoint(state) { stage = state.calls.at(-1)?.stage; save(`${mode}-snapshot`, state); },
  });
  save(`${mode}-result`, result);
  assert.equal(result.stage, 'finished', result.error ?? 'Interrupted stage');
  assert.ok(result.searches.length <= 6);
  assert.equal(result.recommendedPathId, null, 'Replay/stub cannot endorse a candidate');
  if (mode === 'live-refinement') {
    assert.equal(result.calls.filter(call => call.stage === 'gap_search_refinement').length, 1);
    assert.ok(result.searches.some(item => item.phase === 'gap'), 'Live refinement must produce valid executable queries');
    assert.deepEqual(result.evaluations[0], snapshot.evaluations[0]);
  }
  console.log(JSON.stringify({ mode, status: result.status, modelStages: result.calls.map(call => ({ stage: call.stage, model: call.model })), queries: result.searches.filter(item => item.phase === 'gap').map(item => item.query) }));
}
assert.deepEqual(await get('demands'), history);
assert.equal(hash(await Promise.all(history.map(run => get(`demands/${run.id}`)))), hash(savedTasks));
assert.equal(hash(await get('research-notes')), hash(savedNotes));
save('verification', { observedAt: new Date().toISOString(), taskId, configuredModel: transport.model, runningServerModel: ready.analysis.model, actualModelCalls: liveCalls.map(({ mode, stage, completion }) => ({ mode, stage, model: completion?.model, promptTokens: completion?.promptTokens, completionTokens: completion?.completionTokens })), actualSearchRequests: searches.length, tasksUnchanged: true, notesUnchanged: true, limitation: 'Only changed model stages and search endpoint are live. Earlier phases replayed, new collection and review stubbed; no full pipeline or independent user-value claim.' });
console.log(JSON.stringify({ output, actualSearchRequests: searches.length, actualModelCalls: liveCalls.length, tasksUnchanged: true, notesUnchanged: true }));
