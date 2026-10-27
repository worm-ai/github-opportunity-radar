import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHubClient } from '../../packages/sensor-github/dist/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const client = new GitHubClient({ token: process.env.GITHUB_TOKEN });
const repository = 'sbenodiz/agent-world';
const commit = '13d62dbdeeca07c7b5bb3b8aa264ca9834b01882';
const output = resolve(root, '.data/experiments/agent-world-behavior');
const world = JSON.parse(readFileSync(resolve(root, '.data/research/agent-world-source/world-tree.json'), 'utf8'));
assert.equal(world.truncated, false);
const tree = JSON.parse(readFileSync(resolve(root, '.data/research/agent-world-source/root-tree.json'), 'utf8'));
const files = [];
async function acquire(path, expected) {
  const target = resolve(output, 'vendor', path);
  let bytes = existsSync(target) ? readFileSync(target) : null;
  if (!bytes) {
    const file = await client.request(new URL(`https://api.github.com/repos/${repository}/contents/${path}?ref=${commit}`));
    assert.equal(file.sha, expected.sha);
    bytes = Buffer.from(file.content, 'base64');
  }
  const blob = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  assert.equal(blob, expected.sha);
  assert.equal(bytes.length, expected.size);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  files.push({ path, blob, bytes: bytes.length });
}
for (const item of world.tree.filter(item => item.type === 'blob')) await acquire(`world/${item.path}`, item);
await acquire('LICENSE', tree.tree.find(item => item.path === 'LICENSE'));
// The root recursive tree is truncated; only acquire entries actually present.
// No conclusion about missing files is derived from that tree.
const recursive = JSON.parse(readFileSync(resolve(root, '.data/research/agent-world-source/tree.json'), 'utf8'));
const assets = recursive.tree.filter(item => item.type === 'blob' &&
  (/the_ville\/matrix\//.test(item.path) || item.path.endsWith('/visuals/the_ville_jan7.json')));
assert.equal(assets.length, 12);
for (const item of assets) await acquire(item.path, item);
const settings = await client.request(new URL(`https://api.github.com/repos/${repository}/git/trees/5da13a938cbd008fb4db3112ea560d5421cfa8ce`));
assert.equal(settings.truncated, false);
for (const item of settings.tree.filter(item => item.type === 'blob'))
  await acquire(`environment/frontend_server/frontend_server/settings/${item.path}`, item);
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'sources.json'), JSON.stringify({ repository, commit, files }, null, 2));
console.log(JSON.stringify({ repository, commit, verifiedFiles: files.length }));
