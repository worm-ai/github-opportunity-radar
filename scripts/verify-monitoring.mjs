// Real iii + local GitHub HTTP fixture + temporary SQLite + the built browser UI.
// No production writes, GitHub requests or model calls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { RadarStore } from '../packages/storage/dist/index.js';
import { createRepositorySignal } from '../packages/contracts/dist/index.js';
import { GitHubClient } from '../packages/sensor-github/dist/index.js';
import { createRuntimeAdapter } from '../packages/runtime/dist/index.js';
import { registerMonitoringRoutes } from '../apps/server/dist/monitoring.js';
import { buildDiscoveryBrief, discoveryProfile } from '../apps/server/dist/discovery.js';

const require=createRequire(new URL('../apps/server/package.json',import.meta.url));
const Fastify=require('fastify'),staticFiles=require('@fastify/static');
const directory=mkdtempSync(join(tmpdir(),'radar-monitoring-')),dbPath=join(directory,'test.sqlite');
const store=new RadarStore(dbPath),app=Fastify();
const runtime=createRuntimeAdapter(process.env.III_URL||'ws://127.0.0.1:49134',`radar-monitoring-${process.pid}`);
let manager,browser,resourcesClosed=false,operation=null,metadataStatus=200,stars=10,tag='v1',clock=Date.parse('2026-10-20T00:00:00.000Z');
const requests=[],writes=[],errors=[];
const upstream=createServer((request,response)=>{
  const path=new URL(request.url,'http://fixture').pathname;requests.push(path);response.setHeader('content-type','application/json');
  if(path==='/repos/fixture/monitored-component'){
    response.statusCode=metadataStatus;
    return response.end(JSON.stringify(metadataStatus===200?{id:77,full_name:'fixture/monitored-component',html_url:'https://github.com/fixture/monitored-component',description:'Local CSV interfaces for business workflows',language:'Python',private:false,license:{spdx_id:'MIT'},stargazers_count:stars,forks_count:1,open_issues_count:0,created_at:'2026-09-01T00:00:00Z',pushed_at:'2026-10-20T00:00:00Z'}:{message:'Not Found'}));
  }
  if(path.endsWith('/readme'))return response.end(JSON.stringify({encoding:'base64',content:Buffer.from(`Read local CSV inputs. Current tested label: ${tag}.`).toString('base64')}));
  if(path.endsWith('/releases'))return response.end(JSON.stringify([{tag_name:tag,html_url:`https://github.com/fixture/monitored-component/releases/tag/${tag}`} ]));
  if(path.endsWith('/issues'))return response.end('[]');
  response.statusCode=404;response.end('{}');
});
async function until(check){for(let i=0;i<150;i++){const result=await check();if(result)return result;await new Promise(done=>setTimeout(done,100));}throw new Error('Monitoring integration timed out');}
function status(){return {runtime:runtime.mode,engineState:runtime.engineState,completedExecutions:runtime.completedExecutions,github:{tokenConfigured:false},evidence:{running:operation!==null,projectId:null,operation},analysis:{mode:'deepseek',state:'needs_api_key',model:'fixture-only',running:false,lastRun:null}};}
try{
  await new Promise(done=>upstream.listen(0,'127.0.0.1',done));await runtime.ready();
  const client=()=>new GitHubClient({apiBase:`http://127.0.0.1:${upstream.address().port}`});
  const baseline=await client().collectRepository('fixture/monitored-component');
  store.saveRepository(baseline,createRepositorySignal({repositoryId:77,...baseline}),0,[],[],'2026-10-19T00:00:00.000Z');
  app.register(async(api)=>{
    manager=registerMonitoringRoutes(api,{store,runtime,client,busy:()=>operation!==null,collection:value=>{operation=value;},now:()=>new Date(clock)});
    api.get('/projects',async()=>store.getProjects().map(project=>({...project,discovery:discoveryProfile(project)})));
    api.get('/projects/:id',async(request)=>{const project=store.getProject(request.params.id);return {...project,discovery:discoveryProfile(project)};});
    api.get('/projects/:id/observations',async(request)=>store.getProjectObservations(request.params.id));
    api.get('/dashboard',async()=>({...store.dashboard(),...status()}));api.get('/integrations',async()=>status());
    api.get('/health/ready',async()=>({ready:true,...status()}));
    api.get('/analysis/runs',async()=>store.listAnalysisRuns());api.get('/opportunities',async()=>[]);api.get('/research-notes',async()=>[]);
    api.get('/settings',async()=>store.getSettings());api.get('/experiments',async()=>({records:[],warnings:[]}));
    api.get('/discovery/brief',async()=>buildDiscoveryBrief(store.getProjects(),store.getDiscoveryObservations(),null));
  },{prefix:'/api/v1'});
  app.register(staticFiles,{root:resolve(process.env.RADAR_TEST_WEB_DIR||'.data/monitoring-preview'),wildcard:false});
  app.setNotFoundHandler((request,reply)=>request.url.startsWith('/api/')?reply.code(404).send({error:{message:'Unknown fixture route'}}):reply.sendFile('index.html'));
  await app.listen({host:'127.0.0.1',port:0});const base=app.listeningOrigin;
  assert.deepEqual(store.listProjectMonitors(),[]);
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1050}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/v1/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()!=='GET'){
      writes.push(`${request.method()} ${path}`);
      if(!((request.method()==='PUT'&&path==='/api/v1/projects/77/monitor')||(request.method()==='POST'&&path==='/api/v1/projects/77/refresh')))return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${base}/projects/77`);
  const region=page.getByRole('region',{name:'项目持续关注',exact:true}),checkbox=region.getByLabel('持续关注此项目',{exact:true});
  await checkbox.waitFor();assert.equal(await checkbox.isChecked(),false);
  stars=14;tag='v2';
  const firstResponse=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/projects/77/refresh'));
  await region.getByRole('button',{name:'刷新仓库资料',exact:true}).click();assert.equal((await firstResponse).status(),200);
  assert.equal(store.getProject('77').stars,14);assert.equal(store.getProjectMonitor('77').enabled,false);
  await region.getByText('Star +4',{exact:false}).waitFor();
  // Enabling the real scheduler must refresh a repository that is never searched.
  clock+=60_000;stars=17;tag='v3';await checkbox.check();
  await until(()=>store.getProjectMonitor('77')?.lastSuccessAt===new Date(clock).toISOString());
  assert.equal(store.getProject('77').stars,17);assert.equal(store.getProject('77').releaseTag,'v3');
  await region.getByText('Star +3',{exact:false}).waitFor();
  mkdirSync('.data/browser',{recursive:true});await region.scrollIntoViewIfNeeded();await page.screenshot({path:'.data/browser/monitoring-project-desktop.png'});
  await page.goto(base);const row=page.locator('[data-monitor-id="77"]');await row.getByText('Star +3',{exact:false}).waitFor();
  await page.screenshot({path:'.data/browser/monitoring-overview-desktop.png'});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('region',{name:'持续关注动态',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'.data/browser/monitoring-overview-mobile.png'});
  await page.goto(`${base}/projects/77`);await page.getByLabel('持续关注此项目',{exact:true}).uncheck();
  await until(()=>store.getProjectMonitor('77')?.enabled===false);
  metadataStatus=404;clock+=60_000;const beforeFailure=store.getProject('77');
  const failedResponse=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/projects/77/refresh'));
  await page.getByRole('region',{name:'项目持续关注',exact:true}).getByRole('button',{name:'刷新仓库资料',exact:true}).click();assert.equal((await failedResponse).status(),404);
  await page.getByRole('region',{name:'项目持续关注',exact:true}).getByText('not found',{exact:false}).waitFor();
  assert.deepEqual(store.getProject('77'),beforeFailure);assert.equal(store.getProjectMonitor('77').status,'failed');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.data/browser/monitoring-failure-mobile.png'});
  assert.equal((await manager.runDue()).attempted,0);assert.deepEqual(errors,[]);
  assert.ok(!requests.some(path=>path.includes('/search/')));assert.deepEqual(store.listAnalysisRuns(),[]);assert.deepEqual(store.listScanRuns(),[]);
  const observationCount=store.getProjectObservations('77').length;assert.equal(observationCount,3);
  const saved=store.getProjectMonitor('77');await browser.close();browser=null;await manager.stop();await app.close();await runtime.close();store.close();resourcesClosed=true;
  const reopened=new RadarStore(dbPath);try{assert.deepEqual(reopened.getProjectMonitor('77'),saved);assert.equal(reopened.getProject('77').stars,17);}finally{reopened.close();}
  const result={realEngine:true,fixtureHttp:true,scheduledWithoutSearch:true,manualRefreshDoesNotSubscribe:true,cancelledWatchRemainsDisabled:true,failurePreservesEvidence:true,reopenedPersistence:true,observations:observationCount,apiWrites:writes,pageErrors:errors,mobileOverflow:false,productionWrites:0,modelCalls:0};
  writeFileSync('.data/browser/monitoring-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
  await browser?.close();if(!resourcesClosed){await manager?.stop();await app.close();await runtime.close();try{store.close();}catch{}}
  await new Promise(done=>upstream.close(done));
  const target=resolve(directory),parent=resolve(tmpdir());if(!target.startsWith(`${parent}${sep}radar-monitoring-`))throw new Error('Unexpected temporary directory');rmSync(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
