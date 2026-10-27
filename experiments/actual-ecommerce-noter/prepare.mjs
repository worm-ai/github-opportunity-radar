import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHubClient } from '../../packages/sensor-github/dist/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const repo = 'rr4444/actual-ecommerce-noter';
const commit = '52aa8ada3fbd602b80df52cd10fe95206488bcdb';
const files = {
  'actual-ecommerce-noter': '582b07eee3e183ae7834899b876d1b7754fa9e92',
  'LICENSE': '669f7480175b69233ad38859a53f252560b0c028',
  'requirements.txt': '28ce6e889ab382e2fe15ecbe0fc3e407a52eaabc',
  'Status.md': 'c0026bdd2be97cc8790cb13612579e3c0d8b041c',
};
const directory = resolve(root, '.data/experiments/actual-ecommerce-noter');
mkdirSync(resolve(directory, 'source'), { recursive: true });
const github = new GitHubClient({ token: process.env.GITHUB_TOKEN });
const blobHash = (bytes) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
const tree = await github.request(new URL(`https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`));
assert.equal(tree.truncated, false);
const sources = [];
for (const [path, sha] of Object.entries(files)) {
  assert.ok(tree.tree.some((item) => item.path === path && item.sha === sha));
  const target = resolve(directory, 'source', path);
  let bytes = existsSync(target) ? readFileSync(target) : null;
  if (!bytes) {
    const blob = await github.request(new URL(`https://api.github.com/repos/${repo}/git/blobs/${sha}`));
    assert.equal(blob.encoding, 'base64'); bytes = Buffer.from(blob.content, 'base64');
  }
  assert.equal(blobHash(bytes), sha, `Changed source: ${path}`);
  writeFileSync(target, bytes);
  sources.push({ path, blob: sha, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), url: `https://github.com/${repo}/blob/${commit}/${path}` });
}
writeFileSync(resolve(directory, 'source.json'), JSON.stringify({ repo, commit, license: 'MIT', sources }, null, 2));
console.log(JSON.stringify({ repo, commit, verifiedFiles: sources.length, executedUpstreamCode: false }));
