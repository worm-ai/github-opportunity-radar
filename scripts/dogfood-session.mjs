import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { researchSources } from '../packages/contracts/dist/research.js';
const dir = '.data/dogfood';
mkdirSync(dir, { recursive: true });
const opportunities = JSON.parse(readFileSync(`${dir}/opportunities-before.json`));
const experiments = JSON.parse(readFileSync(`${dir}/experiments-before.json`));
const projects = JSON.parse(readFileSync(`${dir}/projects-before.json`));
const notes = JSON.parse(readFileSync(`${dir}/research-notes-before.json`));
const base = 'http://127.0.0.1:4317';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const req = route.request();
  if (['POST','PUT','PATCH','DELETE'].includes(req.method())) {
    writes.push({ method: req.method(), url: req.url() });
    return route.abort('blockedbyclient');
  }
  return route.continue();
});
try {
  for (const opportunity of opportunities) {
    await page.goto(`${base}/opportunities/${opportunity.id}`);
    await page.locator('.related-experiments').waitFor();
    const text = await page.locator('main').innerText();
    writeFileSync(`${dir}/opportunity-${opportunity.id}.txt`, text);
    await page.screenshot({ path: `${dir}/opportunity-${opportunity.id}.png`, fullPage: true });
    const related = experiments.records.filter(e => e.projectIds.some(id => opportunity.projectIds.includes(id)));
    console.log(JSON.stringify({ opportunity: opportunity.title, visiblePage: text.slice(0,7000), experiments: related, notes: notes.filter(n => n.projectIds.some(id => opportunity.projectIds.includes(id))).map(n => ({ id:n.id, title:n.title, conclusion:n.conclusion, nextAction:n.nextAction })) }));
  }
  await page.goto(`${base}/opportunities?project=639835356&project=1401476500&issue=2218`);
  await page.locator('.research-note-editor > summary').click();
  const form = page.getByRole('form', { name: '保存研究判断', exact: true });
  console.log(JSON.stringify({ form: await form.innerText(), sources: researchSources(projects.filter(p => ['639835356','1401476500','1318187016','1322012299'].includes(p.id))).filter(s => (s.ref.kind === 'issue' && [2218,188].includes(s.ref.issueNumber)) || s.ref.kind === 'documentation').map(s => ({ key:s.key,label:s.label,text:s.text.slice(0,4000) })) }));
  await page.screenshot({ path: `${dir}/decision-form-before.png`, fullPage: true });
  writeFileSync(`${dir}/inspection.json`, JSON.stringify({ inspectedAt:new Date().toISOString(), errors,writes }, null,2));
} finally { await browser.close(); }
