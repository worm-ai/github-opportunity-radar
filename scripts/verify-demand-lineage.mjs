// Real saved research, read-only browser checks. --before captures the old UI/data.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4318', output = '.data/browser/demand-lineage';
const parent = '06fffe22-dc24-4182-bed7-1cc70f60e1c5', child = 'd79a1f02-17c8-4d6d-bf02-1be4e122452f';
mkdirSync(output, { recursive: true });
async function get(path) { const r = await fetch(`${base}/api/v1/${path}`); assert.equal(r.status, 200, path); return r.json(); }
const history = await get('demands');
const state = { history, runs: await Promise.all(history.map(run => get(`demands/${run.id}`))), notes: await get('research-notes') };
const note = state.notes.find(item => item.originDemandId === child && !item.supersededBy && item.author === 'assistant');
assert.ok(note);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage(), errors = [], writes = [], cases = [], layouts = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
try {
  if (process.argv.includes('--before')) {
    await page.goto(`${base}/research?run=${parent}`);
    await page.locator('.demand-model-conclusion').waitFor();
    assert.equal(await page.locator(`[data-note-id="${note.id}"]`).count(), 0);
    writeFileSync(`${output}/before.json`, JSON.stringify({ capturedAt: new Date().toISOString(), state, parentHasCurrentDecision: false }, null, 2));
    await page.screenshot({ path: `${output}/before-parent.png` });
    console.log('Captured old parent report and immutable research/note baseline.');
  } else {
    const before = JSON.parse(readFileSync(`${output}/before.json`, 'utf8'));
    // New, independent studies may legitimately have been added after this baseline.
    // Every original record and judgment must remain byte-for-byte equivalent.
    for (const run of before.state.history) assert.deepEqual(state.history.find(item => item.id === run.id), run);
    for (const run of before.state.runs) assert.deepEqual(state.runs.find(item => item.id === run.id), run);
    assert.deepEqual(state.notes, before.state.notes);
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}/research?run=${parent}`);
      const region = page.getByRole('region', { name: '关联研究与最新判断', exact: true });
      const linked = region.locator(`[data-linked-note-id="${note.id}"]`);
      await linked.waitFor();
      assert.ok((await linked.innerText()).includes(note.title));
      assert.ok((await linked.innerText()).includes(note.nextAction));
      assert.ok((await linked.innerText()).includes('待人工复核'));
      assert.equal(await page.getByRole('button', { name: '开始扫描', exact: true }).count(), 0);
      await region.locator('.demand-lineage-tasks > summary').click();
      assert.equal(await region.locator('.demand-lineage-tasks li').count(), 6);
      assert.ok((await region.innerText()).includes('失败'));
      layouts.push({ name, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
      assert.equal(layouts.at(-1).overflow, false);
      await region.evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `${output}/${name}-parent.png` });
      await linked.getByRole('link', { name: '查看关联任务的判断与引文', exact: true }).click();
      const card = page.locator(`[data-note-id="${note.id}"]`);
      await card.waitFor();
      assert.equal(new URL(page.url()).searchParams.get('run'), child);
      assert.equal(new URL(page.url()).hash, '#demand-decisions');
      await page.waitForFunction(() => Math.abs(document.getElementById('demand-decisions').getBoundingClientRect().top) < 150);
      await page.reload(); await card.waitFor();
      await page.waitForFunction(() => Math.abs(document.getElementById('demand-decisions').getBoundingClientRect().top) < 150);
      await page.goBack(); await linked.waitFor();
      assert.equal(new URL(page.url()).searchParams.get('run'), parent);
      cases.push(`${name}: original report -> current related judgment in one click; reload, back, six-task lineage, no overflow`);
    }
    await page.goto(`${base}/research`);
    await page.locator('.demand-history-group').first().waitFor();
    const socialQuestion = state.runs.find(run => run.id === parent).question;
    const socialGroups = page.locator('.demand-history-group').filter({ has: page.locator('button', { hasText: socialQuestion }) });
    assert.equal(await socialGroups.count(), 2, 'independent identical question stays separate even with unrelated new studies');
    await socialGroups.filter({ hasText: parent.slice(0, 8) }).getByRole('button').first().click();
    await page.locator(`[data-linked-note-id="${note.id}"]`).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('run'), parent, 'group opens usable original report');
    await page.getByRole('button', { name: '编辑需求 / 重试', exact: true }).click();
    await page.getByRole('button', { name: '按当前需求重新研究', exact: true }).waitFor();
    await page.getByRole('link', { name: '新需求', exact: true }).click();
    await page.locator('.demand-empty').waitFor();
    assert.equal(await page.locator('.demand-composer').evaluate(element => element.open), true);
    assert.equal(await page.getByRole('button', { name: '开始研究', exact: true }).count(), 1, 'new demand must not inherit retry lineage');
    cases.push('same-text independent task remains separate; group opens usable original; new-demand action opens composer');

    // Read failures must not masquerade as empty evidence. New contexts avoid cached data.
    for (const endpoint of ['research-notes', 'demands']) {
      const isolated = await browser.newContext();
      await isolated.route(`${base}/api/v1/${endpoint}`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'test unavailable' } }) }));
      const fixture = await isolated.newPage();
      fixture.on('pageerror', error => errors.push(error.message));
      fixture.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method()); });
      await fixture.goto(`${base}/research?run=${parent}`);
      await fixture.getByText(endpoint === 'research-notes' ? /关联判断读取失败，不能据此视为没有判断/ : /研究记录读取失败，关联任务可能未显示/).waitFor();
      await isolated.close();
      cases.push(`${endpoint} failure explicitly displayed`);
    }
    const legacy = await browser.newContext();
    let noteRequests = 0;
    await legacy.route(`${base}/api/v1/demands/features`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sourceStudy: true, sourceResume: true }) }));
    legacy.on('request', request => { if (request.url().endsWith('/api/v1/research-notes')) noteRequests++; });
    const legacyPage = await legacy.newPage();
    await legacyPage.goto(`${base}/research?run=${parent}`);
    await legacyPage.locator('.demand-model-conclusion').waitFor();
    await legacyPage.getByRole('region', { name: '关联研究与最新判断', exact: true }).waitFor();
    assert.equal(noteRequests, 0);
    await legacy.close(); cases.push('older backend without notes feature retains task navigation without unsupported API requests');
    assert.deepEqual(await get('demands'), state.history);
    assert.deepEqual(await Promise.all(history.map(run => get(`demands/${run.id}`))), state.runs);
    assert.deepEqual(await get('research-notes'), state.notes);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    writeFileSync(`${output}/verification.json`, JSON.stringify({ observedAt: new Date().toISOString(), cases, layouts, writes, errors, historicalResearchAndNotesUnchanged: true, limitation: 'Assistant self-use and injected outage fixtures; no independent user benefit claim.' }, null, 2));
    console.log(JSON.stringify({ output, cases, layouts, writes, errors }));
  }
} finally { await context.close(); await browser.close(); }
