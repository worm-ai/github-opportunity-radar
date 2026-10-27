import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4318';
const id = 'agent-world-behavior-2026-10-23';
const output = '.data/browser/agent-world-behavior';
mkdirSync(output, {recursive:true});
const response = await fetch(`${base}/api/v1/experiments`);
assert.equal(response.status,200);
const data = await response.json();
assert.deepEqual(data.warnings,[]);
const record = data.records.find(item => item.id === id);
assert.ok(record);
for (const artifact of record.artifacts) {
  const response = await fetch(`${base}/api/v1/experiments/${id}/artifacts/${artifact.name}`);
  assert.equal(response.status,200);
  assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), artifact.sha256);
}
const browser = await chromium.launch({channel:'msedge',headless:true});
const errors=[],writes=[];
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror', error=>errors.push(error.message));
  page.on('request', request=>{if(['POST','PUT','PATCH','DELETE'].includes(request.method()))writes.push(request.url());});
  await page.goto(`${base}/experiments`);
  await page.getByRole('heading',{name:record.title,exact:true}).waitFor();
  assert.ok(await page.getByText(record.conclusion,{exact:true}).isVisible());
  for (const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    await page.setViewportSize({width,height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  const verification={id,artifactsVerified:record.artifacts.length,errors,writes,observedAt:new Date().toISOString()};
  writeFileSync(`${output}/verification.json`,JSON.stringify(verification,null,2));
  console.log(JSON.stringify(verification));
} finally {await browser.close();}
