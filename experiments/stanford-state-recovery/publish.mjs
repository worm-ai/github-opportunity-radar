import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { experimentSchema } from '../../apps/server/dist/experiments.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const work = resolve(root, '.data/experiments/stanford-state-20261024');
const probe = resolve(work, 'recovery-probe');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = (source, target) => copyFileSync(source, resolve(target));
const commit = 'fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4';
const sources = readJson(resolve(work, 'sources.json'));
assert.equal(sources.repository, 'joonspk-research/generative_agents');
assert.equal(sources.commit, commit);
for (const name of ['scratch.py', 'associative_memory.py', 'spatial_memory.py', 'retrieve.py', 'persona.py']) {
  const bytes = readFileSync(resolve(work, 'vendor', name));
  const receipt = sources.receipts.find(item => item.path.endsWith('/' + name));
  assert.ok(receipt, name);
  assert.equal(receipt.commit, commit);
  assert.equal(bytes.length, receipt.bytes);
  assert.equal(createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'), receipt.blob, name);
}

const result = readJson(resolve(probe, 'results.json'));
assert.equal(result.cases.normal.write.result.save, 'ok');
assert.equal(result.cases.normal.write.returncode, 0);
assert.equal(result.cases.normal.read.returncode, 0);
assert.equal(result.cases.normal.read.result.curr_time, '2026-10-24T10:15:00');
assert.equal(result.cases.normal.read.result.act_start_time, '2026-10-24T10:00:00');
assert.equal(result.cases.normal.read.result.act_address, 'town:market:stall');
assert.deepEqual(result.cases.normal.read.result.planned_path, [[1, 3], [1, 4]]);
assert.equal(result.cases.null_action_time.save_with_null.returncode, 1);
assert.match(result.cases.null_action_time.save_with_null.stderr, /AttributeError/);
assert.equal(result.cases.null_action_time.load_null.read.result.curr_time, null);
assert.equal(result.cases.null_action_time.load_null.read.result.act_start_time, null);
assert.equal(result.cases.null_action_time.load_null.make.returncode, 0);
assert.equal(result.cases.null_action_time.load_null.read.returncode, 0);
assert.equal(result.cases.memory_last_accessed.write.returncode, 0);
assert.equal(result.cases.memory_last_accessed.read.returncode, 0);
assert.equal(result.cases.memory_last_accessed.write.result.last_accessed_before, '2026-10-24T12:34:56');
assert.equal(result.cases.memory_last_accessed.read.result.last_accessed_after, '2026-10-24T09:00:00');

const id = 'stanford-state-recovery-2026-10-24';
const directory = resolve(root, '.data/demand-live-20261023/technical-experiments', id);
mkdirSync(directory, { recursive: true });

const sourceFiles = ['scratch.py', 'associative_memory.py', 'spatial_memory.py', 'retrieve.py', 'persona.py'];
const reproduction = {
  scope: '原始探针结果及当前复现材料归档；旧结果未记录运行时脚本哈希，因此不能据本包追溯证明当时脚本逐字一致。',
  dependencyBoundary: '探针以本地文件存在检查替代 global_methods，仅直接加载两个记忆类，不是完整上游依赖或应用运行。',
  probe: { name: 'scripts/verify-stanford-state-recovery.py', content: readFileSync(resolve(root, 'scripts/verify-stanford-state-recovery.py'), 'utf8') },
  preparation: { name: 'scripts/prepare-stanford-state-probe.mjs', content: readFileSync(resolve(root, 'scripts/prepare-stanford-state-probe.mjs'), 'utf8') },
  sources: sourceFiles.map(name => ({ name, content: readFileSync(resolve(work, 'vendor', name), 'utf8') })),
};
const runtime = {
  source: readJson(resolve(work, 'sources.json')),
  interpreter: 'Python 3.12.7 isolated runtime',
  networkRequests: 0,
  sourceFiles: sourceFiles.map(name => ({ name, sha256: sha(readFileSync(resolve(work, 'vendor', name))) })),
};
writeFileSync(resolve(directory, 'reproduction.json'), JSON.stringify(reproduction, null, 2));
writeFileSync(resolve(directory, 'runtime.json'), JSON.stringify(runtime, null, 2));

const entries = [
  ['results.json', '正常恢复、空值失败与最近访问时间结果'],
  ['sources.json', '固定提交与 Git blob 核验回执'],
  ['runtime.json', '隔离运行时、来源与源码哈希'],
  ['reproduction.json', '探针脚本与固定源码快照'],
  ['findings.md', '研究结论、反证与下一步'],
];
copy(resolve(probe, 'results.json'), directory + '/results.json');
copy(resolve(work, 'sources.json'), directory + '/sources.json');
copy(resolve(root, 'docs/research/2026-10-24-stanford-state-recovery.md'), directory + '/findings.md');

const artifacts = entries.map(([name, label]) => ({ name, label, sha256: sha(readFileSync(resolve(directory, name))) }));
const record = experimentSchema.parse({
  id,
  title: '社会模拟选型：Stanford Generative Agents 状态恢复边界',
  question: '固定提交中的记忆与行动状态能否跨进程保存和恢复，是否足以支撑多角色社会模拟游戏的连续运行？',
  conclusion: '固定提交的最小组件在正常 curr_time、行动地址、路径和记忆节点场景下可以跨进程读取；但 act_start_time 为空时保存直接抛出 AttributeError，空行动时间载入还会把 curr_time 清成 null，last_accessed 也没有持久化。它支持继续修复状态协议的单项目路线，不支持直接采用完整游戏，也不支持把它与其他候选的世界状态系统强行组合。',
  executedAt: new Date(result.observedAt).toISOString(),
  environment: 'Windows / Python 3.12.7 隔离解释器；固定 Stanford Generative Agents 提交及 Git blob 校验源码；独立进程读写；无网络请求。',
  inputOrigin: '根据用户提出的多 agent 社会模拟游戏场景，使用合成的最小行动、路径和记忆状态；未调用外部 LLM，未使用玩家数据。',
  projectIds: ['669727723'],
  sources: [{
    repository: 'joonspk-research/generative_agents',
    commit,
  }],
  checks: [
    { label: '正常状态跨进程恢复', outcome: 'supported', observation: 'curr_time、act_start_time、行动地址和 planned_path 写入后由独立进程成功读取，值保持一致。' },
    { label: '空行动时间的保存语义', outcome: 'refuted', observation: 'act_start_time=None 在真实 scratch.py:287 调用 strftime，保存失败并抛出 AttributeError。' },
    { label: '空行动时间的载入语义', outcome: 'refuted', observation: '人工构造的空行动时间 JSON 可以读取，但源码把当前时间读成 null，不能作为安全恢复协议。' },
    { label: '记忆最近访问时间持久化', outcome: 'refuted', observation: '写入前 last_accessed 为 2026-10-24T12:34:56，恢复后回到创建时间 2026-10-24T09:00:00，检索排序可能改变。' },
    { label: '完整社会模拟游戏与用户价值', outcome: 'inconclusive', observation: '没有运行完整主循环、环境地图、三角色事件到行动、Web/MCP、外部 LLM、玩家干预或独立用户任务；本实验不能证明完整产品可用或节省时间。' },
  ],
  limitations: [
    '探针使用合成最小状态，未覆盖真实角色数据库、完整 bootstrap、并发写入、崩溃中断或升级迁移。',
    '探针用本地文件存在检查替代 global_methods；旧结果没有运行时脚本哈希，归档的复现脚本为发布时快照。发布时重新校验五份源码 Git blob，不代表当时全部依赖已核验。',
    '未运行完整 Stanford 应用主循环、环境和多角色事件到行动闭环。',
    '没有外部 LLM、Godot 界面、玩家观察/介入或独立用户验收。',
    '本次使用已保存且核验过的固定提交材料，GitHub 新鲜搜索当时受本机证书链阻断，不能称作新鲜网络采集。',
    '未比较 Microverse 或 agent-world 的修复成本，不能据此证明组合方案更优。',
  ],
  nextAction: '先修复 act_start_time 空值和 last_accessed 持久化协议，并用完整环境文件和至少三角色事件到行动的跨进程闭环复测；在此之前保留单项目验证，不引入第二套世界状态系统，也不宣称已经验证市场价值。',
  artifacts,
});
writeFileSync(resolve(directory, 'record.json.tmp'), JSON.stringify(record, null, 2));
renameSync(resolve(directory, 'record.json.tmp'), resolve(directory, 'record.json'));
console.log(JSON.stringify({ id, directory, artifacts: artifacts.length, verifiedGitBlobs: sourceFiles.length, upstreamModified: false }));
