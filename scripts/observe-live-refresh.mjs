// A real, user-authorized repository refresh in the running workspace. This is
// not a fixture test: it writes monitoring state and may update real evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const id=process.argv[2];assert.match(id??'',/^\d+$/,'Pass the actual project ID explicitly');
const base=process.env.RADAR_BROWSER_URL||'http://127.0.0.1:4317';
const read=async path=>{const response=await fetch(`${base}/api/v1${path}`);assert.equal(response.status,200);return response.json();};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const before={project:await read(`/projects/${id}`),observations:await read(`/projects/${id}/observations`),runs:(await read('/analysis/runs')).map(run=>run.id),monitor:await read(`/projects/${id}/monitor`)};
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],writes=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/v1/**',route=>{const request=route.request(),path=new URL(request.url()).pathname;if(request.method()!=='GET'){writes.push(`${request.method()} ${path}`);if(request.method()!=='POST'||path!==`/api/v1/projects/${id}/refresh`)return route.abort();}return route.continue();});
try{
 await page.goto(`${base}/projects/${id}`);
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/api/v1/projects/${id}/refresh`),{timeout:60000});
 await page.getByRole('region',{name:'项目持续关注',exact:true}).getByRole('button',{name:'刷新仓库资料',exact:true}).click();
 const http=await response,body=await http.json();
 const after={project:await read(`/projects/${id}`),observations:await read(`/projects/${id}/observations`),monitor:await read(`/projects/${id}/monitor`)};
 const retained=digest(before.project)===digest(after.project),observationsRetained=digest(before.observations)===digest(after.observations);
 if(!http.ok()){
  assert.equal(after.monitor.status,'failed');assert.equal(retained,true);assert.equal(observationsRetained,true);
  assert.equal(after.monitor.lastSuccessAt,before.monitor.lastSuccessAt);
 }
 assert.equal(after.monitor.enabled,before.monitor.enabled);
 await page.goto(base);
 if(!http.ok())await page.getByRole('status',{name:'采集状态提醒',exact:true}).getByText('关注项目未完整刷新',{exact:false}).waitFor();
 await page.screenshot({path:'.data/browser/live-refresh-home-desktop.png'});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'.data/browser/live-refresh-home-mobile.png'});
 assert.deepEqual((await read('/analysis/runs')).map(run=>run.id),before.runs);assert.deepEqual(errors,[]);
 const result={observedAt:new Date().toISOString(),projectId:id,fullName:before.project.fullName,httpStatus:http.status(),error:http.ok()?null:body.error,refreshStatus:after.monitor.status,projectSnapshotRetained:retained,observationsRetained,enabledUnchanged:after.monitor.enabled===before.monitor.enabled,lastSuccessAt:after.monitor.lastSuccessAt,lastAttemptAt:after.monitor.lastAttemptAt,nextDueAt:after.monitor.nextDueAt,writes,pageErrors:errors,mobileOverflow:false,newModelCalls:0};
 writeFileSync('.data/research/live-refresh-observation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
