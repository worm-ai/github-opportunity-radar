// Execute the unchanged, pinned upstream CLI against synthetic CSVs and a local read-only API fixture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(root, '.data/experiments/actual-ecommerce-noter');
const provenance = JSON.parse(readFileSync(resolve(directory, 'source.json'), 'utf8'));
const runtime = JSON.parse(readFileSync(resolve(directory, 'python/runtime.json'), 'utf8'));
const source = resolve(directory, 'source/actual-ecommerce-noter');
const sourceBytes = readFileSync(source);
assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), provenance.sources.find((item) => item.path === 'actual-ecommerce-noter').sha256);
const fixtureRoot = resolve(directory, 'fixtures'); mkdirSync(fixtureRoot, { recursive:true });
const order = (id, amount, product) => ({ 'Order ID':id, 'Order Date':'2026-10-01', 'Total Amount':amount.toFixed(2), 'Product Name':product, 'Currency':'GBP', 'Shipping Address':'', 'Payment Method Type':'Credit Card' });
const transaction = (id, amount, options={}) => ({ id, amount, date:'2026-10-02', payee_name:'Amazon Marketplace', imported_payee:'Amazon Marketplace', account:'fixture-checking', notes:'', ...options });
const refund = (id, amount) => ({ 'Order ID':id, 'Refund Date':'2026-10-03', 'Refund Amount':amount.toFixed(2), 'Currency':'GBP', 'Product Name':'' });
const ambiguousOrders = [order('SYN-A',30,'Synthetic item A'),order('SYN-B',30,'Synthetic item B')];
const scenarios = [
  { id:'single-order', question:'Can one exact purchase be matched?', orders:[order('SYN-SINGLE',50,'Synthetic desk lamp')], transactions:[transaction('TX-SINGLE',-5000)] },
  { id:'multi-item', question:'Does an exact multi-item order produce a structural split preview?', orders:[order('SYN-MULTI',20,'Synthetic book'),order('SYN-MULTI',30,'Synthetic cable')], transactions:[transaction('TX-MULTI',-5000)] },
  { id:'consolidated', question:'Can two separate orders be matched to one consolidated charge?', orders:[order('SYN-C1',20,'Synthetic book'),order('SYN-C2',30,'Synthetic cable')], transactions:[transaction('TX-CONSOLIDATED',-5000)] },
  { id:'shipment-split', question:'Can one order be mapped to two shipment charges without gift-card metadata?', orders:[order('SYN-SHIP',20,'Synthetic book'),order('SYN-SHIP',30,'Synthetic cable')], transactions:[transaction('TX-SHIP-1',-2000),transaction('TX-SHIP-2',-3000,{date:'2026-10-03'})] },
  { id:'ambiguous-forward', question:'Are equal-date, equal-amount candidate orders treated as ambiguous?', orders:ambiguousOrders, transactions:[transaction('TX-AMBIGUOUS',-3000)] },
  { id:'ambiguous-reverse', question:'Does reversing otherwise equivalent CSV rows change the selected order?', orders:[...ambiguousOrders].reverse(), transactions:[transaction('TX-AMBIGUOUS',-3000)] },
  { id:'unique-refund', question:'Can a refund be linked to the one item with the matching amount?', orders:[order('SYN-REFUND',20,'Synthetic book'),order('SYN-REFUND',30,'Synthetic cable')], refunds:[refund('SYN-REFUND',20)], transactions:[transaction('TX-REFUND',2000,{date:'2026-10-03'})] },
  { id:'ambiguous-refund', question:'Does an equal-priced item refund retain uncertainty?', orders:[order('SYN-RAMB',20,'Synthetic item A'),order('SYN-RAMB',20,'Synthetic item B')], refunds:[refund('SYN-RAMB',20)], transactions:[transaction('TX-REFUND-AMB',2000,{date:'2026-10-03'})] },
  { id:'non-amazon-control', question:'Does an unrelated payee stay outside Amazon matching?', orders:[order('SYN-CONTROL',50,'Synthetic lamp')], transactions:[transaction('TX-CONTROL',-5000,{payee_name:'Synthetic grocery',imported_payee:'Synthetic grocery'})] },
];
function csv(rows) {
  const fields=Object.keys(rows[0]); const quote=(value)=>`"${String(value??'').replaceAll('"','""')}"`;
  return `${fields.map(quote).join(',')}\n${rows.map((row)=>fields.map((field)=>quote(row[field])).join(',')).join('\n')}\n`;
}
writeFileSync(resolve(directory,'inputs.json'), JSON.stringify({synthetic:true,currency:'GBP',amountToleranceCents:0,daysTolerance:3,scenarios},null,2));
const results=[];
for (const scenario of scenarios) {
  const caseRoot=resolve(fixtureRoot,scenario.id);mkdirSync(caseRoot,{recursive:true});
  const files=[resolve(caseRoot,'order_history.csv')];writeFileSync(files[0],csv(scenario.orders));
  if(scenario.refunds){files.push(resolve(caseRoot,'refund_details.csv'));writeFileSync(files[1],csv(scenario.refunds));}
  const requests=[];
  const api=createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');requests.push({method:req.method,path:url.pathname,query:url.search});
    if(req.method!=='GET'){res.writeHead(405);res.end('Read-only fixture');return;}
    if(req.headers['x-api-key']!=='fixture-only'){res.writeHead(401);res.end();return;}
    const data=url.pathname==='/v1/budgets/fixture-budget/accounts'?[{id:'fixture-checking',name:'Synthetic checking'}]:url.pathname==='/v1/budgets/fixture-budget/accounts/fixture-checking/transactions'?scenario.transactions:null;
    if(data===null){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data}));
  });
  await new Promise((done)=>api.listen(0,'127.0.0.1',done));
  const args=[source,'--dry-run','json','--format','amazon','--amount-tolerance','0','--days','3','--actual-http-api',`http://127.0.0.1:${api.address().port}`,'--actual-http-api-key','fixture-only','--actual-syncid','fixture-budget',...files];
  const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:caseRoot,TMP:caseRoot,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'};
  let output;
  try {
    output=await new Promise((done,reject)=>{
      const child=spawn(resolve(directory,'python/python.exe'),args,{cwd:caseRoot,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error(`Timed out: ${scenario.id}`));},15_000);
      child.stdout.on('data',(data)=>{stdout+=data;});child.stderr.on('data',(data)=>{stderr+=data;});
      child.once('error',(error)=>{clearTimeout(timer);reject(error);});child.once('close',(exitCode)=>{clearTimeout(timer);done({exitCode,stdout,stderr});});
    });
  } finally { await new Promise((done)=>api.close(done)); }
  assert.equal(output.exitCode,0,`${scenario.id}: ${output.stderr}`);
  assert.equal(output.stderr,'');assert.ok(requests.length>=2);assert.ok(requests.every((r)=>r.method==='GET'));
  assert.match(output.stdout,/Mode: DRY-RUN/);
  const matches=[...output.stdout.matchAll(/^\{\r?\n[\s\S]*?^\}/gm)].map(([json])=>JSON.parse(json));
  const summary=Number(output.stdout.match(/Total matches found:\s*(\d+)/)?.[1]);assert.equal(matches.length,summary);
  const previews=[...output.stdout.matchAll(/SPLIT: Would create (\d+) sub-transactions/g)].map((match)=>Number(match[1]));
  const result={id:scenario.id,question:scenario.question,matches,splitPreviewCounts:previews,requests,...output};
  results.push(result);console.log(JSON.stringify({id:scenario.id,matches:matches.map((match)=>({transactionId:match.transaction_id,orderId:match.order_id,products:match.products})),splitPreviewCounts:previews,apiWrites:0}));
}
const byId=Object.fromEntries(results.map((item)=>[item.id,item]));
// Positive and negative controls validate that the fixture exercises the real CLI path.
assert.equal(byId['single-order'].matches[0]?.order_id,'SYN-SINGLE');
assert.deepEqual(byId['multi-item'].splitPreviewCounts,[2]);
assert.equal(byId.consolidated.matches[0]?.order_id,'SYN-C1;SYN-C2');
assert.equal(byId['unique-refund'].matches[0]?.products[0][0],'Synthetic book');
assert.equal(byId['non-amazon-control'].matches.length,0);
// The following observations describe boundaries, not claims of market demand.
const observations={
  exactPurchaseMatched:byId['single-order'].matches.length===1,
  exactMultiItemSplitPreview:byId['multi-item'].splitPreviewCounts[0]===2,
  twoOrdersConsolidated:byId.consolidated.matches.length===1,
  shipmentChargesMatched:byId['shipment-split'].matches.length,
  shipmentChargesInInput:scenarios.find((item)=>item.id==='shipment-split').transactions.length,
  ambiguousFirstOrder:byId['ambiguous-forward'].matches[0]?.order_id??null,
  ambiguousReversedOrder:byId['ambiguous-reverse'].matches[0]?.order_id??null,
  ambiguousSelectionChangesWithRowOrder:byId['ambiguous-forward'].matches[0]?.order_id!==byId['ambiguous-reverse'].matches[0]?.order_id,
  uniqueItemRefundResolved:byId['unique-refund'].matches[0]?.products[0][0]==='Synthetic book',
  ambiguousRefundRetainsCandidates:byId['ambiguous-refund'].matches[0]?.products[0][0].startsWith('Candidates: ')??false,
  unrelatedPayeeExcluded:byId['non-amazon-control'].matches.length===0,
};
const result={executedAt:new Date().toISOString(),repo:provenance.repo,commit:provenance.commit,sourceSha256:provenance.sources.find((item)=>item.path==='actual-ecommerce-noter').sha256,environment:{platform:process.platform,arch:process.arch,node:process.version,python:runtime.python.version,requests:runtime.wheels.find((item)=>item.name==='requests').version},syntheticOnly:true,upstreamCodeModified:false,actualBudgetServerExecuted:false,apiWrites:0,paidModelCalls:0,observations,cases:results};
writeFileSync(resolve(directory,'result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({completed:results.length,observations,apiWrites:0,paidModelCalls:0}));
