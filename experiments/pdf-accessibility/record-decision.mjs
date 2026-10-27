// Real workspace write through the UI; records assistant research, no model or outreach.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { researchSources } from '../../packages/contracts/dist/research.js';

const base='http://127.0.0.1:4317',ids=['857058924','982587624','53291241'];
const read=async path=>{const response=await fetch(`${base}/api/v1${path}`);assert.equal(response.status,200);return response.json();};
const before={runs:(await read('/analysis/runs')).map(run=>run.id),scan:(await read('/dashboard')).lastScan.id};
const projects=await Promise.all(ids.map(id=>read(`/projects/${id}`))),sources=researchSources(projects);
const title='高校批量PDF：继续核查本地预处理与人工复核交付，暂不另建编辑器';
const evidence=[
 {projectId:ids[0],kind:'issue',issueNumber:38,quote:'This limitation creates significant operational overhead for bulk document processing with complex folder hierarchies.'},
 {projectId:ids[0],kind:'issue',issueNumber:52,quote:'In the current implementation, if a user has provided their own alt-text for an image, it will get replaced by the AI-generated alt-text.'},
 {projectId:ids[0],kind:'comment',issueNumber:26,commentId:4042767031,quote:'In my case, it was overly aggressive with interpreting non-table content as a table and ended up incorrectly tagging the content.'},
 {projectId:ids[1],kind:'readme',quote:'Auto-tagging → Tagged PDF for untagged PDFs'},
 {projectId:ids[1],kind:'readme',quote:'PDF/UA-1, PDF/UA-2 export | 💼 Available | Enterprise'},
 {projectId:ids[2],kind:'readme',quote:'Command line and GUI industry supported PDF/A and PDF/UA Validation'},
].map(({quote,...ref})=>{const source=sources.find(item=>Object.entries(ref).every(([key,value])=>item.ref[key]===value));assert.ok(source?.text.includes(quote),`Reassess missing source ${JSON.stringify(ref)}`);return{key:source.key,quote};});
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],writes=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/v1/**',route=>{const request=route.request(),path=new URL(request.url()).pathname;if(request.method()!=='GET'){writes.push(`${request.method()} ${path}`);if(request.method()!=='POST'||path!=='/api/v1/research-notes')return route.abort();}return route.continue();});
try{
 let saved=(await read('/research-notes')).find(note=>note.title===title&&note.author==='assistant');
 if(!saved){
  await page.goto(`${base}/opportunities?${ids.map(id=>`project=${id}`).join('&')}&issue=38`);
  assert.equal(await page.getByLabel('研究问题起点',{exact:true}).inputValue(),`${ids[0]}:38`);
  await page.locator('.research-note-editor > summary').click();
  const form=page.getByRole('form',{name:'保存研究判断',exact:true});
  await form.getByLabel('判断标题',{exact:true}).fill(title);
  await form.getByLabel('记录的研究问题',{exact:true}).fill('对批量整理教学与公共文档的团队，OpenDataLoader自动打标、veraPDF机械检查及人工复核队列，能否减少目录整理和检查耗时，同时保留已有人工标签？ASU是现有整体方案与问题来源，不强加成第三个运行组件。');
  await form.getByLabel('研究决定',{exact:true}).selectOption('continue');
  await form.getByLabel('判断记录者',{exact:true}).selectOption('assistant');
  await form.getByLabel('判断结论',{exact:true}).fill('保留一个有条件继续核查的交付服务方向：OpenDataLoader负责本地自动打标，veraPDF负责自动可判定的标准检查，薄编排层保留部门目录和输入哈希、已有标签先不重写并生成逐份人工复核队列。公开讨论确实陈述批量层级处理负担、人工Alt被覆盖及错误表格标签；这些作者陈述未证明需求规模或付费。固定版本的四份合成PDF实测已连接两个工具：同名平铺会覆盖，重新打标把人工Alt变为image 1；分目录输出及原字节保留避开了这两个样本风险。两份新打标文件仍各有5条PDF/UA失败规则，包含合成输入已知缺少的字体、语言和元数据，不能外推工具错误率。ASU早有修复前后检查，上游也已有企业导出与工作室，因此不另建通用编辑器、不声称市场空白或自动合规。当前只证明小样本接口和分流可行。');
  await form.getByLabel('判断下一步',{exact:true}).fill('先选10至20份可公开教学/公共文档，覆盖同名目录、已有人工Alt、表格和扫描件，与现有整体方案比较目录处理、人工纠错时间及漏项；需要无障碍专家和辅助技术复核后才评价可用性。若只需上游小修或既有产品已足够，停止独立平台化。服务交付、真实采用和付费均待验证；不要联系讨论作者或把代理实验当用户验证。技术实测页已归档五份可下载产物。');
  for(let i=0;i<evidence.length;i++){
   if(i)await form.getByRole('button',{name:'增加一条依据',exact:true}).click();
   await form.getByLabel(`判断来源 ${i+1}`,{exact:true}).selectOption(evidence[i].key);
   await form.getByLabel(`判断引用 ${i+1}`,{exact:true}).fill(evidence[i].quote);
  }
  const response=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/api/v1/research-notes'));
  await form.getByRole('button',{name:'保存研究判断',exact:true}).click();const http=await response;assert.equal(http.status(),201);saved=await http.json();
 }
 assert.equal(saved.author,'assistant');assert.equal(saved.decision,'continue');assert.deepEqual(saved.evidenceStates,evidence.map(()=>'same'));
 await page.goto(base);const card=page.locator(`[data-note-id="${saved.id}"]`);await card.getByRole('heading',{name:title,exact:true}).waitFor();await card.scrollIntoViewIfNeeded();await page.screenshot({path:'.data/browser/pdf-triage-decision-desktop.png'});
 const published=JSON.parse(readFileSync('.data/experiments/pdf-accessibility/published.json','utf8'));
 const experiment=(await read('/experiments')).records.find(record=>record.id===published.id);assert.ok(experiment);
 for(const artifact of experiment.artifacts){const response=await page.request.get(`${base}/api/v1/experiments/${experiment.id}/artifacts/${artifact.name}`);assert.equal(response.status(),200);assert.equal(createHash('sha256').update(await response.body()).digest('hex'),artifact.sha256);}
 const report=await page.request.get(`${base}/api/v1/research-notes/${saved.id}/report.md`);assert.equal(report.status(),200);assert.ok((await report.text()).includes('4042767031'));
 await page.goto(`${base}/experiments`);await page.getByRole('heading',{name:experiment.title,exact:true}).waitFor();await page.screenshot({path:'.data/browser/pdf-triage-experiment-desktop.png'});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.data/browser/pdf-triage-experiment-mobile.png'});
 await page.goto(base);await page.locator(`[data-note-id="${saved.id}"]`).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.data/browser/pdf-triage-decision-mobile.png'});
 assert.deepEqual((await read('/analysis/runs')).map(run=>run.id),before.runs);assert.equal((await read('/dashboard')).lastScan.id,before.scan);assert.deepEqual(errors,[]);
 const result={observedAt:new Date().toISOString(),decisionId:saved.id,experimentId:experiment.id,evidenceCount:evidence.length,artifactHashesVerified:experiment.artifacts.length,writes,pageErrors:errors,mobileOverflow:false,newModelCalls:0};
 writeFileSync('.data/research/pdf-triage-decision.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
