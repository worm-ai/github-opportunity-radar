// Reconstruct fixed-commit sources from read-only saved research snapshots.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = '.data/experiments/stanford-state-20261024';
const commit = 'fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4';
const newline = String.fromCharCode(10);
const blobHash = bytes => createHash('sha1').update('blob ' + Buffer.byteLength(bytes) + String.fromCharCode(0)).update(bytes).digest('hex');
const db = new DatabaseSync('.data/isolated-v6/opportunity-radar.sqlite', { readOnly: true });
const saved = db.prepare('SELECT id,snapshot_json FROM demand_runs').all().flatMap(row =>
  (JSON.parse(row.snapshot_json || 'null')?.sources || []).map(source => ({ ...source, run: row.id })));
db.close();
const receipts = [];
for (const name of ['scratch.py', 'associative_memory.py', 'spatial_memory.py']) {
  const parts = saved.filter(source => source.commitSha === commit && source.path?.endsWith('/' + name));
  assert.ok(parts.length, name);
  const sha = parts[0].sha;
  const total = parts[0].totalLines;
  const lines = new Array(total);
  for (const part of parts) {
    assert.equal(part.sha, sha);
    const content = part.content.split(newline);
    for (let line = part.startLine; line <= part.endLine; line++) {
      const value = content[line - part.startLine];
      assert.notEqual(value, undefined);
      if (lines[line - 1] !== undefined) assert.equal(lines[line - 1], value);
      lines[line - 1] = value;
    }
  }
  assert.equal(lines.filter(value => value !== undefined).length, total);
  const content = lines.join(newline);
  const candidates = [...new Set([content, content + newline, content.endsWith(newline) ? content.slice(0, -1) : content])];
  const exact = candidates.find(bytes => blobHash(bytes) === sha);
  assert.notEqual(exact, undefined, 'Git blob mismatch: ' + name);
  const output = root + '/vendor/' + name;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, exact);
  receipts.push({ path: parts[0].path, commit, blob: sha, bytes: Buffer.byteLength(exact), output, runs: [...new Set(parts.map(part => part.run))], verified: true });
}
for (const name of ['retrieve.py', 'persona.py']) {
  const path = name === 'retrieve.py' ? 'reverie/backend_server/persona/cognitive_modules/retrieve.py' : 'reverie/backend_server/persona/persona.py';
  const source = '.data/experiments/social-alternatives-source-2026-10-23/generative-agents/' + path;
  const receipt = JSON.parse(readFileSync(source + '.source.json', 'utf8'));
  const bytes = readFileSync(source);
  assert.equal(receipt.commit, commit);
  assert.equal(blobHash(bytes), receipt.blob);
  assert.equal(bytes.length, receipt.bytes);
  const output = root + '/vendor/' + name;
  writeFileSync(output, bytes);
  receipts.push({ path, commit, blob: receipt.blob, bytes: bytes.length, output, verified: true });
}
writeFileSync(root + '/sources.json', JSON.stringify({ repository: 'joonspk-research/generative_agents', commit, observedAt: new Date().toISOString(), networkRequests: 0, receipts }, null, 2));
console.log(JSON.stringify({ root, verifiedSources: receipts.length, networkRequests: 0 }));
