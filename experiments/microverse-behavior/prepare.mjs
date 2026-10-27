import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const work = resolve(root, '.data/experiments/microverse-behavior');
mkdirSync(work, { recursive: true });
const repository = 'KsanaDock/Microverse', commit = '7a061d41ed67825496588e39ca37b0b2b7465fb2';
const engine = 'Godot_v4.4.1-stable_win64.exe.zip';
async function acquire(url, name) {
  const target = resolve(work, name);
  if (!existsSync(target)) {
    const response = await fetch(url, { headers: { Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(120000) });
    assert.ok(response.ok, `${name}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length < 100 * 1024 * 1024);
    writeFileSync(target, bytes);
  }
  return readFileSync(target);
}
const responses = await Promise.allSettled([
  acquire(`https://codeload.github.com/${repository}/zip/${commit}`, 'source.zip'),
  acquire(`https://api.github.com/repos/godotengine/godot/releases/assets/240896639?download=1&t=${Date.now()}`, engine),
  acquire(`https://api.github.com/repos/godotengine/godot/releases/assets/240898538?download=1&t=${Date.now()}`, 'SHA512-SUMS.txt'),
]);
for (const response of responses) if (response.status === 'rejected') throw response.reason;
const bytes = responses[1].value;
const sumLine = responses[2].value.toString('utf8').split(/\r?\n/).find(line => line.endsWith(engine));
assert.ok(sumLine);
assert.equal(createHash('sha512').update(bytes).digest('hex'), sumLine.split(/\s+/)[0]);
writeFileSync(resolve(work, 'preparation.json'), JSON.stringify({ repository, commit, engineVersion: '4.4.1-stable', engineArchive: engine, engineSha512: sumLine.split(/\s+/)[0], sourceArchiveSha256: createHash('sha256').update(responses[0].value).digest('hex') }, null, 2));
const python = resolve(root, '.data/experiments/actual-ecommerce-noter/python/python.exe');
const result = spawnSync(python, ['-I', '-B', '-X', 'utf8', 'experiments/microverse-behavior/unpack.py'], { encoding: 'utf8', timeout: 60000 });
assert.equal(result.status, 0, result.stderr);
console.log(result.stdout.trim());
