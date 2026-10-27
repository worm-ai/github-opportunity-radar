import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {experimentSchema} from '../../apps/server/dist/experiments.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
if(existsSync(resolve(root,'.env'))) process.loadEnvFile(resolve(root,'.env'));
const work=resolve(root,'.data/research/policy-session');
const execution=resolve(work,'execution');
const core=JSON.parse(readFileSync(resolve(execution,'result.json'),'utf8'));
assert.deepEqual(core.checks.map(c=>c.outcome),['supported','refuted','refuted','refuted','refuted']);
assert.equal(core.scriptSha256,createHash('sha256').update(readFileSync(resolve(root,'experiments/policy-session/run.py'))).digest('hex'));
const id='policy-session-2026-10-21';
const directory=resolve(root,process.env.DATA_DIR||'.data','technical-experiments',id);
mkdirSync(directory,{recursive:true});
const copies=[
 ['result.json','提取器实际执行结果'],['input-fixtures.json','五组合成输入（非用户历史）'],
 ['normalized.json','原版提取器输出'],['vendor-sources.json','固定提取器原文与 MIT 许可证'],
];
for(const [name] of copies) copyFileSync(resolve(execution,name),resolve(directory,name));
copyFileSync(resolve(root,'docs/research/2026-10-21-policy-session-review.md'),resolve(directory,'findings.md'));
const provenance=[...JSON.parse(readFileSync(resolve(work,'files.json'),'utf8')),...JSON.parse(readFileSync(resolve(work,'native-files.json'),'utf8'))].map(f=>({
 repository:f.repository,commit:f.commit,path:f.path,blob:f.blob,
 url:`https://github.com/${f.repository}/blob/${f.commit}/${f.path}`,
}));
const documentation=JSON.parse(readFileSync(resolve(work,'version-documentation.json'),'utf8'));
writeFileSync(resolve(directory,'source-index.json'),JSON.stringify({files:provenance,documentation:documentation.documents.map(d=>({path:d.path,ref:d.ref,commit:d.commitSha,blob:d.sha,url:d.url})),note:'OpenAPPA source and documentation were read, not executed; collector uses bounded 8000-character excerpts.'},null,2));
writeFileSync(resolve(directory,'reproduction.json'),JSON.stringify({files:['run.py','prepare.mjs','README.md'].map(name=>({name,content:readFileSync(resolve(root,'experiments/policy-session',name),'utf8')})),command:'.data/experiments/actual-ecommerce-noter/python/python.exe -I -B experiments/policy-session/run.py'},null,2));
const names=[...copies,['findings.md','中文研究结论与边界'],['source-index.json','固定提交与文档版本索引'],['reproduction.json','复现脚本及执行命令']];
const artifacts=names.map(([name,label])=>({name,label,sha256:createHash('sha256').update(readFileSync(resolve(directory,name))).digest('hex')}));
const record=experimentSchema.parse({
 id,title:'Agent 历史会话 → 权限回归：五组数据保真对照',
 question:'固定 ai-data-extractor 的统一聊天输出是否完整保留权限回归需要的工具调用、结果、会话切换及父子关系？',
 conclusion:'暂停通用导出后直接做可信权限回归的组合。合成 Claude 线性调用的 ID、参数、结果与失败重试保留；另外四种受控输入分别丢失切换、子任务、Codex 工具记录或父子关联。不是实际用户会话测试，也未执行 OpenAPPA 或验证市场需求。',
 executedAt:core.executedAt,environment:`Windows；Python 3.12.10；原版 ai-data-extractor extract()，执行前校验 Git Blob；复用此前项目内运行时。OpenAPPA 仅核对文档及源码，未安装执行。`,
 inputOrigin:'五组人工合成日志；无真实用户会话、生产工具或付费模型调用。输入编码未独立验证覆盖实际客户端版本；sessionId 切换不复现 #592。',
 projectIds:['1414660459','1338299113'],sources:[
 {repository:'jatechan/ai-data-extractor',commit:core.extractorCommit},
 {repository:'archestra-ai/OpenAPPA',commit:'b9e2cee8bc8ddd79f8c75c4e850ee0b0d153f8af'},
 ],
 checks:[
 {label:'线性 Claude 工具链正对照',outcome:'supported',observation:'三次调用的 ID 与参数、三个对应结果及失败标记、重试顺序准确保留。只支持这组受控格式。'},
 {label:'文件内会话切换',outcome:'refuted',observation:'输入 before / after 两个 sessionId 被合并为一个 after 会话，消息上没有原会话 ID，无法恢复切换点。'},
 {label:'嵌套子代理遍历',outcome:'refuted',observation:'两个输入文件只提取主会话，spawn-1 保留，嵌套 subagents 内 child-read 未读取。'},
 {label:'Codex 工具调用与结果',outcome:'refuted',observation:'文本正对照保留，但 response_item function_call / function_call_output 中 exec-1、参数及失败输出未保留。'},
 {label:'Codex 父子会话关联',outcome:'refuted',observation:'两个 conversation 都有文本，session_meta.source.subagent.spawn.parent_thread_id 未保留。'},
 {label:'是否缺少原生策略重放',outcome:'refuted',observation:'固定 validation 文档已有 appa replay、CI、无断言观察和 JSON 输出。源码为空成功结果，不等于真实工具结果或生命周期集成测试。仅核对原文，未运行。'},
 {label:'旧报告是否证明当前仍无修复',outcome:'refuted',observation:'v0.32.0 固定 changelog 已记载 keep a protected launch\'s family across session id changes / #602。未安装验证覆盖范围，不能用 #592 旧报告推导当前未修复缺口。'},
 {label:'真实工作收益和市场需求',outcome:'inconclusive',observation:'没有实际团队回归任务、耗时对照或付费验证；技术丢字段也可能只需修一个项目，不能自动转化为双组件商业机会。'},
 ],
 limitations:['五组合成输入不是实际客户端版本覆盖或统计失败率，不复现 #592。','OpenAPPA 仅阅读，未执行策略重放、外部 annotator、批准及子任务生命周期。','历史成功不代表应该允许；敏感标签、批准、策略版本及工具映射不得从缺失日志编造。','原生 ConsultRecorder 仅核实到外部 consult 记录，未证明全量 Agent 工具导出。','尚无实际使用者、节省时间、采用或付费证据。'],
 nextAction:'先取得维护权限策略团队的明确回归任务与脱敏轨迹，比较原生 replay、原生事件记录和直接读取固定版本日志；由责任人确认允许/拒绝断言。只在现有方案仍有可测重复劳动时重新打开，当前不继续扩建适配器。',artifacts,
});
writeFileSync(resolve(directory,'record.json.tmp'),JSON.stringify(record,null,2));
renameSync(resolve(directory,'record.json.tmp'),resolve(directory,'record.json'));
console.log(JSON.stringify({id,artifacts:artifacts.length,checks:record.checks.length,directory}));
