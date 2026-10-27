import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4318';
const runId = 'd79a1f02-17c8-4d6d-bf02-1be4e122452f';
const id = 'agent-world-service-2026-10-23';
const output = '.data/browser/agent-world-service';
mkdirSync(output, {recursive: true});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function get(path) {const r = await fetch(`${base}/api/v1/${path}`); assert.equal(r.status, 200); return r.json();}
const [before, notes, archive, sources] = await Promise.all([get(`demands/${runId}`), get('research-notes'), get('experiments'), get(`demands/${runId}/note-sources`)]);
assert.deepEqual(archive.warnings, []);
const record = archive.records.find(r => r.id === id);
assert.ok(record); assert.equal(record.artifacts.length, 10);
assert.ok(sources.sources.some(s => s.ref?.experimentId === id && s.text.includes(record.conclusion)));
for (const artifact of record.artifacts) {
  const r = await fetch(`${base}/api/v1/experiments/${id}/artifacts/${artifact.name}`);
  assert.equal(r.status, 200); assert.equal(sha(Buffer.from(await r.arrayBuffer())), artifact.sha256);
}
const errors = [], writes = [];
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {if(!['GET','HEAD','OPTIONS'].includes(r.method())) writes.push(r.url());});
  await page.goto(`${base}/research?run=${runId}`);
  const evidence = page.getByRole('region',{name:'相关人工实测',exact:true});
  const subject = evidence.locator('.demand-experiment').filter({has:page.getByRole('heading',{name:record.title,exact:true})});
  await subject.getByText('sbenodiz/agent-world · 本地改造版 · 上游提交仅为基线',{exact:true}).waitFor();
  await subject.getByText(record.conclusion,{exact:false}).waitFor();
  const event = page.waitForEvent('download');
  await subject.getByRole('link',{name:'下载改造代码与补丁',exact:true}).click();
  await (await event).saveAs(`${output}/modification.json`);
  assert.equal(sha(readFileSync(`${output}/modification.json`)),record.sources[0].modification.sha256);
  const patch = JSON.parse(readFileSync(`${output}/modification.json`,'utf8'));
  assert.ok(patch.files.some(f=> f.name==='run.py' && f.content.includes('streamablehttp_client')));
  const bundleEvent = page.waitForEvent('download');
  await evidence.getByRole('button',{name:'导出研究与补充实测',exact:true}).click();
  await (await bundleEvent).saveAs(`${output}/bundle.json`);
  const bundle = JSON.parse(readFileSync(`${output}/bundle.json`,'utf8'));
  assert.deepEqual(bundle.run,before);
  assert.deepEqual(bundle.experiments.find(e=>e.record.id===id).record,record);
  for (const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    await page.setViewportSize({width,height}); await subject.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`${output}/${name}.png`});
  }
  await subject.getByRole('link',{name:'查看原始实测与产物下载',exact:true}).click();
  await page.waitForURL(`**/experiments#experiment-${id}`); await page.reload();
  const article=page.locator(`#experiment-${id}`);
  await article.getByText(record.conclusion,{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(await get(`demands/${runId}`),before);
  assert.deepEqual(await get('research-notes'),notes);
  assert.deepEqual(errors,[]); assert.deepEqual(writes,[]);
  const receipt={verifiedAt:new Date().toISOString(),experimentId:id,artifacts:record.artifacts.length,historicalDemandAndNotesUnchanged:true,desktopMobileOverflow:false,errors,writes};
  writeFileSync(`${output}/verification.json`,JSON.stringify(receipt,null,2)); console.log(JSON.stringify(receipt));
} finally {await browser.close();}
