import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root=fileURLToPath(new URL('../../',import.meta.url));
const base=process.env.RADAR_BROWSER_URL||'http://127.0.0.1:4317';
const read=async(path)=>{const response=await fetch(`${base}/api/v1${path}`);assert.equal(response.status,200);return response.json();};
const priorId='efa38c21-2596-4622-89c9-5c6967ff54fb';
const title='Actual：已有拆分能力已实测，停止重复建设通用分类器';
const run=resolve(root,'.data/experiments/actual-ecommerce-noter');
const result=JSON.parse(readFileSync(resolve(run,'result.json'),'utf8'));
const published=JSON.parse(readFileSync(resolve(run,'published.json'),'utf8'));
assert.equal(result.cases.length,9);assert.equal(result.apiWrites,0);
const experiments=await read('/experiments');assert.deepEqual(experiments.warnings,[]);
const record=experiments.records.find((item)=>item.id===published.id);assert.ok(record);
assert.deepEqual(record.projectIds,['1219176154']);assert.equal(record.sources[0].commit,result.commit);
const beforeRuns=await read('/analysis/runs'),beforeDashboard=await read('/dashboard');
const old=await read(`/research-notes/${priorId}`);
let saved=(await read('/research-notes')).find((note)=>note.title===title&&note.author==='assistant');
const errors=[],writes=[];
const browser=await chromium.launch({channel:'msedge',headless:true});
mkdirSync(resolve(root,'.data/browser'),{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}});
  page.on('pageerror',(error)=>errors.push(error.message));
  await page.route('**/api/v1/**',(route)=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()!=='GET'){
      writes.push(path);
      if(request.method()!=='POST'||path!=='/api/v1/research-notes')return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${base}/experiments`);
  const experiment=page.locator('.experiment-record').filter({has:page.getByRole('heading',{name:record.title,exact:true})});
  await experiment.getByText('同日同额时唯一归属',{exact:false}).waitFor();
  await experiment.locator('details > summary').click();
  for(const artifact of record.artifacts){
    const response=await page.request.get(`${base}/api/v1/experiments/${record.id}/artifacts/${artifact.name}`);
    assert.equal(response.status(),200);
    const bytes=await response.body();assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);
  }
  const downloadEvent=page.waitForEvent('download');
  await experiment.getByRole('link',{name:record.artifacts[0].label,exact:true}).click();
  const download=await downloadEvent;await download.saveAs(resolve(root,'.data/browser/actual-baseline-result.json'));
  assert.equal(createHash('sha256').update(readFileSync(resolve(root,'.data/browser/actual-baseline-result.json'))).digest('hex'),record.artifacts[0].sha256);
  await experiment.getByRole('heading',{name:record.title,exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:resolve(root,'.data/browser/actual-baseline-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await experiment.getByRole('heading',{name:record.title,exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:resolve(root,'.data/browser/actual-baseline-mobile.png')});
  await page.setViewportSize({width:1440,height:1050});
  if(!saved){
    assert.equal(old.supersededBy,null,'Reassess a different existing revision before saving');
    const params=new URLSearchParams();for(const id of old.projectIds)params.append('project',id);
    params.set('issue','4616');params.set('note',priorId);
    await page.goto(`${base}/opportunities?${params}`);
    const form=page.getByRole('form',{name:'保存研究判断',exact:true});
    await form.waitFor();assert.equal(await form.getByLabel('判断标题',{exact:true}).inputValue(),old.title);
    await form.getByLabel('判断标题',{exact:true}).fill(title);
    await form.getByLabel('研究决定',{exact:true}).selectOption('stop');
    await form.getByLabel('判断记录者',{exact:true}).selectOption('assistant');
    await form.getByLabel('判断结论',{exact:true}).fill('已运行固定后继 CLI 的九组合成 dry-run：单笔匹配、商品级拆分预览、多订单合并及唯一金额退款通过。一个50英镑订单对应20/30两次发货扣款时匹配0/2；两个同日同额订单调换CSV行序会改变单个输出候选。等价商品退款已有Candidates提示，工具本就将输出称作潜在匹配。实际源码与输出说明已有能力不可忽略，边界也不能直接包装成商机。因此停止另做通用分类器；更支持先评估已有项目的局部改进。真实CLI和原始输出已归档“技术实测”，但账本接口是本地替身，未执行真实Actual服务或写入模式，也没有用户或付费证据。');
    await form.getByLabel('判断下一步',{exact:true}).fill(`归档实测 ${record.id}。保留分批扣款和候选歧义的复核条件；若今后有真实重复任务证明局部修改不足，再比较现有替代和跨组件工作流。当前停止在此案例继续扩建，转向其他任务。不要把合成边界频率当成市场规模，也不要把CLI到替身接口通过当成真实服务兼容已验证。`);
    assert.equal(await form.locator('select').count()>=old.evidence.length,true);
    const responseEvent=page.waitForResponse((response)=>response.request().method()==='POST'&&response.url().endsWith('/api/v1/research-notes'));
    await form.getByRole('button',{name:'保存研究判断',exact:true}).click();
    const response=await responseEvent;assert.equal(response.status(),201);saved=await response.json();
  }
  assert.equal(saved.author,'assistant');assert.equal(saved.decision,'stop');assert.equal(saved.supersedesId,priorId);
  assert.equal(saved.evidence.length,old.evidence.length);assert.ok(saved.evidenceStates.every((state)=>state==='same'));
  assert.equal((await read(`/research-notes/${priorId}`)).supersededBy,saved.id);
  await page.goto(base);
  const note=page.locator(`[data-note-id="${saved.id}"]`);await note.getByRole('heading',{name:title,exact:true}).waitFor();
  await note.scrollIntoViewIfNeeded();await page.screenshot({path:resolve(root,'.data/browser/actual-baseline-decision.png')});
  const report=await page.request.get(`${base}/api/v1/research-notes/${saved.id}/report.md`);assert.equal(report.status(),200);assert.ok((await report.text()).includes(priorId));
  await page.goto(`${base}/opportunities#research-notes`);await page.getByLabel('含历史判断',{exact:true}).check();
  await page.locator(`[data-note-id="${priorId}"]`).getByRole('heading',{name:old.title,exact:true}).waitFor();
  assert.deepEqual((await read('/analysis/runs')).map((item)=>item.id),beforeRuns.map((item)=>item.id));
  const after=await read('/dashboard');assert.equal(after.lastScan.id,beforeDashboard.lastScan.id);assert.equal(after.projectCount,beforeDashboard.projectCount);assert.equal(after.issueSampleCount,beforeDashboard.issueSampleCount);
  assert.deepEqual(errors,[]);
  const output={observedAt:new Date().toISOString(),experimentId:record.id,decision:saved,priorDecisionId:priorId,artifactsChecked:record.artifacts.length,historyPreserved:true,browser:'Edge',pageErrors:errors,writes,apiFinancialWrites:0,paidModelCalls:0};
  mkdirSync(resolve(root,'.data/research'),{recursive:true});writeFileSync(resolve(root,'.data/research/actual-order-baseline-decision-2026-10-20.json'),JSON.stringify(output,null,2));
  console.log(JSON.stringify({experimentId:record.id,decisionId:saved.id,supersedesId:priorId,artifactsChecked:record.artifacts.length,historyPreserved:true,writes,pageErrors:errors,paidModelCalls:0}));
}finally{await browser.close();}
