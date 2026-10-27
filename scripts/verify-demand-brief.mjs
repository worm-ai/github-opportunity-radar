// Real UI downloads + disconnected file reading + PDF output. No production writes.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { renderDemandBrief } from '../apps/web/src/demand-brief.ts';
import { groupDemandRuns } from '../apps/web/src/demand-lineage.ts';

const base = 'http://127.0.0.1:4318', output = '.data/browser/demand-handoff';
const parent = '06fffe22-dc24-4182-bed7-1cc70f60e1c5', child = 'd79a1f02-17c8-4d6d-bf02-1be4e122452f', self = '792667cf-5d44-4e5a-bb36-dd8b33a5364f';
mkdirSync(output, { recursive: true });
async function get(path) { const r = await fetch(`${base}/api/v1/${path}`); assert.equal(r.status, 200, path); return r.json(); }
const history = await get('demands');
assert.ok(!history.some(run => run.status === 'running'), 'Do not verify a changing live study');
const runs = await Promise.all(history.map(run => get(`demands/${run.id}`))), notes = await get('research-notes'), archive = await get('experiments');
const current = notes.find(note => note.originDemandId === child && !note.supersededBy && note.author === 'assistant');
assert.ok(current);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const online = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const page = await online.newPage(), writes = [], errors = [], cases = [], reports = [];
const track = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
};
track(page);
try {
  for (const [name, id] of [['social-original', parent], ['social-source', child], ['self-use', self]]) {
    const run = runs.find(run => run.id === id); assert.ok(run);
    await page.goto(`${base}/research?run=${id}`);
    const button = page.getByRole('button', { name: '导出离线交接简报', exact: true });
    await button.waitFor(); await page.waitForFunction(() => !document.querySelector('.demand-brief-export button').disabled);
    const downloadEvent = page.waitForEvent('download'); await button.click();
    const download = await downloadEvent, file = `${output}/${name}.html`;
    await download.saveAs(file); assert.equal(download.suggestedFilename(), `implementation-brief-${id}.html`);
    const html = readFileSync(file, 'utf8');
    assert.ok(html.includes(id)); assert.ok(!html.includes('<script'));
    const offline = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 } });
    const reader = await offline.newPage(), network = []; track(reader);
    reader.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    await reader.goto(pathToFileURL(resolve(file)).href);
    const text = await reader.locator('body').innerText();
    assert.ok(text.includes(run.question));
    if (id !== self) { assert.ok(text.includes(current.title)); assert.ok(text.includes(current.nextAction)); for (const cite of current.evidence) assert.ok(text.includes(cite.quote)); }
    for (const path of run.snapshot?.evaluations.at(-1)?.paths ?? []) {
      assert.ok(text.includes(path.title));
      for (const risk of path.risks) assert.ok(text.includes(risk));
      for (const item of path.coverage) for (const cite of item.evidence) assert.ok(text.includes(cite.quote));
    }
    for (const source of run.snapshot?.sources ?? []) { if (source.commitSha) assert.ok(text.includes(source.commitSha)); }
    for (const width of [1440, 390]) { await reader.setViewportSize({ width, height: 1000 }); assert.equal(await reader.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} overflow ${width}`); }
    await reader.screenshot({ path: `${output}/${name}-mobile.png` });
    await reader.setViewportSize({ width: 794, height: 1123 }); await reader.emulateMedia({ media: 'print' });
    assert.equal(await reader.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} print overflow`);
    await reader.pdf({ path: `${output}/${name}.pdf`, preferCSSPageSize: true, printBackground: true });
    const expected = await reader.locator('body').evaluate(body => [...body.querySelectorAll('h1,h2,h3,h4,p,li,pre,a')].filter(node => !node.closest('nav')).map(node => node.textContent).filter(Boolean));
    writeFileSync(`${output}/${name}-expected.json`, JSON.stringify(expected));
    assert.deepEqual(network, []); await offline.close();
    reports.push({ name, runId: id, html: file, pdf: `${output}/${name}.pdf`, textSegments: expected.length, offlineNetworkRequests: network.length });
  }
  cases.push('actual UI downloads retain original demand, current related judgment, exact quotes, path risks and fixed commits');
  cases.push('three downloaded HTML files open offline with no HTTP requests, desktop/mobile/print overflow absent, PDF generated');

  // Hostile/long-content adversarial input never enters the actual saved research.
  const run = structuredClone(runs.find(run => run.id === self));
  const longUrl = `https://example.com/${'VeryLongURL'.repeat(70)}`;
  run.question = `长中文与代码回归 ${'中'.repeat(300)} ${longUrl} <script>globalThis.injected=true</script>`;
  run.status = 'failed'; run.error = '注入夹具失败状态';
  run.snapshot.sources.push({ id: 'hostile', projectId: run.snapshot.projects[0].id, field: 'code', url: 'javascript:alert(1)', observedAt: '2026-10-23', content: 'END_HOSTILE ' + 'code_without_spaces_'.repeat(100), path: '<img src=x onerror=alert(1)>', sha: null, commitSha: null, notice: '未知固定提交；仅测试夹具' });
  const path = run.snapshot.evaluations.at(-1).paths[0];
  path.coverage[0].evidence.push({ sourceId: 'hostile', quote: run.snapshot.sources.at(-1).content });
  path.coverage[0].status = 'unknown';
  const fixtureHtml = renderDemandBrief({ run, group: groupDemandRuns([run])[0], notes: [], notesSupported: true, experiments: [], archiveWarnings: ['test archive missing'], exportedAt: new Date().toISOString(), applicationOrigin: base });
  writeFileSync(`${output}/adversarial.html`, fixtureHtml);
  const isolated = await browser.newContext({ offline: true }); const fixture = await isolated.newPage(); track(fixture);
  await fixture.goto(pathToFileURL(resolve(`${output}/adversarial.html`)).href);
  assert.equal(await fixture.evaluate(() => globalThis.injected), undefined);
  assert.equal(await fixture.locator('script,img,iframe,link').count(), 0);
  assert.equal(await fixture.locator('a[href^="javascript:"]').count(), 0);
  assert.ok((await fixture.locator('body').innerText()).includes(run.question));
  for (const width of [1440, 390, 794]) { await fixture.setViewportSize({ width, height: 1000 }); assert.equal(await fixture.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `adversarial overflow ${width}`); }
  await fixture.emulateMedia({ media: 'print' }); await fixture.pdf({ path: `${output}/adversarial.pdf`, preferCSSPageSize: true });
  writeFileSync(`${output}/adversarial-expected.json`, JSON.stringify(await fixture.locator('body').evaluate(body => [...body.querySelectorAll('h1,h2,h3,h4,p,li,pre,a')].filter(node => !node.closest('nav')).map(node => node.textContent).filter(Boolean))));
  await isolated.close(); reports.push({ name: 'adversarial', fixture: true });
  cases.push('untrusted HTML is literal text; long Chinese/code/URL wrap; unsafe link is omitted; failed study is not recommended');
  for (const endpoint of ['research-notes', 'experiments', 'demands']) {
    const isolated = await browser.newContext();
    await isolated.route(`${base}/api/v1/${endpoint}`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'fixture outage' } }) }));
    const fixture = await isolated.newPage(); track(fixture); await fixture.goto(`${base}/research?run=${parent}`);
    await fixture.getByText(endpoint === 'research-notes' ? /判断读取失败，暂不能导出完整简报/ : endpoint === 'experiments' ? /实测读取失败，暂不能导出完整简报/ : /研究记录尚未成功读取/).waitFor();
    assert.equal(await fixture.getByRole('button', { name: '导出离线交接简报', exact: true }).isDisabled(), true);
    await isolated.close();
  }
  cases.push('notes/archive/history read outages block incomplete export');
  assert.deepEqual(await get('demands'), history);
  assert.deepEqual(await Promise.all(history.map(run => get(`demands/${run.id}`))), runs);
  assert.deepEqual(await get('research-notes'), notes);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  writeFileSync(`${output}/verification.json`, JSON.stringify({ observedAt: new Date().toISOString(), reports, cases, writes, errors, savedResearchAndNotesUnchanged: true, limitation: 'Assistant self-use; Edge/A4 only; PDF text/links checked separately; no independent user benefit evidence.' }, null, 2));
  console.log(JSON.stringify({ output, reports, cases, writes, errors }));
} finally { await online.close(); await browser.close(); }
