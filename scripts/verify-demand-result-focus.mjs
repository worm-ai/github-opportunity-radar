// Real-data, read-only UX checks. No model calls or decision saves.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4318';
const runId = 'd79a1f02-17c8-4d6d-bf02-1be4e122452f';
const output = '.data/browser/demand-result-focus';
mkdirSync(output, { recursive: true });
async function get(path) {
  const response = await fetch(`${base}/api/v1/${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
}
const [runBefore, notesBefore] = await Promise.all([get(`demands/${runId}`), get('research-notes')]);
const saved = notesBefore.find(note => note.originDemandId === runId && note.author === 'assistant' && !note.supersededBy);
assert.ok(saved);
assert.ok(saved.evidence.some(item => item.ref.experimentId === 'agent-world-service-2026-10-23'));
const baseline = JSON.parse(readFileSync(`${output}/before.json`, 'utf8'));
const errors = [], writes = [], cases = [], viewports = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/research?run=${runId}`);
    await page.locator(`[data-note-id="${saved.id}"]`).waitFor();
    await page.getByRole('button', { name: '导出研究与补充实测', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.demand-composer').evaluate(element => element.open), false);
    assert.equal(await page.locator('.demand-history > details').evaluate(element => element.open), false);
    assert.equal(await page.locator('#demand-plan').evaluate(element => element.open), false);
    assert.equal(await page.locator('#demand-source-evidence').evaluate(element => element.open), false);
    const current = await page.evaluate(() => {
      const top = selector => Math.round(document.querySelector(selector).getBoundingClientRect().top + scrollY);
      return { width: innerWidth, height: document.documentElement.scrollHeight, article: top('.demand-results > article'), modelConclusion: top('.demand-model-conclusion'), decision: top('#demand-decisions'), experiments: top('#demand-experiments'), sourceDisclosure: top('#demand-source-evidence'), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    const before = baseline.viewports.find(item => item.width === width);
    assert.equal(current.overflow, false);
    assert.ok(current.decision < before.decision, JSON.stringify(current));
    assert.ok(current.height < before.height, JSON.stringify(current));
    assert.ok(current.modelConclusion < current.decision && current.decision < current.experiments);
    viewports.push({ name, ...current, before: { height: before.height, decision: before.decision }, decisionDistanceReduction: before.decision - current.decision });
    await page.screenshot({ path: `${output}/${name}-top.png` });
    const card = page.locator(`[data-note-id="${saved.id}"]`);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${name}-decision.png` });
    assert.ok(await card.innerText().then(text => text.includes('待人工复核') && text.includes(saved.nextAction)));
    const nav = page.getByRole('navigation', { name: '研究结果导航', exact: true });
    await nav.getByRole('link', { name: '需求拆解', exact: true }).click();
    assert.equal(await page.locator('#demand-plan').evaluate(element => element.open), true);
    await nav.getByRole('link', { name: '源码依据', exact: true }).click();
    await page.getByRole('heading', { name: '源码核查（未经运行验证）', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: '源码核查（未经运行验证）', exact: true }).waitFor();
    await nav.getByRole('link', { name: '选型判断', exact: true }).click();
    await card.getByRole('button', { name: '修订此判断', exact: true }).click();
    await page.getByRole('textbox', { name: '判断结论', exact: true }).waitFor();
    await page.reload();
    assert.equal(await page.getByRole('textbox', { name: '判断结论', exact: true }).inputValue(), saved.conclusion);
    assert.equal(await page.getByRole('textbox', { name: '判断下一步', exact: true }).inputValue(), saved.nextAction);
    await page.getByRole('button', { name: '编辑需求 / 重试', exact: true }).click();
    assert.equal(await page.getByLabel('你的需求', { exact: true }).inputValue(), runBefore.question);
    assert.equal(await page.locator('.demand-composer').evaluate(element => element.open), true);
    cases.push(`${name}: compact result, current decision before experiments, disclosure navigation/reload, revision and question editing`);
  }
  await page.goto(`${base}/research`);
  assert.equal(await page.locator('.demand-composer').evaluate(element => element.open), true);
  await page.getByRole('button', { name: '使用社会模拟示例', exact: true }).click();
  assert.ok((await page.getByLabel('你的需求', { exact: true }).inputValue()).includes('社会模拟游戏'));
  await page.locator('.demand-history button').first().click();
  await page.locator('.demand-result-heading').waitFor();
  assert.equal(await page.locator('.demand-composer').evaluate(element => element.open), false);
  await page.goBack();
  await page.locator('.demand-empty').waitFor();
  assert.equal(await page.locator('.demand-composer').evaluate(element => element.open), true);
  cases.push('new task and browser back show the composer; choosing history collapses it; example does not submit');
  assert.deepEqual(await get(`demands/${runId}`), runBefore);
  assert.deepEqual(await get('research-notes'), notesBefore);
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/verification.json`, JSON.stringify({ observedAt: new Date().toISOString(), base, runId, noteId: saved.id, viewports, cases, writes, errors, originalDemandAndNotesUnchanged: true, baselineCaveat: 'before.json.conclusion is the source-evidence position, not a measured model conclusion; not used in comparison.', limitation: 'Assistant self-use verifies navigation effort only; no independent user time saving or judgment-quality claim.' }, null, 2));
  console.log(JSON.stringify({ output, viewports, cases, writes, errors }));
  await context.close();
} finally { await browser.close(); }
