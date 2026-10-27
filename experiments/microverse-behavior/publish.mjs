import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { experimentSchema } from '../../apps/server/dist/experiments.js';

const root = process.cwd(), work = resolve(root, '.data/experiments/microverse-behavior');
const execution = JSON.parse(readFileSync(resolve(work, 'latest.json'), 'utf8')).execution;
const result = JSON.parse(readFileSync(resolve(execution, 'result.json'), 'utf8'));
const verification = JSON.parse(readFileSync(resolve(execution, 'verification.json'), 'utf8'));
assert.equal(verification.execution, execution);
assert.equal(verification.originalFilesUnchanged, 4407);
assert.equal(result.driverSha256, createHash('sha256').update(readFileSync('experiments/microverse-behavior/probe.gd')).digest('hex'));
const id = 'microverse-behavior-2026-10-23';
const directory = resolve(root, '.data/demand-live-20261023/technical-experiments', id);
mkdirSync(directory, { recursive: true });
const entries = [
  ['result.json', '实际阶段与退出状态'], ['write.json', '原版任务、prompt 与存档输出'],
  ['load.json', '新进程恢复状态'], ['verification.json', '行为检查及恢复对照'],
];
for (const [name] of entries) copyFileSync(resolve(execution, name), resolve(directory, name));
copyFileSync(resolve(work, 'sources.json'), resolve(directory, 'sources.json'));
copyFileSync(resolve(work, 'preparation.json'), resolve(directory, 'runtime.json'));
copyFileSync(resolve(root, 'docs/research/2026-10-23-microverse-behavior.md'), resolve(directory, 'findings.md'));
const collectLogs = path => Object.fromEntries(readdirSync(path).filter(name => /\.(stdout|stderr)\.txt$/.test(name)).map(name => [name, readFileSync(resolve(path, name), 'utf8')]));
writeFileSync(resolve(directory, 'logs.json'), JSON.stringify(collectLogs(execution), null, 2));
const attempts = readdirSync(work, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith('execution-')).map(entry => {
  const path = resolve(work, entry.name), resultFile = resolve(path, 'result.json');
  return { execution: entry.name, selected: path === execution, result: existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : null, logs: collectLogs(path) };
});
writeFileSync(resolve(directory, 'attempts.json'), JSON.stringify(attempts, null, 2));
writeFileSync(resolve(directory, 'reproduction.json'), JSON.stringify({ files: ['prepare.mjs', 'unpack.py', 'run.mjs', 'probe.gd', 'verify-run.mjs', 'README.md'].map(name => ({ name, content: readFileSync(resolve(root, 'experiments/microverse-behavior', name), 'utf8') })) }, null, 2));
const artifacts = [...entries, ['sources.json', '4,407 份原版 Git blob 清单'], ['runtime.json', '官方引擎校验与版本'], ['findings.md', '中文结论及单项目改造比较'], ['logs.json', '原版运行与错误日志'], ['attempts.json', '含导入超时的完整尝试记录'], ['reproduction.json', '复现驱动与命令']].map(([name, label]) => ({ name, label, sha256: createHash('sha256').update(readFileSync(resolve(directory, name))).digest('hex') }));
const record = experimentSchema.parse({
  id, title: '社会模拟选型：Microverse 任务状态与存档恢复实测',
  question: '原版 Office 的任务、记忆及关系状态是否连通，保存成功后能否在新进程恢复？',
  conclusion: '不直接采用为完整社会模拟游戏。原方法完成任务后，两套任务状态不一致；存档返回成功却写入 {}，新进程加载失败，任务/记忆/关系未恢复。记忆与关系能进入 prompt，模型行动未验。无 Godot 必要约束时，先验证 agent-world 单项目改造；暂不拼接两套世界状态。',
  executedAt: result.executedAt,
  environment: 'Windows；官方 Godot 4.4.1 headless；完整固定仓库 4,407 份 Git blob 核验。独立 APPDATA；原版 Office 与 autoload；只新增诊断驱动，AI Timer 停止，未接外部 LLM。资源导入复用缓存，不是冷启动性能比较。',
  inputOrigin: '助手根据用户社会模拟需求构造 Alice 的供水任务、Bob 关系和缺水事件记忆；合成输入，非真实玩家数据。',
  projectIds: ['1072816188'], sources: [{ repository: result.repository, commit: result.commit }],
  checks: [
    { label: '原版场景及方法实际执行', outcome: 'supported', observation: `${verification.characters.length} 个原版角色；默认入口短启动与 Office 驱动均退出 0，但仍有五处内嵌纹理路径加载错误，不能等同于图形/完整游戏验收。` },
    { label: '默认任务统一进入任务状态', outcome: 'refuted', observation: '默认任务生成写 metadata.tasks；character_data.tasks 未同步。完成同描述/时间任务后，嵌套 completed=true、顶层 false，任务 prompt 仍显示该任务。' },
    { label: '记忆及关系作为 prompt 输入', outcome: 'supported', observation: '原 get_character_status_info 输出缺水事件记忆及 Bob 关系；只证明输入存在，没有请求模型或验证后续行为。' },
    { label: '已测任务调整分支更改任务', outcome: 'refuted', observation: '原占位重排/紧急任务函数调用后，已测嵌套任务不变。不能据此否定另有实现的默认后备分支。' },
    { label: '存档及新进程恢复', outcome: 'refuted', observation: `实际保存返回 ${verification.saveReturn}，文件为 {}，新进程加载返回 ${verification.loadReturn}；位置 (333,444) 未恢复，仍为 (976,360)，任务/记忆/关系为空。保存角色组 ${verification.saveGroup.length} 人。` },
    { label: '角色及房间状态收集', outcome: 'refuted', observation: '原 collect_game_data 在 Room 上调用不存在的 has_property 报错；直接 collect_character_data(Alice) 同样报错并返回空字典。驱动没有修改分组、方法或上游逻辑。' },
    { label: '外部模型与完整玩家体验', outcome: 'inconclusive', observation: '两个驱动阶段未创建 HTTPRequest 节点，AI Timer 停止；未测模型行动、共同资源规则、画面交互或长期运行。' },
  ],
  limitations: ['headless 验证不覆盖图形渲染、玩家输入和完整菜单路径；五处纹理加载错误保留。','没有调用外部 LLM，不能推断模型对事件或关系的响应质量。','合成任务通过原方法执行，不是自主选择行为的成功证明。','早期资源导入超时保留，不将未完成导入造成的错误当成业务反例。','未修改上游实现，工程成本比较是剩余工作清单，没有工时实测。'],
  nextAction: '以 agent-world 单项目为下一条有条件的原型路线：先修复双向关系/记忆/时钟恢复，再让共享资源事件和关系改变行动；用相同输入和随机条件做对照。若必须优先 Godot 画面，先统一 Microverse 状态及存档。只有具体不可补齐缺口出现时再考虑组合。',
  artifacts,
});
writeFileSync(resolve(directory, 'record.json.tmp'), JSON.stringify(record, null, 2));
renameSync(resolve(directory, 'record.json.tmp'), resolve(directory, 'record.json'));
console.log(JSON.stringify({ id, directory, artifacts: artifacts.length }));
