// Assistant-assisted follow-up using the EXISTING backend; not a v4 deployment
// or an independent-user study. Default is read-only; --start creates once.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const base = 'http://127.0.0.1:4318';
const output = '.data/browser/social-alternatives';
const question = `原始需求：我想做一个社会模拟游戏。多个 AI 角色有自己的身份、记忆和目标，能自主交流、形成关系，并根据共同世界里的事件采取行动。玩家可以介入和观察。帮我找可复用的开源实现，优先考虑能直接运行的项目。
助手补充的待核实检索线索：本次真实 GitHub 搜索发现 a16z-infra/ai-town 和 joonspk-research/generative_agents；此前研究的四个候选没有覆盖这两个完整应用/经典实现。请核查这两个仓库，优先比较各自单项目采用或改造路线，再判断是否值得组合。项目名来自助手补搜，适配性仍须用实际采集原文证明。
重点比较：角色目标与记忆如何进入决策、关系及共同事件能否改变行动、玩家如何介入、保存恢复机制，以及本地启动步骤、模型/基础设施依赖和许可证。资料不足时明确列出需要核查的代码或最小实验，工时和费用缺少依据时保留未知。输出能支持下一步工程选择的结论。`;
mkdirSync(output, { recursive: true });
const get = async path => {
  const response = await fetch(`${base}/api/v1/${path}`);
  assert.equal(response.status, 200);
  return response.json();
};
const history = await get('demands');
let task = history.find(run => run.question === question);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], writes = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ method: request.method(), url: request.url() }); });
  if (!task) {
    assert.ok(process.argv.includes('--start'), 'Explicit --start required for a new model task');
    const ready = await get('health/ready');
    assert.ok(ready.ready && !ready.analysis.running && !ready.evidence.running);
    assert.ok(!history.some(run => run.status === 'running'));
    await page.goto(`${base}/research`);
    await page.getByLabel('你的需求', { exact: true }).fill(question);
    const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/v1/demands'));
    await page.getByRole('button', { name: '开始研究', exact: true }).click();
    const response = await submitted;
    assert.equal(response.status(), 202);
    task = await response.json();
    assert.equal(writes.length, 1);
  } else await page.goto(`${base}/research?run=${task.id}`);
  await page.locator('.demand-result-heading').waitFor();
  await page.reload();
  await page.locator('.demand-result-heading').waitFor();
  const normalize = text => text.replace(/\s+/gu, ' ').trim();
  assert.equal(normalize(await page.locator('.demand-result-heading h2').innerText()), normalize(question));
  task = await get(`demands/${task.id}`);
  await page.screenshot({ path: `${output}/study.png` });
  assert.deepEqual(errors, []);
  const receipt = { observedAt: new Date().toISOString(), inputOrigin: 'assistant-assisted-follow-up-with-manually-found-repository-names', originalTaskId: '06fffe22-dc24-4182-bed7-1cc70f60e1c5', taskId: task.id, status: task.status, stage: task.snapshot?.stage, loadedVersion: task.snapshot?.version, question, errors, writes };
  writeFileSync(`${output}/study.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally { await browser.close(); }
