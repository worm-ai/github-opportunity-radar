// Publish an explicitly STATIC manual audit through existing archive/note facilities.
// No model calls, task submissions, service restarts or upstream execution.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { experimentSchema, readExperiment, experimentArtifact } from '../apps/server/src/experiments.ts';

const base = 'http://127.0.0.1:4318/api/v1';
const taskId = '86de1f5b-45a6-40d9-b01c-122a1d20bb36';
const audit = '.data/experiments/social-alternatives-source-2026-10-23';
const archiveRoot = '.data/demand-live-20261023/technical-experiments';
const id = 'social-alternatives-static-2026-10-23';
const destination = `${archiveRoot}/${id}`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));
const get = async path => {
  const response = await fetch(`${base}/${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
};
const [task, history, notes, archive] = await Promise.all([get(`demands/${taskId}`), get('demands'), get('research-notes'), get('experiments')]);
assert.equal(task.status, 'failed');
assert.equal(task.snapshot.evaluations.length, 0);
assert.ok(archive.records.some(record => record.id === 'agent-world-service-2026-10-23'));
assert.ok(existsSync(`${archiveRoot}/agent-world-service-2026-10-23/record.json`));
const projects = task.snapshot.projects.filter(project => ['a16z-infra/ai-town', 'joonspk-research/generative_agents'].includes(project.fullName));
assert.equal(projects.length, 2);

const sourceFiles = [];
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) visit(path);
    else if (entry.name.endsWith('.source.json')) {
      const receipt = JSON.parse(readFileSync(path, 'utf8'));
      const bytes = readFileSync(path.slice(0, -'.source.json'.length));
      assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), receipt.blob);
      assert.equal(bytes.length, receipt.bytes);
      const project = projects.find(project => project.fullName === receipt.repository);
      assert.ok(project && receipt.verifiedBlob && receipt.runtimeExecuted === false);
      sourceFiles.push({ ...receipt, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
    }
  }
}
visit(`${audit}/ai-town`);
visit(`${audit}/generative-agents`);
assert.equal(sourceFiles.length, 14, 'Bounded selection, not a full repository audit');
const anchors = [
  ['a16z-infra/ai-town', 'convex/aiTown/agentOperations.ts', 'const activity = ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)];'],
  ['a16z-infra/ai-town', 'convex/aiTown/agent.ts', 'candidates.push({ id: otherPlayer.id, position });'],
  ['a16z-infra/ai-town', 'convex/aiTown/game.ts', 'await Game.saveDiff(ctx, args.worldId, args.worldDiff);'],
  ['joonspk-research/generative_agents', 'reverie/backend_server/persona/persona.py', 'plan = self.plan(maze, personas, new_day, retrieved)'],
  ['joonspk-research/generative_agents', 'reverie/backend_server/persona/cognitive_modules/plan.py', 'reaction_mode = _should_react(persona, focused_event, personas)'],
  ['joonspk-research/generative_agents', 'reverie/backend_server/reverie.py', 'persona.save(save_folder)'],
].map(([repository, path, quote]) => {
  const source = sourceFiles.find(source => source.repository === repository && source.path === path);
  assert.ok(source?.content.includes(quote));
  return { repository, path, quote, line: source.content.slice(0, source.content.indexOf(quote)).split('\n').length, url: source.url };
});

mkdirSync(destination, { recursive: true });
writeFileSync(`${destination}/comparison.md`, readFileSync('docs/research/2026-10-23-social-alternatives-source.md'));
save(`${destination}/sources.json`, { kind: 'static-source-review-only', upstreamCodeExecuted: false, sourceFiles, anchors });
const payload = {
  question: task.question, plan: task.snapshot.plan, projects: task.snapshot.projects,
  sources: task.snapshot.sources,
  searches: task.snapshot.searches.map(({ items, ...search }) => ({ ...search, candidates: items.map(item => item.fullName) })),
  previousEvaluations: task.snapshot.evaluations,
};
const footprint = {
  kind: 'offline-shape-reconstruction-not-failed-request-receipt',
  taskId, reconstructedDataBytes: Buffer.byteLength(JSON.stringify(payload)),
  fields: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, Buffer.byteLength(JSON.stringify(value))])),
  sourceCharacters: task.snapshot.sources.reduce((sum, source) => sum + source.content.length, 0),
  failedCallTokens: null, causeEstablished: false,
  limitation: 'Reconstructed from saved snapshot and current evaluation data shape; original v1 prompt, schema and failed CLI stream were not preserved. Bytes are not model tokens. No live model call or timeout increase.',
};
save(`${destination}/input-footprint.json`, footprint);
const filenameLabels = [['comparison.md', '助手静态比较与可推翻的下一步'], ['sources.json', '14 份固定源码、Git blob 校验与精确引文'], ['input-footprint.json', '离线输入形状统计，非超时原因证明']];
const record = experimentSchema.parse({
  id, title: '社会模拟选型：AI Town 与 Stanford 静态源码核查（未运行应用）',
  question: '在继续改造 agent-world 前，两个遗漏完整应用是否提供更值得验证的单项目路径？',
  conclusion: '静态判断：先验证 Stanford 的记忆—事件—计划—行动及新进程恢复；交互小镇优先时再前置 AI Town。未推荐直接采用或组合，未运行两应用。',
  executedAt: existsSync(`${destination}/record.json`) ? readExperiment(archiveRoot, id).executedAt : new Date().toISOString(),
  environment: `Windows / Node ${process.version}；固定提交 GitHub 树与 blob 只读采集，SHA-1/字节校验；本地静态阅读，未执行上游代码`,
  inputOrigin: '助手自用社会模拟案例；行为与恢复验收条件由助手展开，非独立用户需求验证',
  projectIds: projects.map(project => project.id),
  sources: projects.map(project => ({ repository: project.fullName, commit: sourceFiles.find(source => source.repository === project.fullName).commit })),
  checks: [
    { label: '静态：AI Town 活动选择', outcome: 'supported', observation: '已读 agentDoSomething 使用随机活动和游走；对话记忆不能证明目标驱动的行动。该分支保留 LLM 选活动 TODO。' },
    { label: '静态：AI Town 交谈候选距离', outcome: 'refuted', observation: '“最近候选”实现与注释不符：候选 position 均来自当前玩家，距离排序均为零；未运行应用复现。' },
    { label: '静态：Stanford 记忆与行动链', outcome: 'supported', observation: 'Persona.move 将感知与检索传入 plan，再 reflect/execute；plan 选事件后判断交谈或等待。仅源码路径成立，行为质量未知。' },
    { label: '静态：保存恢复入口', outcome: 'inconclusive', observation: '两者都有保存与加载入口；Stanford 分文件写 meta/角色，环境/动作另存。新进程恢复、事件因果效果和运行成本尚未验证。' },
    { label: '离线：评估超时', outcome: 'inconclusive', observation: '只统计已存快照重建的数据形状，没有失败调用 token 与完整提示；未确立超时原因，不重提研究或延长超时。' },
  ],
  limitations: ['这是人工静态核查，supported/refuted 只指所述代码事实；不是应用运行或用户收益证据。', '只选读 14 个文件和指定目录清单，未覆盖全仓库；未见能力记为未知。', '原研究模型评估仍失败，此记录不替代模型评估与反方流程。', '助手判断待人工复核；许可证及素材、依赖/API 兼容、工时和费用尚未完整核验。'],
  nextAction: '先隔离验证 Stanford 最小角色基线与事件对照，再新进程恢复。启动不兼容、状态不一致或只改话术不改行动就停止扩展；优先级若改为可玩聊天小镇，则改验 AI Town。',
  artifacts: filenameLabels.map(([name, label]) => ({ name, label, sha256: sha256(readFileSync(`${destination}/${name}`)) })),
});
save(`${destination}/record.json`, record);
for (const artifact of readExperiment(archiveRoot, id).artifacts) assert.ok(experimentArtifact(archiveRoot, id, artifact.name));
const visible = await get('experiments');
assert.ok(visible.records.some(record => record.id === id));
assert.deepEqual(visible.warnings, archive.warnings);

const draftPath = `${audit}/note-request.json`;
const sourceForNotes = await get(`demands/${taskId}/note-sources`);
const evidence = projects.map(project => {
  const source = sourceForNotes.sources.find(source => source.ref.kind === 'experiment' && source.ref.experimentId === id && source.ref.projectId === project.id);
  assert.ok(source?.text.includes(record.conclusion));
  return { ref: source.ref, quote: record.conclusion };
});
const input = {
  requestId: existsSync(draftPath) ? JSON.parse(readFileSync(draftPath, 'utf8')).requestId : randomUUID(),
  author: 'assistant', originDemandId: taskId,
  title: '先验 Stanford 行为与恢复；AI Town 保留为交互备选（静态判断）',
  question: task.question, projectIds: projects.map(project => project.id), decision: 'continue',
  conclusion: '依据固定版本的人工静态源码核查，先验证 Stanford 单项目的记忆、事件、计划到行动链及新进程恢复；AI Town 更适合交互小镇优先的路线，但已读活动分支随机选择，不能当作目标驱动规划。当前不组合，不继续扩修 agent-world。两应用都未运行，原模型评估仍超时；这只是助手的下一步验证优先级，待人工复核，不是最终采用推荐。',
  nextAction: record.nextAction, evidence,
};
if (existsSync(draftPath)) assert.deepEqual(JSON.parse(readFileSync(draftPath, 'utf8')), input, 'Existing note request must not change silently');
else save(draftPath, input);
const response = await fetch(`${base}/research-notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
assert.ok([200, 201].includes(response.status), `Note save failed ${response.status}`);
const note = await response.json();
assert.equal(note.author, 'assistant');
assert.equal(note.originDemandId, taskId);
assert.deepEqual(note.evidenceStates, ['same', 'same']);
assert.deepEqual(await get(`demands/${taskId}`), task);
assert.deepEqual(await get('demands'), history);
const after = await get('research-notes');
for (const previous of notes) assert.deepEqual(after.find(item => item.id === previous.id), previous);
const result = { observedAt: new Date().toISOString(), id, noteId: note.id, sourceFiles: sourceFiles.length, archive: resolve(destination), historyUnchanged: true, oldNotesUnchanged: true, upstreamExecuted: false, modelCalled: false, footprint, anchors };
save(`${audit}/publication.json`, result);
console.log(JSON.stringify(result));
