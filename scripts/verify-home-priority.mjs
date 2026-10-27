// Read-only production snapshots behind an isolated preview server. Failure
// states are browser fixtures, never writes to production or remote API probes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium } from '@playwright/test';

const production=process.env.RADAR_BROWSER_URL||'http://127.0.0.1:4317';
const web=resolve(process.env.RADAR_TEST_WEB_DIR||'.data/home-preview');
const read=async path=>{const response=await fetch(`${production}/api/v1${path}`);assert.equal(response.status,200);return response.json();};
const [dashboard,monitoring,notes,runs]=await Promise.all(['/dashboard','/monitoring','/research-notes','/analysis/runs'].map(read));
assert.ok(notes.some(note=>!note.supersededBy),'The snapshot must contain an actual current research note');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(request,response)=>{
 try{
  if(request.method!=='GET'){response.writeHead(405);response.end();return;}
  const pathname=new URL(request.url,'http://preview').pathname;
  if(pathname.startsWith('/api/')){const upstream=await fetch(`${production}${request.url}`);response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json'});response.end(Buffer.from(await upstream.arrayBuffer()));return;}
  let file=resolve(web,`.${decodeURIComponent(pathname)}`);
  if(file!==web&&!file.startsWith(web+sep)){response.writeHead(400);response.end();return;}
  if(!existsSync(file)||!statSync(file).isFile())file=resolve(web,'index.html');
  response.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});response.end(readFileSync(file));
 }catch{response.writeHead(500);response.end('Preview request failed');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],writes=[],layouts=[],checks=[];
let fixture=null;
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()!=='GET'){writes.push(`${request.method()} ${url.pathname}`);return route.abort();}
  assert.equal(url.origin,base,'Browser requests must stay within the local preview');
  if(fixture&&url.pathname==='/api/v1/dashboard')return route.fulfill({json:fixture.dashboard??dashboard});
  if(fixture&&url.pathname==='/api/v1/monitoring')return route.fulfill(fixture.monitoringError?{status:503,json:{error:{message:'Isolated fixture: monitoring unavailable'}}}:{json:fixture.monitoring??monitoring});
  if(fixture?.notes&&url.pathname==='/api/v1/research-notes')return route.fulfill({json:fixture.notes});
  return route.continue();
 });
 for(const viewport of [{width:1440,height:1050},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto(base);await page.locator('.discovery-card').first().waitFor();await page.locator('.research-note').first().waitFor();
  const layout=await page.evaluate(()=>{const box=s=>{const b=document.querySelector(s).getBoundingClientRect();return{top:Math.round(b.top+scrollY),height:Math.round(b.height)}};return{discovery:box('.discovery-workbench'),firstCapability:box('.discovery-card'),firstCapabilityName:box('.discovery-card .repo-name'),notes:box('.research-notebook'),monitoring:box('.monitoring-overview'),pageHeight:document.documentElement.scrollHeight,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert.ok(layout.discovery.top<layout.monitoring.top&&layout.discovery.top<layout.notes.top);
  assert.ok(layout.firstCapabilityName.top+layout.firstCapabilityName.height<viewport.height-(viewport.width<760?58:0),'The first project name must fit above the mobile navigation in the initial viewport');
  assert.equal(layout.overflow,false);layouts.push({viewport,...layout});
  await page.screenshot({path:`.data/browser/home-after-${viewport.width}.png`});
  const note=page.locator('.research-note').first();assert.equal(await note.locator('.research-note-conclusion').isVisible(),false);
  await page.getByRole('navigation',{name:'工作台区域',exact:true}).getByRole('link',{name:'研究判断',exact:true}).click();
  const summary=note.locator('.research-note-review > summary');await summary.focus();await summary.press('Enter');assert.equal(await note.locator('.research-note-conclusion').isVisible(),true);
  const id=await note.getAttribute('data-note-id');assert.equal(await note.locator('.research-note-conclusion').textContent(),notes.find(n=>n.id===id).conclusion);
  await summary.press('Enter');assert.equal(await note.locator('.research-note-conclusion').isVisible(),false);
  await page.getByRole('navigation',{name:'工作台区域',exact:true}).getByRole('link',{name:'持续关注',exact:true}).click();
  assert.ok(Math.abs(await page.locator('#monitoring').evaluate(e=>e.getBoundingClientRect().top)-85)<4,'Anchor should clear the sticky header');
 }
 checks.push('Desktop/mobile first project visible; keyboard disclosure preserves the full conclusion; section shortcuts work');
 const healthyDashboard={...dashboard,lastScan:dashboard.lastScan?{...dashboard.lastScan,status:'succeeded',error:null}:null};
 const healthyMonitoring={...monitoring,pausedUntil:null,items:monitoring.items.map(item=>({...item,status:'succeeded',error:null,warning:null}))};
 const show=async value=>{fixture={dashboard:healthyDashboard,monitoring:healthyMonitoring,...value};await page.goto(base);await page.locator('.discovery-card').first().waitFor();};
 await show({dashboard:{...healthyDashboard,lastScan:{...dashboard.lastScan,status:'failed',error:'Isolated fixture: TLS trust failure'}}});
 const notice=page.getByRole('status',{name:'采集状态提醒',exact:true});await notice.getByText('最近一次扫描失败',{exact:false}).waitFor();assert.ok(await notice.getByRole('link',{name:'查看扫描结果'}).isVisible());checks.push('Failed scan warns before discovery');
 await show({dashboard:{...healthyDashboard,lastScan:{...dashboard.lastScan,status:'partial'}}});await notice.getByText('扫描仅部分成功',{exact:false}).waitFor();checks.push('Partial scan is distinguished from a complete refresh');
 assert.ok(healthyMonitoring.items.length,'The actual snapshot must include a monitored project');
 for(const status of ['failed','partial']){await show({monitoring:{...healthyMonitoring,items:healthyMonitoring.items.map((item,index)=>index?item:{...item,status,error:status==='failed'?'fixture failure':null,warning:status==='partial'?'fixture missing README':null})}});await notice.getByText('1 个关注项目未完整刷新',{exact:false}).waitFor();assert.ok(await notice.getByRole('link',{name:'查看关注详情'}).isVisible());}
 checks.push('Failed/partial monitored refresh keeps old-data warning reachable');
 await show({monitoring:{...healthyMonitoring,pausedUntil:new Date(Date.now()+300000).toISOString()}});await notice.getByText('GitHub 限流',{exact:false}).waitFor();checks.push('Active rate-limit pause is visible');
 await show({monitoringError:true});await notice.getByText('持续关注状态暂时无法读取',{exact:false}).waitFor();checks.push('Unreadable monitoring status does not look healthy');
 const changed=structuredClone(notes),current=changed.find(note=>!note.supersededBy);current.evidenceStates[0]='changed';
 await show({notes:changed});const note=page.locator(`[data-note-id="${current.id}"]`);await note.getByText('已采集来源发生变化',{exact:false}).waitFor();assert.equal(await note.locator('.research-note-conclusion').isVisible(),false);checks.push('Changed-source warning remains visible in a collapsed note');
 await page.goto(`${base}/opportunities`);await note.waitFor();assert.equal(await note.locator('.research-note-conclusion').isVisible(),true);assert.equal(await note.locator('.research-note-review').count(),0);
 await page.getByRole('checkbox',{name:'含历史判断'}).check();assert.equal(await page.locator('.research-note').count(),notes.length);checks.push('Full research view and history remain available');
 await show({});assert.equal(await notice.count(),0);checks.push('Recovered status clears the notice');
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 assert.deepEqual((await read('/analysis/runs')).map(run=>run.id),runs.map(run=>run.id));
 assert.deepEqual((await read('/research-notes')).map(note=>note.id),notes.map(note=>note.id));
 const result={observedAt:new Date().toISOString(),source:'actual read-only workspace snapshots; failure states are isolated browser fixtures',layouts,checks,pageErrors:errors,productionWrites:writes,newModelCalls:0};
 writeFileSync('.data/research/home-priority-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(done=>server.close(done));}
