import { mkdirSync, writeFileSync } from 'node:fs';
import { researchSources } from '../packages/contracts/dist/research.js';
const base = 'http://127.0.0.1:4317';
mkdirSync('.data/dogfood', { recursive: true });
for (const route of ['integrations', 'opportunities', 'experiments', 'research-notes', 'projects']) {
  const response = await fetch(`${base}/api/v1/${route}`);
  if (!response.ok) throw new Error(`${route}: ${response.status}`);
  const data = await response.json();
  writeFileSync(`.data/dogfood/${route}-before.json`, JSON.stringify(data, null, 2));
  if (route === 'projects') {
    const projects = data.filter(p => ['639835356', '1401476500', '1318187016', '1322012299'].includes(p.id));
    console.log(JSON.stringify({ route, sources: researchSources(projects).map(s => ({ key: s.key, label: s.label, text: s.text.slice(0, s.ref.kind === 'issue' ? 3500 : 500) })) }));
  } else if (route === 'experiments') {
    console.log(JSON.stringify({ route, data: data.records.map(x => ({ id: x.id, title: x.title, projectIds: x.projectIds, summary: x.summary, verdict: x.verdict })) }));
  } else if (route === 'research-notes') {
    console.log(JSON.stringify({ route, data: data.map(x => ({ id: x.id, title: x.title, projectIds: x.projectIds, decision: x.decision, conclusion: x.conclusion, nextAction: x.nextAction, evidence: x.evidence.map(e => ({ quote: e.quote, ref: e.ref })) })) }));
  } else if (route === 'opportunities') {
    console.log(JSON.stringify({ route, data: data.map(x => ({ id: x.id, title: x.title, projectIds: x.projectIds })) }));
  } else console.log(JSON.stringify({ route, analysis: data.analysis, evidence: data.evidence }));
}
