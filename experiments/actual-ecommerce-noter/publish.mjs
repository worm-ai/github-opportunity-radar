import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { experimentSchema } from '../../apps/server/dist/experiments.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
const run=resolve(root,'.data/experiments/actual-ecommerce-noter');
const result=JSON.parse(readFileSync(resolve(run,'result.json'),'utf8'));
assert.equal(result.cases.length,9);assert.equal(result.syntheticOnly,true);assert.equal(result.upstreamCodeModified,false);assert.equal(result.apiWrites,0);
assert.ok(result.cases.every((item)=>item.exitCode===0&&item.requests.every((request)=>request.method==='GET')));
const id=`actual-noter-baseline-${result.executedAt.replace(/[^0-9]/g,'')}`;
const findings=[
  '# Actual 订单工具：既有能力与尚未覆盖的边界','',
  '真实固定 CLI + 合成 CSV + 本地只读 HTTP 替身；没有运行真实 Actual 服务或进行市场验证。','',
  '| 场景 | 实际匹配数 | 观测 |','| --- | --- | --- |',
  '| 单笔订单 | 1 | 精确金额匹配成功 |',
  '| 单订单两件商品 | 1 | 输出两个子交易的拆分预览 |',
  '| 两订单一笔合并扣款 | 1 | 返回两个订单 ID 与拆分预览 |',
  '| 一订单两次发货扣款 | 0 | 50 英镑订单与 20/30 英镑两笔流水均未匹配，无礼品卡标记 |',
  '| 同日同额候选正序/反序 | 各 1 | 同一流水分别输出 SYN-A / SYN-B；输入不能区分真实归属 |',
  '| 唯一金额退款 | 1 | 回溯唯一同额商品 |',
  '| 等价商品退款 | 1 | 输出 Candidates:，保留商品歧义 |',
  '| 非 Amazon 商户 | 0 | 未误纳入当前 Amazon 流程 |','',
  '输出称为 potential matches，不是确定归属。没有验证 --execute、真实服务 API、官方导出的格式覆盖、多币种、默认金额容差或任务发生率。','',
  '决定：停止另做通用商品分类器。分批扣款未匹配与等额候选呈现可先在已有工具中改进；缺少独立工作流证据时不扩为新金融产品。','',
  `固定提交：${result.commit}；执行：${result.executedAt}。`,'',
].join('\n');
writeFileSync(resolve(run,'findings.md'),findings);
copyFileSync(resolve(run,'python/runtime.json'),resolve(run,'runtime.json'));
const files=[['result.json','九次真实 CLI 的原始输出、请求记录与观测'],['inputs.json','人工合成订单、退款与账本输入'],['source.json','固定来源文件的 Blob、SHA-256 与 URL'],['runtime.json','Python 与精确 wheel 版本、来源及哈希'],['findings.md','已有能力、反例和后续判断']];
const artifacts=files.map(([name,label])=>({name,label,sha256:createHash('sha256').update(readFileSync(resolve(run,name))).digest('hex')}));
const record=experimentSchema.parse({
  id,title:'Actual 订单工具基线：已有拆分可用，分批扣款与等额候选仍需核查',
  question:'后继订单工具是否已经满足商品分类任务，还有哪些边界需要先验证而不是另做产品？',
  conclusion:'固定上游 CLI 的九组合成 dry-run 验证了单笔匹配、商品拆分预览、多订单合并及唯一金额退款。一单分两次发货扣款时两笔都未匹配；同日同额订单调换 CSV 行序会改变单个输出候选。退款商品歧义已有 Candidates 提示。停止重复建设通用分类器，先判断局部改进是否足够。',
  executedAt:result.executedAt,environment:`${result.environment.platform}/${result.environment.arch}；Python ${result.environment.python}；requests ${result.environment.requests}；真实未修改的固定 CLI；临时本地 HTTP 替身。未执行真实 Actual 或 actual-http-api。`,
  inputOrigin:'全部订单、商品、退款和银行流水由实验人工合成，GBP、金额容差0、日期容差3天；无真实账户或客户资料。CSV 字段按当前解析器构造，未验证官方导出格式覆盖。',
  projectIds:['1219176154'],sources:[{repository:result.repo,commit:result.commit}],
  checks:[
    {label:'已有商品拆分与合并能力',observation:'精确多商品订单输出2子交易预览；两订单合并扣款匹配到两个ID。只验证dry-run，没有执行真实记账。',outcome:'supported'},
    {label:'一单多次发货扣款',observation:'订单包含20和30英镑商品，总额50；两笔银行扣款分别20和30，无礼品卡标记。匹配数为0/2。',outcome:'refuted'},
    {label:'同日同额时唯一归属',observation:'两订单同日同额，只有一笔流水。正序输出SYN-A，反序输出SYN-B；只输出一个潜在候选，不能从输入证明哪个归属正确。',outcome:'inconclusive'},
    {label:'退款的已有处理',observation:'金额唯一时回溯到对应商品；两件商品等价时保留Candidates文本，没有声称唯一识别。',outcome:'supported'},
    {label:'可作为新独立产品',observation:'本次只有合成边界与公开任务陈述，未观察实际频率、现有扩展的修改成本、用户选择或付费需求。',outcome:'inconclusive'},
  ],
  limitations:['仅固定提交与九组合成输入，不代表现实错误率或需求规模。','仅真实CLI到本地替身接口；未执行Actual、actual-http-api、写入模式、Web UI或AI分类器。','金额容差固定为0，未覆盖默认1英镑容差、多币种或所有官方CSV。','单个潜在候选随行序变化不能证明其必然错误；上游本就要求dry-run复核。','没有模型调用、外部联系、真实金融输入或市场验证。'],
  nextAction:'停止另做通用商品分类器。保留分批扣款和候选歧义的局部核查条件；只有真实重复任务显示局部修复不足时再研究跨组件工作流。转向其他已有任务，避免围绕此案例继续加功能。',artifacts,
});
const target=resolve(root,process.env.DATA_DIR||'.data','technical-experiments',id);mkdirSync(target,{recursive:true});
const serialized=JSON.stringify(record,null,2),recordPath=resolve(target,'record.json');
if(existsSync(recordPath))assert.equal(readFileSync(recordPath,'utf8'),serialized,'Archive is immutable');
for(const[name]of files)copyFileSync(resolve(run,name),resolve(target,name));
writeFileSync(resolve(target,'record.json.tmp'),serialized);renameSync(resolve(target,'record.json.tmp'),recordPath);
writeFileSync(resolve(run,'published.json'),JSON.stringify({id,directory:target,executedAt:result.executedAt},null,2));
console.log(JSON.stringify({id,artifacts:artifacts.length,modelCalls:0}));
