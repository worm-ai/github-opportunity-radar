import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { experimentSchema } from '../../apps/server/dist/experiments.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const work = resolve(root, '.data/experiments/agent-world-service');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const execution = read(resolve(work, 'latest.json')).directory;
assert.equal(resolve(execution, '..'), work);
const result = read(resolve(execution, 'result.json'));
assert.equal(result.subprocesses, 4); assert.equal(result.calls, 16);
for (const [name, hash] of Object.entries(result.scripts)) assert.equal(sha(readFileSync(resolve(root, 'experiments/agent-world-service', name))), hash);
for (const [name, hash] of Object.entries(result.artifacts)) assert.equal(sha(readFileSync(resolve(execution, name))), hash);
for (const [name, hash] of Object.entries(result.manifests)) assert.equal(sha(readFileSync(resolve(work, name))), hash);
const id = 'agent-world-service-2026-10-23';
const directory = resolve(root, '.data/demand-live-20261023/technical-experiments', id);
mkdirSync(directory, {recursive: true});
const entries = [
  ['result.json', '核对结果与适用边界'], ['original-bridged.json', '原版加异步桥接真实协议与观察状态'],
  ['original-bridged-reload.json', '原版加异步桥接新进程恢复'], ['adapted-bridged.json', '本地改造加异步桥接服务调用'],
  ['adapted-bridged-reload.json', '本地改造加异步桥接新进程恢复'],
];
for (const [name] of entries) copyFileSync(resolve(execution, name), resolve(directory, name));
copyFileSync(resolve(work, 'runtime/runtime.json'), resolve(directory, 'runtime.json'));
copyFileSync(resolve(root, 'docs/research/2026-10-23-agent-world-service.md'), resolve(directory, 'findings.md'));
writeFileSync(resolve(directory, 'sources.json'), JSON.stringify({
  service: read(resolve(work, 'sources.json')),
  core: read(resolve(root, '.data/experiments/agent-world-behavior/sources.json')),
  adapted: read(resolve(root, '.data/experiments/agent-world-adaptation/sources.json')),
}, null, 2));
const prior = read(resolve(root, '.data/demand-live-20261023/technical-experiments/agent-world-adaptation-2026-10-23/adaptation.json'));
assert.equal(prior.adapter, readFileSync(resolve(root, 'experiments/agent-world-adaptation/adapter.py'), 'utf8'));
assert.equal(prior.upstreamPatch, readFileSync(resolve(root, '.data/experiments/agent-world-adaptation/upstream.patch'), 'utf8'));
writeFileSync(resolve(directory, 'modification.json'), JSON.stringify({
  description: '本地单循环双 Uvicorn 探针启动器；比较原版与异步服务桥接改造。桥接为本地实验，不等同上游完整启动器。',
  priorAdaptation: prior,
  files: ['README.md', 'prepare.mjs', 'bootstrap.mjs', 'run.py', 'async_bridge.py', 'analyze.mjs', 'publish.mjs'].map(name => ({name, content: readFileSync(resolve(root, 'experiments/agent-world-service', name), 'utf8')})),
}, null, 2));
const logs = readdirSync(work, {withFileTypes: true}).filter(e => e.isDirectory() && e.name.startsWith('execution-')).map(e => {
  const folder = resolve(work, e.name);
  return {attempt: e.name, completed: folder === execution, files: readdirSync(folder).filter(name => name === 'processes.json' || /\.(stderr|stdout)\.txt$/.test(name)).map(name => ({name, content: readFileSync(resolve(folder, name), 'utf8')}))};
});
writeFileSync(resolve(directory, 'logs.json'), JSON.stringify(logs, null, 2));
const artifacts = [...entries, ['runtime.json', '本轮依赖版本及哈希'], ['sources.json', '原版与改造来源清单'], ['modification.json', '完整本地启动器及此前改造'], ['logs.json', '成功与失败尝试原始日志'], ['findings.md', '中文结论与反证']].map(([name,label]) => ({name,label,sha256:sha(readFileSync(resolve(directory,name)))}));
const modification = artifacts.find(a => a.name === 'modification.json');
const record = experimentSchema.parse({
  id, title: '社会模拟选型：agent-world 服务入口反证与异步桥接验证',
  question: '真实 MCP 动作、WebSocket/HTTP 观察状态与新进程恢复是否一致，串行改造能否直接接服务？',
  conclusion: result.conclusion, executedAt: result.executedAt,
  environment: 'Windows / Python 3.12.10 / 61 个固定 wheel；本地双 Uvicorn、单 asyncio loop；真实 FastMCP/ASGI/Channels/SQLite；4 子进程、16 次顺序调用，另含两客户端并发动作及注册/动作保存失败注入。未验原版 Daphne/后台线程启动拓扑。',
  inputOrigin: '助手根据用户社会模拟场景构造四个角色及记忆/表情动作；本地官方 MCP 客户端脚本，无外部 LLM 或玩家数据。',
  projectIds: ['1174766694'], sources: [{repository: result.repository, commit: result.commit, modification: {artifact: modification.name, sha256: modification.sha256, description: '本地单循环服务探针；本轮原版与本地改造均通过 async_bridge.py 接入 MCP，并在注册和 tick 后写检查点。上一轮未桥接原版失败对照保留在 logs.json；桥接只覆盖本轮启动器，不是上游完整启动器验收。'}}],
  checks: [
    {label:'真实协议与观察入口',outcome:'supported',observation:'两配置均能初始化 MCP、列出五工具、读 context；真实 tick 后 WebSocket 与 HTTP 状态一致。仅覆盖本轮启动器。'},
    {label:'未桥接原版服务状态边界',outcome:'refuted',observation:'上一轮未桥接原版 remember/emote 返回 ok，context 与观察端改变，但 SQLite 未更新，新进程丢失动作和记忆；旧失败产物保留在 logs.json。'},
    {label:'异步服务桥接',outcome:'supported',observation:'本地 async_bridge.py 将原版与改造配置的注册、context、动作通过 thread-sensitive sync_to_async 调用；两配置的 SQLite、New 角色、动作/记忆均由新进程恢复，本地改造配置额外恢复了 tick 后 06:15 检查点时钟。'},
    {label:'注册与失败输入一致性',outcome:'supported',observation:'两种桥接配置注册 New 写入数据库并可重载；未知 key 与无效动作返回结构化错误，桥接注册失败会恢复内存成员映射。'},
    {label:'观察与 HTTP 一致性',outcome:'supported',observation:'两配置 tick 后 WebSocket 与 HTTP 观察状态一致；仅覆盖本轮单循环启动器和顺序调用。'},
    {label:'错误输入',outcome:'supported',observation:'两配置均拒绝未知 key；桥接配置也明确返回无效动作错误，不再先触发异步 ORM 上下文错误。'},
    {label:'两客户端并发与保存失败回滚',outcome:'supported',observation:'原版基线和本地改造配置各用两个独立 MCP 客户端并发提交动作，均完成；注入注册及动作保存失败后，SQLite 与内存状态均保持失败前状态，Rejected 不出现在重载结果。仅覆盖本轮启动器。'},
    {label:'完整服务可用性与独立效用',outcome:'inconclusive',observation:'未验证原版 Daphne/后台启动拓扑、重复请求、中途退出、长期代理循环、完整渲染、玩家干预或用户省时。两次探针安装/transport 失败已单独保留，不能归因于上游。'},
  ], limitations: result.limitations.map((item) => item.includes('只有两种配置') ? '只有两种配置、一次完成执行，每种八次顺序 MCP 调用、两客户端并发动作和首个真实 tick；未测长期循环或性能。' : item),
  nextAction: '继续在隔离副本复现上游 Daphne/后台循环拓扑，并验证重复请求、中途退出和长期运行；保留事件等待、context、动作、玩家干预和新进程恢复边界。若需重做大部分核心则重估候选；不默认加入第二套世界状态。',
  artifacts,
});
writeFileSync(resolve(directory, 'record.json.tmp'), JSON.stringify(record, null, 2));
renameSync(resolve(directory, 'record.json.tmp'), resolve(directory, 'record.json'));
console.log(JSON.stringify({id,artifacts:artifacts.length}));
