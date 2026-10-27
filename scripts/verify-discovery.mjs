// Read-only workbench regression. Paging/iii integration is verify-discovery-rotation.mjs.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.RADAR_BROWSER_URL || 'http://127.0.0.1:4317';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [], writes = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route(`${base}/api/**`, async (route) => {
  const request = route.request();
  if (!['GET', 'HEAD'].includes(request.method())) {
    writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.abort();
  }
  return route.continue();
});
const get = async (path) => {
  const response = await page.request.get(`${base}/api/v1${path}`);
  assert.ok(response.ok(), `${path}: ${response.status()}`);
  return response.json();
};
mkdirSync('.data/browser', { recursive: true });
try {
  const [brief, projects, analyses] = await Promise.all([get('/discovery/brief'), get('/projects'), get('/analysis/runs')]);
  assert.ok(brief.items.length >= 2, 'Collect at least two projects before the workbench regression');
  const projectById = new Map(projects.map((project) => [project.id, project]));
  for (const item of brief.items) {
    const project = projectById.get(item.id);
    assert.ok(project, `Missing project ${item.id}`);
    for (const clue of item.clues) {
      const source = clue.source === 'description' ? project.description : project.readmeExcerpt;
      assert.ok(source?.includes(clue.quote), `${item.fullName}/${clue.id}: quote must occur verbatim in the collected source`);
      assert.ok(clue.url.startsWith(`${project.url}`), 'Clue must link to its own repository');
    }
  }
  await page.goto(base);
  const workbench = page.getByRole('region', { name: '发现工作台' });
  const direction = workbench.getByRole('combobox', { name: '能力方向' });
  await direction.waitFor();
  const checkedDirections = [];
  for (const id of ['maps', 'office', 'video', 'data-movement']) {
    const category = brief.categories.find((item) => item.id === id);
    if (!category) continue;
    await direction.selectOption(id);
    const cards = workbench.locator('.discovery-card');
    await cards.first().waitFor();
    const ids = await cards.evaluateAll((elements) => elements.map((element) => element.dataset.projectId));
    assert.ok(ids.every((projectId) => brief.items.find((item) => item.id === projectId)?.clues.some((clue) => clue.id === id)));
    await cards.first().locator('.discovery-evidence > summary').click();
    const item = brief.items.find((item) => item.id === ids[0]);
    const evidence = await cards.first().locator('.discovery-evidence').innerText();
    for (const clue of item.clues) assert.ok(evidence.includes(clue.quote));
    checkedDirections.push(category.label);
  }
  assert.ok(checkedDirections.length, 'No representative capability directions are available');
  await direction.selectOption('all');
  await page.screenshot({ path: '.data/browser/discovery-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await workbench.locator('.discovery-card').first().locator('.discovery-evidence > summary').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const cards = workbench.locator('.discovery-card');
  const chosen = [];
  for (let index = 0; index < 2; index++) {
    const card = cards.nth(index);
    chosen.push(await card.getAttribute('data-project-id'));
    await card.getByRole('checkbox').check();
  }
  await page.screenshot({ path: '.data/browser/discovery-mobile.png', fullPage: true });
  await workbench.getByRole('link', { name: '填写组合研究问题' }).click();
  await page.waitForURL(/\/opportunities\?/);
  await page.waitForFunction((ids) => {
    const values = [...document.querySelectorAll('.research-focus-projects select')].map((element) => element.value);
    return ids.every((id) => values.includes(id));
  }, chosen);
  assert.equal(await page.getByRole('textbox', { name: '待证伪的研究问题' }).inputValue(), '');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual((await get('/analysis/runs')).map((run) => run.id), analyses.map((run) => run.id));
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  const result = { browser: 'Edge', summary: brief.summary, checkedDirections, sourceQuotes: 'exact', selectionHandoff: 'passed', mobileOverflow: false, writes, errors };
  writeFileSync('.data/browser/discovery-verification.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
