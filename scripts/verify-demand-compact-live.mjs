// Fault injection at the full-evaluation boundary; compact calls use the real
// configured model and existing GitHub evidence. This is not a natural timeout.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CodexTransport, findCodexBinary, configuredCodexModel, researchDemand, validateDemandEvaluationResume } from '../packages/analysis/dist/index.js';

const base = process.env.COMPACT_VERIFY_BASE ?? 'http://127.0.0.1:4346';
const runId = '42ce86a1-cc8b-42fd-a09d-939406c336f2';
const output = `.data/verification/demand-compact-${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(output, { recursive: true });
const get = async () => { const response = await fetch(`${base}/api/v1/demands/${runId}`); assert.equal(response.status, 200); return response.json(); };
const before = await get();
validateDemandEvaluationResume(before.snapshot);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const originalHash = hash(before);
const binary = findCodexBinary(process.env.CODEX_BIN), model = configuredCodexModel(process.env.CODEX_MODEL);
assert.ok(binary && model, 'Configure CODEX_BIN and CODEX_MODEL');
const real = new CodexTransport({ binary, model });
let injected = 0, realCalls = 0, searchCalls = 0, collectCalls = 0;
const startedAt = new Date().toISOString();
const snapshot = await researchDemand(before.question, {
  reuse: { runId, snapshot: before.snapshot },
  transport: { provider: real.provider, model: real.model, complete: async (system, input, schema) => {
    if (!injected) { injected++; throw new Error('本机 Codex 未完整结束，未保存新机会（核验故障注入）'); }
    assert.equal(typeof input.project?.id, 'string', 'Only per-project compact calls may reach the model');
    realCalls++;
    console.log(JSON.stringify({ stage: 'real_compact_started', project: input.project.fullName, realCalls }));
    return real.complete(system, input, schema);
  } },
  search: async () => { searchCalls++; throw new Error('Search forbidden during this verification'); },
  collect: async () => { collectCalls++; throw new Error('Collection forbidden during this verification'); },
  checkpoint: value => writeFileSync(`${output}/checkpoint.json`, JSON.stringify(value, null, 2)),
});
writeFileSync(`${output}/snapshot.json`, JSON.stringify(snapshot, null, 2));
const summary = { startedAt, finishedAt: new Date().toISOString(), kind: 'fault-injection-with-real-compact-model',
  parentRunId: runId, parentUnchanged: hash(await get()) === originalHash, injected, realCalls, searchCalls, collectCalls,
  status: snapshot.status, outcome: snapshot.outcome, recommendedPathId: snapshot.recommendedPathId,
  reviews: snapshot.reviews, calls: snapshot.calls,
  paths: snapshot.evaluations.at(-1)?.paths.map(path => ({ id: path.id, projectIds: path.projectIds, kind: path.kind, constraintsFit: path.constraintsFit, coverage: path.coverage })),
  warnings: snapshot.warnings, error: snapshot.error, output };
writeFileSync(`${output}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
assert.equal(summary.parentUnchanged, true);
assert.equal(searchCalls + collectCalls, 0);
assert.equal(snapshot.status, 'partial');
assert.equal(snapshot.recommendedPathId, null); assert.equal(snapshot.reviews, null);
assert.ok(snapshot.calls.some(call => call.stage === 'evaluation_compact' && call.status === 'succeeded'));
assert.ok(!snapshot.calls.some(call => call.stage === 'review'));
validateDemandEvaluationResume(snapshot);
