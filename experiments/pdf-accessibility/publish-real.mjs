import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { experimentSchema } from '../../apps/server/dist/experiments.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
const corpus=resolve(root,'.data/experiments/pdf-real-corpus');
const {directory:work}=JSON.parse(readFileSync(resolve(corpus,'latest-run.json'),'utf8'));
const result=JSON.parse(readFileSync(resolve(work,'result.json'),'utf8'));
const preservation=JSON.parse(readFileSync(resolve(work,'preservation.json'),'utf8'));
const structure=JSON.parse(readFileSync(resolve(work,'structure-diagnostic.json'),'utf8'));
const packet=JSON.parse(readFileSync(resolve(work,'review-packet.json'),'utf8'));
assert.equal(result.acquiredSources,1);assert.equal(result.plannedSources,12);assert.equal(result.paidApiCalls,0);
const row=result.rows[0],rendering=preservation.rows[0].rendering,links=preservation.rows[0].links;
assert.equal(row.inputInfo.pages,66);assert.equal(row.inputUnchanged,true);
assert.equal(row.beforeValidation.completed,true);assert.equal(row.afterValidation.completed,true);
assert.deepEqual([row.beforeValidation.failedRules,row.beforeValidation.failedChecks,row.afterValidation.failedRules,row.afterValidation.failedChecks],[8,10647,3,20]);
assert.equal(row.contentComparison.allExtractedTextEqual,true);
assert.equal(rendering.completed,true);assert.equal(rendering.pages.length,66);assert.equal(rendering.totalDifferentPixels,0);
assert.equal(links.sameLinkTargetsAndRectangles,true);assert.equal(links.beforeLinks,122);assert.equal(links.afterLinks,122);
assert.equal(structure.page13TagCounts['/Table']??0,0);assert.equal(structure.page13TagCounts['/LI'],20);
assert.equal(structure.genericImageAlt,41);assert.equal(packet.reviewedByExpert,0);
const findings=[
 '# 真实公开PDF：预处理有效，语义复核仍是交付瓶颈','',
 '单份66页公开游戏手册，复用已克隆iii仓库中的固定Git blob；不是机构客户文件、专家评测或用户试用。原计划另外11份材料未取得，本次离线准备清单明确标注。','',
 '| 检查 | 真实结果 |','| --- | --- |',
 '| 输入、页面与文本 | 输入SHA-256未改变；输出66页，逐页提取文本完全相同 |',
 '| 页面渲染 | 同一PDFBox渲染器、72DPI、66页全部像素相同；未跨渲染器或专家视觉评估 |',
 '| 链接 | 122个链接的目标及坐标相同，18个注释页数量一致；未评价辅助技术导航体验 |',
 '| PDF/UA机械检查 | 原件8条失败规则/10647失败检查；打标后3条/20检查；两份报告均正常完成，仍不合规 |',
 '| 语义反证 | PDF页13（印刷页9）的8列表格被标为段落和20个列表项；全部41个Figure替代文本均为image N |',
 '| 机器用时 | 打标9.815秒；原件/输出检查3.092/4.881秒；不是人工时间节省 |','',
 '代理对第13页作了针对性的本地视觉与结构核对；不是专家检查、全书表格标注或屏幕阅读器实测。数字变少不等于无障碍质量按比例提高。不要通过补MarkInfo、Metadata和Tabs三个字段来宣称完整合规。','',
 `复核包包含${packet.tasks}个有重叠的待复核定位任务，专家已完成0项；它们不是确认缺陷数或人工工作量。PDF/图片因插图权限边界留在本地，不在下载归档中。`,'',
 '决定：保留开源工具作为预处理的技术可行性；暂停完整自动交付产品化，等待无障碍专家与实际文档责任团队评估表格、图片、阅读顺序修复工作量及既有替代。未获得授权，不联系GitHub作者。','',
 `主流程执行于${result.executedAt}，保留性检查于${preservation.executedAt}。没有付费模型、OCR、Adobe、ASU/AWS、企业版、专家或用户试用。`,'',
].join('\n');
writeFileSync(resolve(work,'findings.md'),findings);
const files=[
 ['result.json','真实66页原始结果、逐页文本诊断及机械检查'],
 ['preservation.json','66页像素及122链接保留性检查'],
 ['structure-diagnostic.json','实际PDF标签、表格及替代文本诊断'],
 ['review-tasks.csv','待人工复核的页码和元素任务'],
 ['review-packet.json','代理页13核对范围及未完成专家状态'],
 ['review-handoff.md','可交接任务说明与继续/停止条件'],
 ['sources.json','实际取得1份和其余11份未取得的来源清单'],
 ['runtime.json','固定工具依赖、来源与SHA-256'],
 ['execution-logs.json','前后检查、打标和像素比较的原始输出'],
 ['findings.md','技术结论、语义反证和产品化边界'],
];
const artifacts=files.map(([name,label])=>{const bytes=readFileSync(resolve(work,name));assert.ok(bytes.length<=20*1024*1024);return{name,label,sha256:createHash('sha256').update(bytes).digest('hex')};});
const id=`pdf-public-review-${result.executedAt.replace(/[^0-9]/g,'')}`;
const record=experimentSchema.parse({
 id,title:'真实66页PDF：内容保留，表格与图片语义仍须人工复核',
 question:'开源自动打标和独立校验在真实长文档上能保留内容并直接形成可交付的无障碍文件吗？',
 conclusion:'单份66页公开手册的文本、同一渲染器72DPI像素及122个链接目标均保留，PDF/UA失败规则8→3，但输出仍不合规。第13页可见表格被标为段落和列表，41个Figure均是通用image N替代文本。预处理组合可运行，语义修复、专家用时、实际采用和付费仍未验证；暂停自动交付产品化。',
 executedAt:result.executedAt,environment:'Windows；Python3.12.10/pypdf6.21.1；JBR21.0.6；未修改OpenDataLoader2.5.13及veraPDF1.28.2。复用打标器附带PDFBox作72DPI像素比较，无新增在线依赖或云API。',
 inputOrigin:'已克隆iii固定提交05440e1fb1b5080285c156ab6fd1a4def4310ae2的sdk/test-assets/handbook.pdf：Chris Gonnerman的Basic Fantasy RPG 4th Edition，66页。Git blob及SHA-256已核对。其余11份计划样本未取得；原件、转换件和页图因插图权限边界仅作本地评估。',
 projectIds:['982587624','53291241'],sources:[{repository:'opendataloader-project/opendataloader-pdf',commit:'1f1b3e9c67e5052e35082d55e77ab90d2ed25d17'},{repository:'veraPDF/veraPDF-apps',commit:'77e46c943af719be041f0462307fd43ff7dd41a6'}],
 checks:[
  {label:'长文档技术连接与内容保留',observation:'66页全部生成标签，逐页提取文本完全相同；同一PDFBox渲染器72DPI像素一致，122链接目标和坐标一致；原件哈希保持。',outcome:'supported'},
  {label:'独立机械检查是否实际执行',observation:'前后PDF/UA-1校验均正常完成；失败规则8→3，失败检查10647→20，不解释为质量百分比。',outcome:'supported'},
  {label:'直接自动交付',observation:'输出仍有3条失败规则；第13页8列表格生成P+L/LI结构，41个Figure的Alt均为image N。机械字段修补不能证明语义正确。',outcome:'refuted'},
  {label:'任务包能否被专家接手',observation:`提供${packet.tasks}项有重叠的页码/元素定位和空的复核记录栏，尚无专家执行，不是${packet.tasks}个确认缺陷或工作量。`,outcome:'inconclusive'},
  {label:'机构代表性、人工收益与商业价值',observation:'只取得一份公开游戏手册，其余11份计划材料未下载；未测人工时间、使用者采用、付款或现成完整方案的对照收益。',outcome:'inconclusive'},
 ],limitations:[...result.limitations,...preservation.limits.slice(0,2)].slice(0,12),
 nextAction:'等待无障碍专家和实际文档责任团队对任务包作语义与辅助技术评估，比较其现有整体方案的人工用时；确认独立交付负担及采用意愿后再继续产品化。证据不足时暂停平台扩建，不以补机械字段冒充自动合规。',artifacts,
});
const target=resolve(root,process.env.DATA_DIR||'.data','technical-experiments',id),serialized=JSON.stringify(record,null,2);
if(existsSync(resolve(target,'record.json')))assert.equal(readFileSync(resolve(target,'record.json'),'utf8'),serialized,'Archive is immutable');
mkdirSync(target,{recursive:true});
for(const[name]of files){const output=resolve(target,name),bytes=readFileSync(resolve(work,name));if(existsSync(output))assert.deepEqual(readFileSync(output),bytes,'Existing artifact is immutable');else copyFileSync(resolve(work,name),output);}
if(!existsSync(resolve(target,'record.json'))){writeFileSync(resolve(target,'record.json.tmp'),serialized);renameSync(resolve(target,'record.json.tmp'),resolve(target,'record.json'));}
writeFileSync(resolve(corpus,'published.json'),JSON.stringify({id,directory:target},null,2));
console.log(JSON.stringify({id,artifacts:artifacts.length,expertReviewed:0,newModelCalls:0}));
