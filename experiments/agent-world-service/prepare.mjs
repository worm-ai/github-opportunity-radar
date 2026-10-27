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
const output = resolve(root, '.data/experiments/agent-world-service');
const original = resolve(root, '.data/experiments/agent-world-behavior/vendor');
const rootTree = JSON.parse(readFileSync(resolve(root, '.data/research/agent-world-source/root-tree.json'), 'utf8'));
const files = [];
const blobHash = bytes => createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
async function acquire(path, expected) {
  const target = resolve(output, 'vendor', path);
  let bytes = existsSync(target) ? readFileSync(target) : null;
  if (!bytes && existsSync(resolve(original, path))) bytes = readFileSync(resolve(original, path));
  if (!bytes) {
    const file = await client.request(new URL(`https://api.github.com/repos/${repository}/git/blobs/${expected.sha}`));
    assert.equal(file.encoding, 'base64'); bytes = Buffer.from(file.content, 'base64');
  }
  assert.equal(blobHash(bytes), expected.sha, path);
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  files.push({ path, blob: expected.sha, bytes: bytes.length });
  console.log(`Verified ${path}`);
}
async function subtree(path, sha) {
  const cache = resolve(output, `${path.replaceAll('/', '-')}-tree.json`);
  let tree = existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')) : null;
  if (!tree) {
    tree = await client.request(new URL(`https://api.github.com/repos/${repository}/git/trees/${sha}?recursive=1`));
    mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, JSON.stringify(tree, null, 2));
  }
  assert.equal(tree.sha, sha); assert.equal(tree.truncated, false);
  for (const item of tree.tree.filter(item => item.type === 'blob')) await acquire(`${path}/${item.path}`, item);
}
await subtree('mcp_server', rootTree.tree.find(item => item.path === 'mcp_server').sha);
for (const name of ['requirements.txt', 'README.md']) await acquire(name, rootTree.tree.find(item => item.path === name));
// Read targeted trees; the root recursive tree is known to be truncated.
async function treeAt(path, sha) {
  const cache = resolve(output, `${path}-tree.json`);
  const tree = existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8'))
    : await client.request(new URL(`https://api.github.com/repos/${repository}/git/trees/${sha}`));
  assert.equal(tree.sha, sha); assert.equal(tree.truncated, false);
  writeFileSync(cache, JSON.stringify(tree, null, 2)); return tree;
}
const environment = await treeAt('environment', rootTree.tree.find(item => item.path === 'environment').sha);
const frontend = await treeAt('frontend', environment.tree.find(item => item.path === 'frontend_server').sha);
for (const name of ['frontend_server', 'translator']) await subtree(`environment/frontend_server/${name}`, frontend.tree.find(item => item.path === name).sha);
await acquire('environment/frontend_server/manage.py', frontend.tree.find(item => item.path === 'manage.py'));
await subtree('viewer', rootTree.tree.find(item => item.path === 'viewer').sha);
await acquire('environment/frontend_server/global_methods.py', frontend.tree.find(item => item.path === 'global_methods.py'));
const staticTree = await treeAt('static', frontend.tree.find(item => item.path === 'static_dirs').sha);
await acquire('environment/frontend_server/static_dirs/viewer.html', staticTree.tree.find(item => item.path === 'viewer.html'));
writeFileSync(resolve(output, 'sources.json'), JSON.stringify({ repository, commit, files }, null, 2));
console.log(JSON.stringify({ repository, commit, verifiedFiles: files.length }));
