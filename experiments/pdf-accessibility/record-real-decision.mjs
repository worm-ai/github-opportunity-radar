// Authorized local research revision through the real UI; no model or outreach.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { researchSources } from '../../packages/contracts/dist/research.js';

const base='http://127.0.0.1:4317',priorId='7bdaa824-e3d0-474a-acd5-d332defe6dfc';
const read=async path=>{const response=await fetch(`${base}/api/v1${path}`);assert.equal(response.status,200);return response.json();};
const before={runs:(await read('/analysis/runs')).map(run=>run.id),scan:(await read('/dashboard')).lastScan.id};
const prior=await read(`/research-notes/${priorId}`),projects=await Promise.all(prior.projectIds.map(id=>read(`/projects/${id}`)));
const sources=researchSources(projects);
for(const evidence of prior.evidence){const source=sources.find(item=>JSON.stringify(item.ref)===JSON.stringify(evidence.ref));assert.ok(source?.text.includes(evidence.quote),'Source changed; reassess before recording a revision');}
const published=JSON.parse(readFileSync('.data/experiments/pdf-real-corpus/published.json','utf8'));
const experiment=(await read('/experiments')).records.find(record=>record.id===published.id);assert.ok(experiment);
const title='真实66页复核后：等待专家评估，暂停PDF自动交付产品化';
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],writes=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/v1/**',route=>{const request=route.request(),path=new URL(request.url()).pathname;if(request.method()!=='GET'){writes.push(`${request.method()} ${path}`);if(request.method()!=='POST'||path!=='/api/v1/research-notes')return route.abort();}return route.continue();});
try{
 let saved=(await read('/research-notes')).find(note=>note.supersedesId===priorId&&note.title===title);
 if(!saved){
  assert.equal(prior.supersededBy,null,'Follow the latest research revision instead');
  const params=new URLSearchParams();for(const id of prior.projectIds)params.append('project',id);params.set('issue',String(prior.originIssue.issueNumber));params.set('note',prior.id);
  await page.goto(`${base}/opportunities?${params}`);
  const form=page.getByRole('form',{name:'保存研究判断',exact:true});
  await form.getByLabel('判断标题',{exact:true}).fill(title);
  await form.getByLabel('研究决定',{exact:true}).selectOption('watch');
  await form.getByLabel('判断记录者',{exact:true}).selectOption('assistant');
  await form.getByLabel('判断结论',{exact:true}).fill('已将开源自动打标与独立校验连接到一份真实66页公开游戏手册：逐页文本、同一渲染器72DPI像素及122个链接目标均保留，机械失败规则8→3，但仍不合规。PDF第13页的8列表格被标成段落和列表，41个Figure的Alt全部为image N；代理只对第13页做了针对性视觉/结构核对。预处理可行，语义复核仍是关键交付工作；暂停自动交付产品化，等待专家评估。原计划另外11份材料因当前HTTPS证书问题未取得；本次离线清单未把它们算作验证输入。单份手册不代表机构语料，未测人工收益、采用或付费。ASU已有整体方案，上游已有企业功能，不能据此声称市场空白。');
  await form.getByLabel('判断下一步',{exact:true}).fill(`技术实测${experiment.id}已归档十份结果与可交接任务包。需要无障碍专家优先核对PDF页3/4/8/13/58的导航、图片、表格和阅读顺序，并使用辅助技术比较现有完整方案的修复用时。129个重叠待复核任务不是确认缺陷数或工时；目前专家完成0项、用户试用0次。只有出现实际工作量收益和文档责任团队采用意愿才重新启动产品化；若现成方案或上游小改足够则采用/停止独立平台。未获授权不联系讨论作者。`);
  const response=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/api/v1/research-notes'));
  await form.getByRole('button',{name:'保存研究判断',exact:true}).click();const http=await response;assert.equal(http.status(),201);saved=await http.json();
 }
 assert.equal(saved.supersedesId,priorId);assert.equal(saved.author,'assistant');assert.equal(saved.decision,'watch');
 assert.deepEqual(saved.evidenceStates,prior.evidence.map(()=>'same'));assert.equal((await read(`/research-notes/${priorId}`)).supersededBy,saved.id);
 await page.goto(base);const card=page.locator(`[data-note-id="${saved.id}"]`);await card.getByRole('heading',{name:title,exact:true}).waitFor();await card.scrollIntoViewIfNeeded();await page.screenshot({path:'.data/browser/pdf-public-decision-desktop.png'});
 for(const artifact of experiment.artifacts){const response=await page.request.get(`${base}/api/v1/experiments/${experiment.id}/artifacts/${artifact.name}`);assert.equal(response.status(),200);assert.equal(createHash('sha256').update(await response.body()).digest('hex'),artifact.sha256);}
 const report=await page.request.get(`${base}/api/v1/research-notes/${saved.id}/report.md`);assert.equal(report.status(),200);assert.ok((await report.text()).includes(prior.id));
 await page.goto(`${base}/experiments`);await page.getByRole('heading',{name:experiment.title,exact:true}).waitFor();await page.screenshot({path:'.data/browser/pdf-public-experiment-desktop.png'});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.data/browser/pdf-public-experiment-mobile.png'});
 await page.goto(base);await page.locator(`[data-note-id="${saved.id}"]`).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.data/browser/pdf-public-decision-mobile.png'});
 assert.deepEqual((await read('/analysis/runs')).map(run=>run.id),before.runs);assert.equal((await read('/dashboard')).lastScan.id,before.scan);assert.deepEqual(errors,[]);
 const result={observedAt:new Date().toISOString(),decisionId:saved.id,supersedesId:priorId,decision:saved.decision,experimentId:experiment.id,evidenceCount:saved.evidence.length,artifactHashesVerified:experiment.artifacts.length,writes,pageErrors:errors,mobileOverflow:false,newModelCalls:0};
 writeFileSync('.data/research/pdf-public-decision.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
