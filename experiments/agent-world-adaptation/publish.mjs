import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { experimentSchema } from '../../apps/server/dist/experiments.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const work = resolve(root, '.data/experiments/agent-world-adaptation');
// Match the server's default DATA_DIR, while allowing an explicit target for
// isolated or already-running service instances. This prevents a successful
// publication from being invisible to the server that users actually open.
const dataDirectory = process.env.PUBLISH_DATA_DIR ?? process.env.DATA_DIR ?? '.data';
const archiveRoot = resolve(root, dataDirectory, 'technical-experiments');
const execution = JSON.parse(readFileSync(resolve(work, 'latest.json'), 'utf8')).directory;
const result = JSON.parse(readFileSync(resolve(execution, 'result.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [name, hash] of Object.entries(result.scripts)) assert.equal(sha(readFileSync(resolve(root, 'experiments/agent-world-adaptation', name))), hash);
assert.equal(result.resumedTrajectoryEqual, true); assert.equal(result.singleActionSavesBothRelationshipSides, true);
assert.equal(result.decisions, 90); assert.equal(result.subprocesses, 27);
const id = 'agent-world-adaptation-2026-10-23';
const directory = resolve(archiveRoot, id);
mkdirSync(directory, { recursive: true });
const entries = [
  ['result.json', '执行结果及边界'], ['continuous-30.json', '连续 30 步真实状态'],
  ['split-13.json', '重启前 13 步状态'], ['reload-13.json', '新进程读取状态'],
  ['resumed-30.json', '续跑 17 步结果'], ['interventions.json', '三类输入对照及输入屏蔽'],
  ['failures.json', '事务回滚与损坏拒绝'], ['talk.json', '单动作双方关系'],
  ['reload-after-talk.json', '单动作后新进程恢复'], ['queued-event.json', '已保存的未消费事件'],
  ['reloaded-event.json', '新进程恢复未消费事件'],
];
for (const [name] of entries) copyFileSync(resolve(execution, name), resolve(directory, name));
copyFileSync(resolve(work, 'sources.json'), resolve(directory, 'sources.json'));
copyFileSync(resolve(root, '.data/experiments/agent-world-behavior/runtime/runtime.json'), resolve(directory, 'runtime.json'));
copyFileSync(resolve(root, 'docs/research/2026-10-23-agent-world-adaptation.md'), resolve(directory, 'findings.md'));
const patch = readFileSync(resolve(work, 'upstream.patch'), 'utf8');
assert.equal(sha(Buffer.from(patch)), result.patchSha256);
writeFileSync(resolve(directory, 'adaptation.json'), JSON.stringify({
  format: 'agent-world-local-adaptation-v1', upstream: { repository: result.repository, commit: result.commit },
  upstreamPatch: patch, adapter: readFileSync(resolve(root, 'experiments/agent-world-adaptation/adapter.py'), 'utf8'),
  scripts: result.scripts, scope: result.scope, limitations: result.limitations,
}, null, 2));
writeFileSync(resolve(directory, 'reproduction.json'), JSON.stringify({files: ['README.md', 'prepare.py', 'adapter.py', 'run.py'].map(name => ({name, content: readFileSync(resolve(root, 'experiments/agent-world-adaptation', name), 'utf8')}))}, null, 2));
const artifacts = [...entries, ['sources.json', '原版与改造副本文件哈希'], ['runtime.json', '固定运行时与依赖'], ['adaptation.json', '本地改造补丁和完整适配器'], ['reproduction.json', '复现脚本与命令'], ['findings.md', '中文结论与反证']].map(([name,label]) => ({name,label,sha256:sha(readFileSync(resolve(directory,name)))}));
const modification = artifacts.find(item => item.name === 'adaptation.json');
const record = experimentSchema.parse({
  id, title: '社会模拟选型：agent-world 本地改造版的最小行为闭环',
  question: '单项目的保存缺陷和行为读取缺口能否用有限改造补齐，并在新进程继续同一轨迹？',
  conclusion: '本地改造版完成三角色、30 tick、90 次规则决策；13+17 步重启轨迹与连续 30 步一致，单动作双方关系和未消费事件可恢复。事件、关系、记忆的行动差异在屏蔽对应输入后消失。支持继续单项目验证，尚不推荐直接采用原版或认定完整社会模拟游戏可用。',
  executedAt: new Date(result.executedAt).toISOString(),
  environment: 'Windows / Python 3.12.10 / Django 4.2.26 / SQLite；真实原版核心接口与本地补丁/适配器；默认连接寿命 0；虚拟 11 秒间隔；27 个独立子进程。上游提交仅为改造基线，非未修改原版。',
  inputOrigin: '助手根据用户社会模拟场景构造 Alice/Bob/Cara、共享供水、事件与确定性角色策略；合成材料，未调用 LLM、未使用玩家数据。',
  projectIds: ['1174766694'], sources: [{repository: result.repository, commit: result.commit, modification: {
    artifact: modification.name, sha256: modification.sha256,
    description: '修复事务内连接关闭及异常吞掉；新增世界检查点、恢复适配器、确定性角色策略和供水规则。新增能力属于本地改造。',
  }}],
  checks: [
    {label:'单项目最小执行',outcome:'supported',observation:'3 角色、30 tick、90 次新规则决策通过原版动作/关系/事件/ORM 执行，资源守恒，无负库存。'},
    {label:'新进程续跑',outcome:'supported',observation:'13 步状态重载一致，续跑 17 步与连续 30 步一致，仅忽略事件时间戳。角色、记忆、关系、资源、时钟、随机状态和决策均参与比较。'},
    {label:'单动作双方保存',outcome:'supported',observation:'whisper 后立即在新进程恢复双方关系 +1/+1，不等待定期刷新；这是新增动作事务。'},
    {label:'未消费输入恢复',outcome:'supported',observation:'世界事件入队后保存，新进程恢复同一未消费事件。'},
    {label:'事件读取与屏蔽对照',outcome:'supported',observation:'Bob：normal-use/ration；屏蔽事件后均为 normal-use。'},
    {label:'关系读取与屏蔽对照',outcome:'supported',observation:'Alice：withhold/coordinate；屏蔽关系后均为 coordinate。'},
    {label:'记忆读取与屏蔽对照',outcome:'supported',observation:'Cara：inspect/repair；屏蔽记忆后均为 inspect。'},
    {label:'真实 SQL 与检查点失败',outcome:'supported',observation:'两种注入失败均传播错误，角色/检查点回滚，独立进程重载保持旧状态；不证明任意故障点恢复。'},
    {label:'损坏与混合状态',outcome:'supported',observation:'哈希不符的检查点和被单独修改的角色行都拒绝载入。'},
    {label:'原版能力或完整游戏通过',outcome:'inconclusive',observation:'新规则与持久化是本地改造，不是原版已具备这些能力；完整服务、LLM、玩家流程和独立收益均未验证。'},
  ],
  limitations: [
    '本地规则策略、资源规则与检查点是新增代码，不能归因于上游原版或认知智能，也不证明社会涌现。',
    '仅串行完整步骤边界恢复；未测并发服务、OS kill 中途退出、掉电或已有游戏数据库升级。原版周期保存仍可能在步骤中写角色。',
    '虚拟 11 秒时钟；不代表墙钟性能、长期运行或真实外部代理稳定性。',
    '没有 Web/MCP、外部 LLM、Godot 图形、完整游戏或独立用户省时验收。',
    '此前观察到 Windows 异常进程退出，根因未确认，失败记录保留；成功记录只覆盖本次完整实验。',
    '没有 Microverse 实际修复成本对照，不据此宣称本路线必然更便宜。',
  ],
  nextAction: '无 Godot 硬约束时继续单项目路线，下一步验证完整服务下的持续代理循环、观察/干预和实际失败恢复。若服务集成需要重做大部分核心则重选；现阶段不引入第二套世界状态系统。',
  artifacts,
});
writeFileSync(resolve(directory, 'record.json.tmp'), JSON.stringify(record,null,2));
renameSync(resolve(directory, 'record.json.tmp'), resolve(directory, 'record.json'));
console.log(JSON.stringify({id, archiveRoot, artifacts:artifacts.length, modification:record.sources[0].modification}));
