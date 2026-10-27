import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { experimentSchema } from '../../apps/server/dist/experiments.js';

const root=fileURLToPath(new URL('../../',import.meta.url)),work=resolve(root,'.data/experiments/pdf-accessibility');
if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
const result=JSON.parse(readFileSync(resolve(work,'result.json'),'utf8'));
assert.equal(result.syntheticOnly,true);assert.equal(result.rows.length,4);assert.equal(result.paidApiCalls,0);
for(const row of result.rows.slice(0,2))assert.deepEqual(row.validationSummary,{profile:'PDF/UA-1 validation profile',completed:true,compliant:false,failedRules:5,failedChecks:6});
assert.equal(result.altTextComparison.routedInputBytesPreserved,true);
const findings=[
 '# 本地 PDF 批量预处理与人工复核：组合实测','',
 '真实运行固定的 OpenDataLoader 2.5.13 和 veraPDF 1.28.2；四份人工合成单页 PDF，无用户试用、真实机构材料或商业验证。','',
 '| 场景 | 直接调用上游 | 分流后的实际结果 |','| --- | --- | --- |',
 '| 不同部门的同名 handout.pdf | 显示处理4份输入，但平铺输出只剩部门B同名产物 | 按相对目录分别调用后，部门A/B的标记均保留且没有混入另一份内容 |',
 '| 已有人工作品的部分标签 | 重新打标把 HUMAN_CURATED_ALT_SENTINEL 改为 image 1 | 不自动重写，逐字节保留原PDF，进入人工审查 |',
 '| 两份未打标文本 PDF | 能生成结构树和 Tagged PDF | veraPDF确实完成PDF/UA-1检查，各失败5条规则/6个检查；不能自动交付为合规文件 |',
 '| 仅含图像的诊断 PDF | 原始CLI仍会生成标签产物 | 文本为空则分流OCR/人工处理，本次没有运行OCR |','',
 '字体未嵌入、语言及元数据等是合成输入本来缺少的条件，不能将这些失败率外推为工具质量或真实语料错误率。已有标签也可能错误；原样保留不等于它已无障碍。','',
 '组合分工：OpenDataLoader负责局部自动打标；veraPDF负责可自动执行的标准检查；薄编排层保留目录、输入哈希和人工复核任务。标准检查不能确认自然阅读顺序、替代文本是否有意义或屏幕阅读器体验。','',
 '商业假设：面向需要批量整理既有教学/公共文档的团队，交付本地预处理、人工复核队列和可追溯报告，可能比重建完整编辑器更有价值。现成ASU方案已含前后检查，OpenDataLoader也已有企业导出/工作室，不能声称市场空白或免费实现自动合规。','',
 '下一步：先用公开真实文档与专家审查比较人工时间和漏项，不再围绕单个覆盖问题扩建平台。没有实际工作量、复核结果和采用意愿之前，不宣称节省成本或付费成立。','',
 `最终执行：${result.executedAt}。首次启动器配置失败保留在 first-attempt-setup-errors.json；最终两次验证均取得正常完成的机器报告。`,'',
 '源码版本：[OpenDataLoader v2.5.13](https://github.com/opendataloader-project/opendataloader-pdf/tree/1f1b3e9c67e5052e35082d55e77ab90d2ed25d17)、[veraPDF v1.28.2](https://github.com/veraPDF/veraPDF-apps/tree/77e46c943af719be041f0462307fd43ff7dd41a6)。','',
].join('\n');
writeFileSync(resolve(work,'findings.md'),findings);
const labels=['upstream-folder-baseline','convert-department-a','convert-department-b','validate-department-a','validate-department-b'];
const logs=labels.map(label=>JSON.parse(readFileSync(resolve(work,'logs',`${label}.json`),'utf8')));
writeFileSync(resolve(work,'execution-logs.json'),JSON.stringify({finalRun:logs,setupFailure:JSON.parse(readFileSync(resolve(work,'first-attempt-setup-errors.json'),'utf8'))},null,2));
const files=[['result.json','四份合成输入、哈希、路由与真实验证报告'],['review-queue.csv','逐份人工复核队列'],['runtime.json','固定依赖、来源与SHA-256'],['execution-logs.json','真实命令、标准输出和首次配置失败'],['findings.md','组合分工、原始基线、结果与商业假设边界']];
const artifacts=files.map(([name,label])=>({name,label,sha256:createHash('sha256').update(readFileSync(resolve(work,name))).digest('hex')}));
const id=`pdf-local-triage-${result.executedAt.replace(/[^0-9]/g,'')}`;
const record=experimentSchema.parse({
 id,title:'本地PDF预处理与复核队列：打标可连接，自动合规仍不成立',
 question:'开源自动打标与独立PDF/UA校验能否组成不覆盖已有人工内容、保留部门目录的批量预处理流程？',
 conclusion:'两份未打标文本PDF均生成结构树，veraPDF正常完成检查并各报告5条失败规则。直接平铺输出覆盖同名文件，重新打标也改变已有替代文本；薄分流层保留相对目录、已有标签文件原字节，并将图像输入和检查失败交给人工。只验证了合成小样本上的组合接口，未证明真实文档节省时间或商业成立。',
 executedAt:result.executedAt,environment:'Windows；Python3.12.10/pypdf6.21.1；JBR21.0.6；官方未修改OpenDataLoader2.5.13及veraPDF1.28.2 JAR，依赖SHA-256已核对。无云端API。',
 inputOrigin:'四份人工合成单页PDF：两个不同部门同名文本、带人工Alt标记的部分标签文件、纯图像诊断。Helvetica未嵌入，不是完整PDF/UA合规样本或真实机构文档。',
 projectIds:['982587624','53291241'],sources:[{repository:'opendataloader-project/opendataloader-pdf',commit:'1f1b3e9c67e5052e35082d55e77ab90d2ed25d17'},{repository:'veraPDF/veraPDF-apps',commit:'77e46c943af719be041f0462307fd43ff7dd41a6'}],
 checks:[
  {label:'自动打标与独立校验的接口',observation:'两个文本输入均输出Tagged PDF；独立veraPDF取得正常完成的PDF/UA-1 JSON报告。',outcome:'supported'},
  {label:'直接批量输出保留同名文档',observation:'原CLI显示处理4份输入，两个部门handout.pdf平铺到同一路径，最终只剩部门B标记；按目录分别输出后两份各自保留。',outcome:'refuted'},
  {label:'重新打标保留已有人工Alt',observation:'固定合成输入原Alt为人工标记，直接打标后为image 1；分流原样保留该输入且哈希相同，仍须人工检查原有标签。',outcome:'refuted'},
  {label:'Tagged PDF可直接宣称合规',observation:'两份输出各失败5条规则/6个检查，包括合成输入缺少的字体、语言和元数据条件；这不代表真实语料总体错误率。',outcome:'refuted'},
  {label:'图像输入处理范围',observation:'文本为空时进入OCR/人工队列，没有执行OCR；不能评价文字识别质量。',outcome:'inconclusive'},
  {label:'值得独立产品化',observation:'已有ASU完整方案和上游企业导出/工作室；只有公开任务线索与合成接口实验，真实人工用时、采用与付费仍缺证据。',outcome:'inconclusive'},
 ],limitations:result.limits,
 nextAction:'保留批量预处理与可审计人工交付这一候选服务方向，先用真实公开文档和人工无障碍复核比较现有整体方案；不再扩建通用编辑器，不承诺自动合规。未获授权不联系讨论作者。',artifacts,
});
const target=resolve(root,process.env.DATA_DIR||'.data','technical-experiments',id);mkdirSync(target,{recursive:true});
const serialized=JSON.stringify(record,null,2),recordPath=resolve(target,'record.json');
if(existsSync(recordPath))assert.equal(readFileSync(recordPath,'utf8'),serialized,'Archive is immutable');
for(const[name]of files)copyFileSync(resolve(work,name),resolve(target,name));
writeFileSync(resolve(target,'record.json.tmp'),serialized);renameSync(resolve(target,'record.json.tmp'),recordPath);
writeFileSync(resolve(work,'published.json'),JSON.stringify({id,directory:target},null,2));
console.log(JSON.stringify({id,artifacts:artifacts.length,modelCalls:0}));
