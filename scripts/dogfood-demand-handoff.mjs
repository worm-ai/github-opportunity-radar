// Self-use for a real product requirement, not an external-user validation.
// Reuses the saved task on repeat; --start explicitly submits at most one new study.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4318', output = '.data/browser/demand-handoff';
const question = '我维护一个本地开源项目研究工具，前端 React/TypeScript，后端 Node.js 24。已有结构化 JSON 研究：原始需求、候选、能力覆盖、逐字引文、固定提交、人工判断和实测边界。我需要让使用者把当前结果导出为一份可离线阅读、通过浏览器打印成 PDF 的中文交接简报，收件人不必安装或登录本工具。必须保留来源链接、版本、失败及未知状态；长中文、代码和长 URL 不能横向溢出。不能新增服务器、数据库或模型调用，不能把文档自述写成运行通过。请搜索可复用开源实现，先比较直接用现有结构化数据生成静态 HTML 加浏览器打印是否已经足够；若确实有必要才改造单个成熟项目，只有明确缺口才组合。不要为复用引入不必要依赖。请给出工程取舍、最小实验及能推翻推荐的结果。';
mkdirSync(output, { recursive: true });
const history = await (await fetch(`${base}/api/v1/demands`)).json();
let task = history.find(run => run.question === question);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ method: request.method(), url: request.url() }); });
try {
  if (!task) {
    assert.ok(process.argv.includes('--start'), 'No existing study. Explicit --start required.');
    const ready = await (await fetch(`${base}/api/v1/health/ready`)).json();
    assert.ok(ready.ready && !ready.analysis.running && !ready.evidence.running);
    assert.ok(!history.some(run => run.status === 'running'));
    await page.goto(`${base}/research`);
    await page.getByLabel('你的需求', { exact: true }).fill(question);
    const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/v1/demands'));
    await page.getByRole('button', { name: '开始研究', exact: true }).click();
    const response = await submitted; assert.equal(response.status(), 202);
    task = await response.json();
    assert.equal(writes.length, 1);
  } else await page.goto(`${base}/research?run=${task.id}`);
  await page.locator('.demand-result-heading').waitFor();
  await page.reload(); await page.locator('.demand-result-heading').waitFor();
  assert.equal(await page.locator('.demand-result-heading h2').innerText(), question);
  task = await (await fetch(`${base}/api/v1/demands/${task.id}`)).json();
  await page.screenshot({ path: `${output}/study.png` });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/study.json`, JSON.stringify({ observedAt: new Date().toISOString(), inputOrigin: 'assistant-self-use-real-project-requirement', taskId: task.id, status: task.status, stage: task.snapshot?.stage, question, errors, writes }, null, 2));
  console.log(JSON.stringify({ id: task.id, status: task.status, stage: task.snapshot?.stage, errors, writes }));
} finally { await browser.close(); }
