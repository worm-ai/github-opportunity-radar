import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { reportText } from '../apps/server/dist/reports.js';
const base = 'http://127.0.0.1:4317', directory = '.data/dogfood';
mkdirSync(directory, { recursive: true });
const startedAt = new Date().toISOString();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [], writes = [], saved = [], observations = [];
const failures = [], reused = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const request = route.request();
  if (['POST','PUT','PATCH','DELETE'].includes(request.method())) {
    assert.equal(new URL(request.url()).origin, base);
    assert.equal(request.method(), 'POST');
    assert.equal(new URL(request.url()).pathname, '/api/v1/research-notes');
    assert.equal(request.postDataJSON().author, 'assistant');
    writes.push(request.postDataJSON());
  }
  return route.continue();
});
const cases = [
  {
    projects: ['1322012299','1318187016'], issue: 191, opportunity: '6533e09cc0a26788522fb67282bca3fa',
    title: '助手自用决定：停止新建 DOCX 双组件批注适配器', decision: 'stop',
    question: '我以机会捕手维护者身份决定未来七天的投入：一人维护、优先成熟替代，DOCX 批注保全是否还值得新建 AnyDoc 与 GenOffice 双组件适配器？若单工具已覆盖当前验收样本，则停止新建；不把技术样本当用户需求。',
    conclusion: '停止为当前批注保全假设新建双组件适配器。公开 #191 提供一项批注丢失报告；它不证明必须组合两套工具。产品内 pandoc-docx-comments-cli-20261022 实测显示 Pandoc 3.12.1 加 --track-changes=all 在合成正样本与上游回归样本保留批注范围、作者和正文，负样本不变。genoffice-docx-comments-20261022 也提供单工具结构化读取路径。第一性原理是保住所需审阅语义，现有替代已足以否定现在就开发新适配器的必要性。对抗审查：固定样本不能保证复杂真实 DOCX 保真，也未证明用户认为 HTML span 可用；因此只停止当前实现投入，不断言所有批注需求已解决。引用区保存公开问题原文，实验编号是产品内后续技术依据，不能冒称属于该引文。',
    nextAction: '本周不给双组件包装器分配开发时间。再次遇到实际含批注文档时，先以 Pandoc --track-changes=all 和 GenOffice 结构化读取作基线；只有出现可复现的遗漏、错误锚点或不适用输出，再以同一文件对照决定是否重启。记录为助手自用，无独立用户认可、付费或前后耗时对照。',
  },
  {
    projects: ['639835356','1401476500'], issue: 2218, opportunity: '1e7316cf5eeace42eacfa1ef018735a2', revise: '1f2b798b-b213-4611-9e9d-fc540681bb69',
    title: '助手自用决定：暂缓独立报告交付器，优先原库错误传播', decision: 'watch',
    question: '我以机会捕手维护者身份决定未来七天的投入：在一人维护和复用现有工具约束下，报告失败检查是否足以支持独立交付器，还是只应处理原库错误传播？以完整公开问题、已有函数级实测和自身工作是否发生该障碍作判断。',
    conclusion: '暂缓独立报告交付器，不因有非空门槛就投入产品包装。完整 #2218 包含拒绝连接复现和环境，不能沿用旧模型的缺少上下文断言。产品内 gpt-researcher-report-failure-20261022 在固定函数与替身依赖下观察到空返回仍发出 report_written，支持原库错误传播问题；非空拒答也能通过简单门槛，说明非空不足以证明有效交付。我这次实际工作是比较现有证据并决定停止或等待，没有发生 GPT Researcher 空交付，因此本次自用不支持对它另建产品。对抗审查：未安装完整依赖或连接真实提供商，不能把函数级实测说成完整库复现；也不能由自身未遇到推断其他人没有重复负担。',
    nextAction: '未来七天不建设 HTML 交付包装器，也不为同一资料重复运行模型。若后续自身研究确实采用 GPT Researcher 并遇到失败，先核对上游修复、完整库错误状态和现有导出；只有现成办法仍留下可记录的重复交付工作时，再重启适配器。保存作者为 assistant，保留旧判断历史；本次无独立用户验证或节时基线。',
  },
];
try {
  const notesResponse = await page.request.get(base + '/api/v1/research-notes');
  assert.equal(notesResponse.status(), 200);
  const existingNotes = await notesResponse.json();
  const selectedCases = cases.filter(item => !process.env.RADAR_DOGFOOD_ISSUE || String(item.issue) === process.env.RADAR_DOGFOOD_ISSUE);
  assert.ok(selectedCases.length, 'Select a known self-use case');
  for (const item of selectedCases) {
    try {
    const existing = existingNotes.filter(note => note.title === item.title && note.author === 'assistant');
    assert.ok(existing.length <= 1, 'Duplicate saved titles require inspection');
    if (existing.length) {
      const note = existing[0];
      assert.equal(note.conclusion, item.conclusion);
      assert.equal(note.decision, item.decision);
      assert.equal(note.supersedesId, item.revise ?? null);
      await page.goto(base + '/opportunities?project=' + item.projects.join('&project='));
      await page.locator('[data-note-id="' + note.id + '"]').waitFor();
      await page.reload();
      await page.locator('[data-note-id="' + note.id + '"]').waitFor();
      await page.goto(base + '/opportunities/' + item.opportunity);
      await page.getByText(item.title, { exact: true }).waitFor();
      const report = await page.request.get(base + '/api/v1/research-notes/' + note.id + '/report.md');
      assert.equal(report.status(), 200);
      const text = await report.text();
      assert.ok(text.includes(reportText(item.conclusion)));
      for (const evidence of note.evidence) assert.ok(text.includes(evidence.quote.split(/\r?\n/).map(line => '    ' + line).join('\n')));
      assert.ok(text.includes('代理研究'));
      if (item.revise) {
        const previous = await page.request.get(base + '/api/v1/research-notes/' + item.revise);
        assert.equal(previous.status(), 200);
        assert.equal((await previous.json()).supersededBy, note.id);
      }
      await page.screenshot({ path: directory + '/saved-' + item.issue + '.png', fullPage: true });
      writeFileSync(directory + '/decision-' + item.issue + '.md', text);
      reused.push({ id: note.id, issue: item.issue });
      continue;
    }
    if (item.revise) {
      const original = existingNotes.find(note => note.id === item.revise);
      assert.ok(original && !original.supersededBy, 'Original decision is missing or already revised');
    }
    await page.goto(base + '/opportunities/' + item.opportunity);
    await page.locator('.related-experiments').waitFor();
    await page.waitForFunction(() => { const el = document.querySelector('.related-experiments'); return el && !el.textContent.includes('正在读取技术实测'); });
    await page.waitForFunction(() => { const el = document.querySelector('.related-research'); return el && !el.textContent.includes('正在读取相关研究判断'); });
    writeFileSync(directory + '/loaded-' + item.opportunity + '.txt', await page.locator('main').innerText());
    observations.push({ opportunity:item.opportunity, relatedExperiments:await page.locator('.related-experiments').innerText(), relatedResearch:await page.locator('.related-research').innerText() });
    const params = new URLSearchParams();
    item.projects.forEach(id => params.append('project', id)); params.set('issue', String(item.issue));
    if(item.revise) params.set('note',item.revise);
    await page.goto(base + '/opportunities?' + params);
    const editor = page.locator('.research-note-editor');
    if(item.revise) await editor.locator('form').waitFor(); else await editor.locator(':scope > summary').click();
    const form = page.getByRole('form', { name:'保存研究判断',exact:true });
    for (const [label,value] of [['判断标题',item.title],['记录的研究问题',item.question],['判断结论',item.conclusion],['判断下一步',item.nextAction]]) await form.getByLabel(label,{exact:true}).fill(value);
    await form.getByLabel('研究决定',{exact:true}).selectOption(item.decision);
    await form.getByLabel('判断记录者',{exact:true}).selectOption('assistant');
    while(await form.locator('.research-note-source').count() > 1) await form.getByRole('button',{name:'移除此依据',exact:true}).last().click();
    const source = form.getByLabel('判断来源 1',{exact:true});
    const option = await source.locator('option').evaluateAll((options, issue) => options.find(option => option.textContent.includes('#' + issue + ' · 问题原文'))?.value, item.issue);
    assert.ok(option, 'The public Issue must be available as a real saved source');
    await source.selectOption(option);
    const sourceField = form.locator('.research-note-source').first();
    await sourceField.getByText('查看已采集原文',{exact:true}).click();
    const original = await sourceField.locator('pre').innerText();
    const quote = original.slice(0,Math.min(1500,original.length)).trim();
    await form.getByLabel('判断引用 1',{exact:true}).fill(quote);
    const button = form.getByRole('button',{name:'保存研究判断',exact:true});
    assert.equal(await button.isEnabled(),true);
    const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/research-notes');
    await button.click(); const response = await responsePromise;
    assert.equal(response.status(),201,await response.text()); const note = await response.json();
    assert.equal(note.author,'assistant'); assert.equal(note.supersedesId,item.revise ?? null); saved.push(note);
    await form.getByRole('status').waitFor(); await page.reload();
    await page.locator('[data-note-id="' + note.id + '"]').waitFor();
    await page.goto(base + '/opportunities/' + item.opportunity);
    await page.getByText(item.title,{exact:true}).waitFor();
    await page.screenshot({path:directory + '/saved-' + item.issue + '.png',fullPage:true});
    const report = await page.request.get(base + '/api/v1/research-notes/' + note.id + '/report.md');
    assert.equal(report.status(),200); const text = await report.text();
    assert.ok(text.includes(reportText(item.conclusion))); assert.ok(text.includes(quote.split(/\r?\n/).map(line => '    ' + line).join('\n'))); assert.ok(text.includes('代理研究'));
    writeFileSync(directory + '/decision-' + item.issue + '.md',text);
    if (item.revise) {
      const previous = await page.request.get(base + '/api/v1/research-notes/' + item.revise);
      assert.equal(previous.status(), 200);
      assert.equal((await previous.json()).supersededBy, note.id);
    }
    } catch (error) {
      failures.push({ issue: item.issue, message: error.message });
      writeFileSync(directory + '/failed-' + item.issue + '.txt', await page.locator('main').innerText().catch(() => 'Page unavailable'));
      await page.screenshot({ path: directory + '/failed-' + item.issue + '.png', fullPage: true }).catch(() => {});
    }
  }
  assert.deepEqual(errors,[]); assert.deepEqual(failures,[]); assert.equal(saved.length + reused.length,selectedCases.length);
} finally {
  const result = JSON.stringify({startedAt,finishedAt:new Date().toISOString(),authorship:'assistant',scope:'agent dogfooding; familiar with evidence; no independent human or before/after timing validation',saved,reused,observations,errors,writes,failures},null,2);
  writeFileSync(directory + '/session-result.json', result);
  writeFileSync(directory + '/session-result-' + startedAt.replaceAll(':','-') + '.json', result);
  await browser.close();
}
console.log(JSON.stringify({saved:saved.map(n=>({id:n.id,title:n.title,decision:n.decision,supersedesId:n.supersedesId})),errors,writes:writes.length}));
