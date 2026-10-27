import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
// Assistant self-test: the POST is intentionally intercepted as a TLS/preflight failure.
// The fallback then must use only the read-only local cache endpoint.
const base=process.env.RADAR_BROWSER_URL ?? 'http://127.0.0.1:4358';
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}); const page=await context.newPage(); const errors=[]; const writes=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('request', req=>{if(!['GET','HEAD','OPTIONS'].includes(req.method())) writes.push(`${req.method()} ${req.url()}`);});
await page.route('**/api/v1/demands', async route=>{ if(route.request().method()==='POST') await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'github_preflight_failed',message:'GitHub 连接失败（自测故障注入）'}})}); else await route.continue(); });
await page.goto(`${base}/research`); await page.getByLabel('你的需求').fill('我想做一个本地优先的多智能体社会模拟原型，支持共享事件和重启恢复。');
await page.getByRole('button',{name:'先查本地缓存'}).click();
let card=page.locator('[aria-label="本地缓存候选"]'); await card.waitFor(); await card.getByText('local_cache',{exact:false}).waitFor();
assert.ok(await card.locator('li').count()>0); assert.ok(await card.locator('blockquote').count()>0); assert.deepEqual(writes,[]);
await page.reload(); await page.getByLabel('你的需求').fill('我想做一个本地优先的多智能体社会模拟原型，支持共享事件和重启恢复。');
const submit=page.getByRole('button',{name:'开始研究'}); await submit.click();
await page.getByRole('button',{name:'查看本地缓存线索'}).click();
card=page.locator('[aria-label="本地缓存候选"]'); await card.waitFor(); await card.getByText('local_cache',{exact:false}).waitFor();
assert.ok(await card.locator('li').count()>0); assert.ok(await card.locator('blockquote').count()>0);
await page.setViewportSize({width:390,height:844}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
assert.deepEqual(errors,[]); assert.equal(writes.length, 1); assert.match(writes[0], /POST .*\/api\/v1\/demands/);
console.log(JSON.stringify({base,directLookupReadOnly:true,preflightRecovery:true,mode:'local_cache',candidates:await card.locator('li').count(),mobileOverflow:false,errors,writes}));
await context.close(); await browser.close();

