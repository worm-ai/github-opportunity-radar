// Assistant-directed static audit. Reads public fixed commits only, never executes upstream code.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

process.loadEnvFile('.env');
const root = '.data/experiments/social-alternatives-source-2026-10-23';
const candidates = [
  { key: 'ai-town', repository: 'a16z-infra/ai-town', commit: '8e05997f2409275669c8344b84a51692e83f3f33', scopes: ['convex', 'src', 'data'] },
  { key: 'generative-agents', repository: 'joonspk-research/generative_agents', commit: 'fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4', scopes: ['reverie/backend_server'] },
];
mkdirSync(root, { recursive: true });
const request = async (repository, suffix) => {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'opportunity-radar-static-audit', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const url = `https://api.github.com/repos/${repository}/${suffix}`;
  // This standalone Windows audit uses the OS trust store; no production internals exported.
  if (process.platform === 'win32') {
    const child = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], {
      input: `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'opportunity-radar-static-audit' }
if ($env:GITHUB_TOKEN) { $headers['Authorization'] = 'Bearer ' + $env:GITHUB_TOKEN }
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $env:RADAR_STATIC_AUDIT_URL -Headers $headers -TimeoutSec 20
  [Console]::Out.Write($response.Content)
} catch { [Console]::Error.Write('GitHub static audit request failed'); exit 1 }

`,
      env: { ...process.env, RADAR_STATIC_AUDIT_URL: url },
      encoding: 'utf8', timeout: 25000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    });
    assert.equal(child.status, 0, 'GitHub static audit request failed or timed out');
    return JSON.parse(child.stdout);
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, `GitHub read failed: ${response.status}`);
  return response.json();
};
const load = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));

if (process.argv.includes('--inventory')) {
  const results = await Promise.allSettled(candidates.map(async candidate => {
    const output = `${root}/${candidate.key}-inventory.json`;
    if (existsSync(output)) return { key: candidate.key, cached: true, files: load(output).files };
    const tree = await request(candidate.repository, `git/trees/${candidate.commit}`);
    assert.equal(tree.truncated, false);
    const files = tree.tree.filter(item => item.type === 'blob').map(item => ({ path: item.path, sha: item.sha, size: item.size }));
    for (const scope of candidate.scopes) {
      let current = tree;
      for (const part of scope.split('/')) {
        const directory = current.tree.find(item => item.path === part && item.type === 'tree');
        assert.ok(directory, `Missing actual scope ${scope}`);
        current = await request(candidate.repository, `git/trees/${directory.sha}`);
        assert.equal(current.truncated, false);
      }
      const expanded = await request(candidate.repository, `git/trees/${current.sha}?recursive=1`);
      assert.equal(expanded.truncated, false);
      files.push(...expanded.tree.filter(item => item.type === 'blob' && item.mode !== '120000').map(item => ({ path: `${scope}/${item.path}`, sha: item.sha, size: item.size })));
    }
    save(output, { ...candidate, observedAt: new Date().toISOString(), completeRepository: false, files });
    return { key: candidate.key, cached: false, files };
  }));
  for (const result of results) {
    if (result.status === 'rejected') { console.error(String(result.reason)); process.exitCode = 1; }
    else console.log(JSON.stringify({ key: result.value.key, cached: result.value.cached, files: result.value.files.length }));
  }
} else {
  const chosen = process.argv.slice(2);
  assert.ok(chosen.length && chosen.length <= 10, 'Use key:path arguments, at most ten per invocation');
  for (const selection of chosen) {
    const index = selection.indexOf(':');
    const key = selection.slice(0, index), path = selection.slice(index + 1);
    const candidate = candidates.find(item => item.key === key);
    assert.ok(candidate && path && !path.includes('..') && !path.includes('\\'));
    const inventory = load(`${root}/${key}-inventory.json`);
    const entry = inventory.files.find(item => item.path === path);
    assert.ok(entry && entry.size <= 512000, `Path not in scoped inventory: ${selection}`);
    const output = `${root}/${key}/${path}`;
    mkdirSync(output.slice(0, output.lastIndexOf('/')), { recursive: true });
    const receiptPath = `${output}.source.json`;
    const bytes = existsSync(receiptPath) ? Buffer.from(readFileSync(output)) : Buffer.from((await request(candidate.repository, `git/blobs/${entry.sha}`)).content, 'base64');
    const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(sha, entry.sha);
    assert.equal(bytes.length, entry.size);
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assert.ok(!content.includes('\0'));
    const receipt = { repository: candidate.repository, commit: candidate.commit, path, blob: sha, bytes: bytes.length, lines: content.split('\n').length, verifiedBlob: true, runtimeExecuted: false, url: `https://github.com/${candidate.repository}/blob/${candidate.commit}/${path}` };
    writeFileSync(output, bytes);
    save(receiptPath, receipt);
    console.log(JSON.stringify(receipt));
  }
}
