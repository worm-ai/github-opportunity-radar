import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { experimentSchema } from '../../apps/server/dist/experiments.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const work = resolve(root, '.data/experiments/agent-world-behavior');
const execution = JSON.parse(readFileSync(resolve(work, 'latest.json'), 'utf8')).directory;
const result = JSON.parse(readFileSync(resolve(execution, 'result.json'), 'utf8'));
assert.equal(result.scriptSha256, createHash('sha256').update(readFileSync(resolve(root, 'experiments/agent-world-behavior/run.py'))).digest('hex'));
assert.equal(result.verifiedFiles, 36);
assert.equal(result.npcTrials, 120);
const id = 'agent-world-behavior-2026-10-23';
const directory = resolve(root, '.data/demand-live-20261023/technical-experiments', id);
mkdirSync(directory, { recursive: true });
const entries = [
  ['result.json', '执行结果与验证边界'], ['action.json', '首次动作内存状态'],
  ['load-after-action.json', '首次动作后新进程载入'], ['flush.json', '批量保存前状态'],
  ['load-after-flush.json', '批量保存后新进程载入'],
  ['individual-save.json', '逐个保存正对照'], ['load-after-individual-save.json', '正对照恢复结果'],
  ['ticks.json', '世界事件与时钟输出'], ['load-after-ticks.json', '世界时钟重载结果'],
  ['npc.json', '120 个 NPC 条件与实际动作'],
];
for (const [name] of entries) copyFileSync(resolve(execution, name), resolve(directory, name));
copyFileSync(resolve(work, 'sources.json'), resolve(directory, 'sources.json'));
copyFileSync(resolve(work, 'runtime/runtime.json'), resolve(directory, 'runtime.json'));
copyFileSync(resolve(root, 'docs/research/2026-10-23-agent-world-behavior.md'), resolve(directory, 'findings.md'));
writeFileSync(resolve(directory, 'save-errors.json'), JSON.stringify({flush: readFileSync(resolve(execution, 'flush.stderr.txt'), 'utf8'), ticks: readFileSync(resolve(execution, 'ticks.stderr.txt'), 'utf8')}, null, 2));
writeFileSync(resolve(directory, 'reproduction.json'), JSON.stringify({files: ['prepare.mjs', 'prepare-wheels.mjs', 'install-runtime.py', 'run.py', 'README.md'].map(name => ({name, content: readFileSync(resolve(root, 'experiments/agent-world-behavior', name), 'utf8')}))}, null, 2));
const artifacts = [...entries, ['sources.json', '36 份固定源码与资产清单'], ['runtime.json', '固定依赖与 SHA-256'], ['findings.md', '中文研究结论'], ['save-errors.json', '真实保存错误日志'], ['reproduction.json', '复现脚本与命令']].map(([name, label]) => ({name, label, sha256: createHash('sha256').update(readFileSync(resolve(directory, name))).digest('hex')}));
const record = experimentSchema.parse({
  id, title: '社会模拟选型：agent-world 关系、事件与恢复行为对照',
  question: '关系和世界事件是否改变内置 NPC 行动，关系与记忆能否在新进程恢复？',
  conclusion: '保留为单项目改造候选，尚不推荐为完整社会模拟游戏。消息正对照能触发行动；已测关系/世界事件对照未改变动作。接收者关系存在保存窗口，批量保存报错，世界时钟重载复位。暂不组合两套状态系统。',
  executedAt: new Date(result.executedAt).toISOString(),
  environment: 'Windows；Python 3.12.10；Django 4.2.26；固定原版核心、真实地图/ORM/SQLite，36 份 Git blob 核验。仅配置必要应用和独立数据库，CONN_MAX_AGE=0 与上游 base 一致；未启动完整 Web/MCP 或外部 LLM。',
  inputOrigin: '助手根据用户社会模拟需求构造 Alice/Bob 和事件；20 固定随机种子 × 2 初始关系 × 3 事件=120 条件。合成材料，非真实玩家数据。',
  projectIds: ['1174766694'], sources: [{repository: result.repository, commit: result.commit}],
  checks: [
    {label:'发言是否更新关系', outcome:'supported', observation:'真实 handle_action 后双方内存 +2/+2；不是只检查字段存在。'},
    {label:'动作后双方关系都已持久化', outcome:'refuted', observation:'新进程载入变为 +2/0，发言者被保存，接收者未保存；此阶段未等待定期刷新。'},
    {label:'记忆与逐个保存正对照', outcome:'supported', observation:'remember 和逐个 save_agent 后，新进程恢复记忆、位置及双方各自的关系值。'},
    {label:'批量保存恢复', outcome:'refuted', observation:'默认连接配置下 save_all 记录 Cannot operate on a closed database，接收者新增关系未恢复。执行的是保存原语，未执行完整管理命令关停。'},
    {label:'世界时钟持续', outcome:'refuted', observation:'12 tick 从 06:00 到 09:00；新进程回到第 1 天 06:00。'},
    {label:'世界事件投递', outcome:'supported', observation:'双方实际收到 world_event，WorldLog 新增一条。'},
    {label:'关系驱动已测 NPC 行动', outcome:'refuted', observation:'-80/+80 的 60 对同输入/同随机条件，动作及位置无差异；源码脚本未读取关系。外部 LLM 决策未测试。'},
    {label:'世界事件驱动已测 NPC 行动', outcome:'refuted', observation:'无事件/世界事件的 40 对条件无差异；不能把事件分发等同于行动响应。'},
    {label:'消息响应正对照', outcome:'supported', observation:'无事件/消息的 40 对条件中 36 对行为不同，真实 NPC 消息响应执行。'},
    {label:'完整游戏与独立用户收益', outcome:'inconclusive', observation:'未运行完整服务、外部 LLM、Microverse 或玩家任务，没有同任务耗时对照。'},
  ],
  limitations: ['同步调用 NPC tick，未覆盖异步服务调度和 Web/MCP。','固定随机条件为受控反例，不代表全部角色/策略的统计覆盖。','批量保存测试与 runworld 共用原语，但完整 OS 信号关停未执行。','没有修改上游源码，逐个保存仅为诊断正对照。','人工行为实测独立归档，未改写原需求报告或模型推荐。'],
  nextAction: '先比较 agent-world 与 Microverse 单项目改造成本：统一状态、持续目标、读取记忆/关系/事件的决策、可靠恢复和玩家干预。明确最小原型验收后再选一条；没有具体不可补齐缺口前不引入另一套世界系统。',
  artifacts,
});
writeFileSync(resolve(directory, 'record.json.tmp'), JSON.stringify(record, null, 2));
renameSync(resolve(directory, 'record.json.tmp'), resolve(directory, 'record.json'));
console.log(JSON.stringify({id, directory, artifacts: artifacts.length}));
