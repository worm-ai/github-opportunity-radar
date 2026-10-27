import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const work = resolve(root, '.data/experiments/agent-world-service');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const execution = read(resolve(work, 'latest.json')).directory;
assert.equal(resolve(execution, '..'), work);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const processes = read(resolve(execution, 'processes.json'));
assert.equal(processes.length, 4);
assert.ok(processes.every(p => p.returncode === 0));
const payload = call => {
  assert.equal(call.response.isError, false);
  return JSON.parse(call.response.content.find(c => c.type === 'text').text);
};
const evidence = {};
for (const mode of ['original-bridged', 'adapted-bridged']) {
  const run = read(resolve(execution, `${mode}.json`));
  const reload = read(resolve(execution, `${mode}-reload.json`));
  assert.equal(run.calls.length, 8);
  assert.equal(run.restStatus, 200);
  assert.deepEqual(run.observerAfter, run.restAfter);
  assert.equal(run.observerInitial.clock.minute, 0);
  assert.equal(run.observerAfter.clock.minute, 15);
  assert.equal(reload.clock.minute, mode === 'adapted-bridged' ? 15 : 0);
  assert.ok(run.afterDisk.length > run.beforeDisk.length);
  assert.deepEqual(reload.disk, run.afterDisk);
  assert.equal(run.concurrent.length, 2);
  assert.ok(run.concurrent.every(item => item.isError === false));
  assert.equal(run.saveFailure.diskUnchanged, true);
  assert.equal(run.saveFailure.memoryUnchanged, true);
  assert.deepEqual(payload(run.calls[0]).result.agent.memory, []);
  assert.equal(payload(run.calls[4]).result.error, 'Unknown API key');
  assert.ok(run.inMemory.New);
  assert.ok(!run.inMemory.Rejected);
  assert.ok(run.observerAfter.agents.some(a => a.name === 'New'));
  assert.ok(reload.agents.New);
  assert.deepEqual(reload.agents.Alice.memory, ['service persistence probe']);
  assert.equal(reload.agents.Alice.current_action, 'saying: "concurrent Alice"');
  const observerAlice = run.observerAfter.agents.find(a => a.name === 'Alice');
  for (const index of [1, 2]) assert.equal(payload(run.calls[index]).result.ok, true);
  assert.deepEqual(payload(run.calls[3]).result.agent.memory, ['service persistence probe']);
  assert.equal(observerAlice.current_action, 'saying: "concurrent Alice"');
  assert.deepEqual(run.inMemory.Alice.memory, ['service persistence probe']);
  assert.equal(payload(run.calls[5]).result.error, 'Unknown action type: invalid-action');
  assert.equal(payload(run.calls[6]).result.type, 'heartbeat');
  assert.equal(run.calls[7].response.isError, true);
  assert.ok(run.calls[7].response.content.some(c => c.text?.includes('injected bridge persistence failure')));
  assert.ok(!run.afterDisk.some(agent => agent.name === 'Rejected'));
  evidence[mode] = {
    protocolVersion: run.protocolVersion, tools: run.tools,
    actionAccepted: true, actionVisible: true,
    databaseUnchanged: false, actionRecovered: true,
    newAgentVisible: true, newAgentRecovered: true,
    webSocketMatchesHttp: true, concurrentClients: true, saveFailureRollback: true,
    clock: { observed: run.observerAfter.clock, recovered: reload.clock },
    errors: run.calls.filter(c => c.response.isError).map(c => ({name: c.name, action: c.arguments.action_type, content: c.response.content})),
  };
}
const scripts = Object.fromEntries(['prepare.mjs', 'bootstrap.mjs', 'run.py', 'async_bridge.py', 'analyze.mjs'].map(name => [name, sha(readFileSync(resolve(root, 'experiments/agent-world-service', name)))]));
const files = ['processes.json', ...['original-bridged', 'adapted-bridged'].flatMap(mode => [`${mode}.json`, `${mode}-reload.json`, `${mode}.stderr.txt`, `${mode}.stdout.txt`, `${mode}-reload.stderr.txt`, `${mode}-reload.stdout.txt`])];
const result = {
  executedAt: statSync(execution).birthtime.toISOString(), analyzedAt: new Date().toISOString(),
  repository: 'sbenodiz/agent-world', commit: '13d62dbdeeca07c7b5bb3b8aa264ca9834b01882',
  subprocesses: 4, calls: 16, evidence, scripts,
  artifacts: Object.fromEntries(files.map(name => [name, sha(readFileSync(resolve(execution, name)))])),
  manifests: Object.fromEntries(['sources.json', 'runtime/runtime.json'].map(name => [name, sha(readFileSync(resolve(work, name)))])),
  conclusion: "未桥接原版入口曾因异步 MCP 直接调用同步 ORM 而丢失持久化；本轮 async_bridge.py 统一使用线程敏感同步边界，两个客户端并发动作均完成，保存失败时 SQLite 与内存同时回滚，注册、动作和新进程恢复通过。本地改造配置还恢复了 tick 后检查点时钟。桥接和并发回滚属于本地实验启动器，尚未验证上游 Daphne 拓扑、长期负载或完整游戏，不能直接推荐采用。",
  limitations: [
    '自建单 asyncio loop、双 Uvicorn 启动器，真实 MCP/ASGI/Channels；未验原版 Daphne 主线程/后台循环拓扑。',
    '只有两种配置、一次完成执行，每种八次顺序 MCP 调用和首个真实 tick；桥接实验未测并发、长期循环或性能。',
    '重载是停止服务后的新进程读取，不是掉电或中途 kill，也没有为此新增服务末尾完整检查点。',
    '真实客户端脚本和合成角色；无外部 LLM、玩家完整流程、地图渲染或独立用户收益。',
    '依赖为本轮固定 wheel 集合，未还原上游历史完整依赖锁；结果仅适用于本轮组合。',
  ],
};
writeFileSync(resolve(execution, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
