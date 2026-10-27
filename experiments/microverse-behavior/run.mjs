import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd(), work = resolve(root, '.data/experiments/microverse-behavior');
const sources = JSON.parse(readFileSync(resolve(work, 'sources.json'), 'utf8'));
const execution = resolve(work, `execution-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(execution, { recursive: true });
const executable = resolve(work, 'runtime/Godot_v4.4.1-stable_win64_console.exe');
const vendor = resolve(work, 'vendor');
for (const file of sources.files) {
  const bytes = readFileSync(resolve(vendor, file.path));
  assert.equal(createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex'), file.blob);
}
const appData = resolve(execution, 'appdata'); mkdirSync(appData, { recursive: true });
const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: execution, TMP: execution, APPDATA: appData, LOCALAPPDATA: appData };
const stages = [];
async function run(name, args, seconds, extra = {}) {
  const result = await new Promise((resolveRun, reject) => {
    const child = spawn(executable, ['--headless', '--path', vendor, ...args], { cwd: vendor, env: { ...env, ...extra }, windowsHide: true });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, seconds * 1000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timeout); resolveRun({ name, code, signal, timedOut, stdout, stderr }); });
  });
  writeFileSync(resolve(execution, `${name}.stdout.txt`), result.stdout);
  writeFileSync(resolve(execution, `${name}.stderr.txt`), result.stderr);
  stages.push({ name, code: result.code, timedOut: result.timedOut, scriptErrors: (result.stderr.match(/SCRIPT ERROR:/g) ?? []).length, errors: (result.stderr.match(/^ERROR:/gm) ?? []).length });
  console.log(JSON.stringify(stages.at(-1)));
  return result;
}
// First import includes thousands of bundled textures. Its budget is separate
// from the short behavior probes; incomplete import is not a project failure.
const imported = await run('import', ['--editor', '--import'], 480);
if (imported.code !== 0 || imported.timedOut) throw new Error(`Resource import incomplete; preserve ${execution} and do not interpret behavior results.`);
await run('default-start', ['--quit-after', '3'], 20);
// Inject only the diagnostic driver, leaving every upstream file unchanged.
copyFileSync(resolve(root, 'experiments/microverse-behavior/probe.gd'), resolve(vendor, 'behavior_probe.gd'));
for (const phase of ['write', 'load']) {
  await run(phase, ['--script', 'res://behavior_probe.gd'], 30, { MICROVERSE_PHASE: phase, MICROVERSE_OUTPUT: resolve(execution, `${phase}.json`) });
}
const changedUpstreamFiles = sources.files.filter(file => {
  const bytes = readFileSync(resolve(vendor, file.path));
  return createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex') !== file.blob;
}).map(file => file.path);
const result = { repository: sources.repository, commit: sources.commit, executedAt: new Date().toISOString(), verifiedFiles: sources.files.length, changedUpstreamFiles, engineVersion: sources.engineVersion, engineExecutableSha256: createHash('sha256').update(readFileSync(executable)).digest('hex'), stages, driverSha256: createHash('sha256').update(readFileSync(resolve(root, 'experiments/microverse-behavior/probe.gd'))).digest('hex'), outputs: ['write', 'load'].filter(phase => existsSync(resolve(execution, `${phase}.json`))) };
writeFileSync(resolve(execution, 'result.json'), JSON.stringify(result, null, 2));
writeFileSync(resolve(work, 'latest.json'), JSON.stringify({ execution }, null, 2));
console.log(JSON.stringify({ execution, ...result }));
