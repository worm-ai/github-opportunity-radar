// Read-only checkpoint: never resubmit research or reload either backend.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = 'http://127.0.0.1:4318/api/v1';
const taskId = '86de1f5b-45a6-40d9-b01c-122a1d20bb36';
const originalId = '06fffe22-dc24-4182-bed7-1cc70f60e1c5';
const output = '.data/experiments/demand-alternative-follow-up-2026-10-23';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const get = async path => {
  const response = await fetch(`${base}/${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
};
const [history, notes, original, task, features, ready] = await Promise.all([
  get('demands'), get('research-notes'), get(`demands/${originalId}`),
  get(`demands/${taskId}`), get('demands/features'), get('health/ready'),
]);
assert.equal(task.status, 'failed');
assert.equal(task.snapshot.stage, 'failed');
assert.equal(task.snapshot.version, 'demand-research-v1');
assert.equal(task.snapshot.evaluations.length, 0);
assert.equal(task.snapshot.recommendedPathId, null);
assert.ok(task.snapshot.collections.some(item => item.fullName === 'a16z-infra/ai-town' && item.status === 'succeeded'));
assert.ok(task.snapshot.collections.some(item => item.fullName === 'joonspk-research/generative_agents' && item.status === 'succeeded'));
const prior = JSON.parse(readFileSync('.data/experiments/demand-alternative-plan-2026-10-23T08-25-45-020Z/provenance.json', 'utf8'));
assert.equal(hash(original.snapshot), prior.originalSnapshotHash);
const [historyAfter, notesAfter, taskAfter] = await Promise.all([
  get('demands'), get('research-notes'), get(`demands/${taskId}`),
]);
assert.deepEqual(historyAfter, history);
assert.deepEqual(notesAfter, notes);
assert.deepEqual(taskAfter, task);
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/task.json`, JSON.stringify(task, null, 2));
const receipt = {
  observedAt: new Date().toISOString(), taskId, originalId, status: task.status,
  stage: task.snapshot.stage, version: task.snapshot.version, error: task.error,
  projects: task.snapshot.projects.map(item => item.fullName),
  searches: task.snapshot.searches.map(({ query, status }) => ({ query, status })),
  calls: task.snapshot.calls, features, ready: ready.ready,
  savedTasks: history.length, originalSnapshotHash: hash(original.snapshot),
  originalSnapshotUnchanged: true, tasksAndNotesUnchangedDuringCheck: true,
  notesHash: hash(notes), noRecommendation: true,
  limitation: 'Existing v1 backend, manually supplied repository leads, failed evaluation; not a v4 end-to-end or independent-user validation',
};
writeFileSync(`${output}/verification.json`, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ output, ...receipt }));
