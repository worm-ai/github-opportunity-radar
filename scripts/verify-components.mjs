// Real iii routing + isolated GitHub HTTP fixture + temporary SQLite. Never calls a paid model.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RadarStore } from "../packages/storage/dist/index.js";
import { GitHubClient } from "../packages/sensor-github/dist/index.js";
import { createRuntimeAdapter } from "../packages/runtime/dist/index.js";
import { registerComponentRoutes } from "../apps/server/dist/components.js";
import { discoveryProfile } from "../apps/server/dist/discovery.js";

const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const Fastify = require("fastify");
const directory = mkdtempSync(join(tmpdir(), "radar-components-"));
const store = new RadarStore(join(directory, "test.sqlite"));
let requests = 0, operation = null;
const fixture = { id: 77, full_name: "fixture/local-interface", html_url: "https://github.com/fixture/local-interface", description: "A local interface for collecting and previewing file inputs.", language: "Python", license: { spdx_id: "MIT" }, stargazers_count: 10, forks_count: 0, open_issues_count: 0, created_at: "2020-01-01T00:00:00Z", pushed_at: "2026-10-20T00:00:00Z", archived: false, fork: false };
const upstream = createServer((request, response) => {
  requests += 1;
  const url = new URL(request.url, "http://fixture");
  response.setHeader("content-type", "application/json");
  if (url.pathname === "/search/repositories") return response.end(JSON.stringify({ items: [fixture], total_count: 1, incomplete_results: false }));
  if (url.pathname === "/repos/fixture/local-interface") return response.end(JSON.stringify(fixture));
  if (url.pathname.endsWith("/readme")) return response.end(JSON.stringify({ encoding: "base64", content: Buffer.from("The interface accepts local file inputs and previews tabular results.").toString("base64") }));
  if (url.pathname.endsWith("/issues") || url.pathname.endsWith("/releases")) return response.end("[]");
  response.statusCode = 404; response.end("{}");
});
const runtime = createRuntimeAdapter(process.env.III_URL || "ws://127.0.0.1:49134", `radar-components-${process.pid}`);
const app = Fastify();
let browser;
try {
  await new Promise((done) => upstream.listen(0, "127.0.0.1", done));
  await runtime.ready();
  app.register(async (api) => registerComponentRoutes(api, {
    store, runtime, client: () => new GitHubClient({ apiBase: `http://127.0.0.1:${upstream.address().port}` }),
    busy: () => operation !== null, collection: (value) => { operation = value; },
  }), { prefix: "/api/v1" });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `${app.listeningOrigin}/api/v1`;
  const post = (path, payload) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const preview = await (await post("/components/search", { query: "local file interface" })).json();
  assert.equal(preview.items[0].collected, false);
  assert.equal(requests, 1);
  assert.equal(store.getProjects().length, 0);
  const imported = await (await post("/components/import", { repository: "https://github.com/fixture/local-interface" })).json();
  assert.equal(imported.id, "77");
  assert.equal(requests, 5);
  assert.ok(store.getProject("77").readmeExcerpt.includes("local file inputs"));
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM signals").get().n, 1);
  assert.equal(store.listAnalysisRuns().length, 0);
  assert.equal(store.getOpportunities().length, 0);
  const beforeInvalid = requests;
  assert.equal((await post("/components/import", { repository: "https://external.invalid/a/b" })).status, 400);
  assert.equal(requests, beforeInvalid);

  let browserResult = "not_requested";
  if (process.env.RADAR_TEST_BROWSER === "1") {
    const { chromium } = await import("@playwright/test");
    const production = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4317";
    const before = await (await fetch(`${production}/api/v1/projects`)).json();
    const origin = before.find((p) => p.fullName === "genspark-ai/genoffice") ?? before.find((p) => p.issues?.length);
    assert.ok(origin, "A production project with an Issue is required for read-only origin binding");
    const issue = origin.issues.find((i) => i.number === 2097) ?? origin.issues[0];
    const errors = [], writes = [];
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.on("pageerror", (error) => errors.push(error.message));
    const publicFixture = () => { const p = store.getProject("77"); return { ...p, discovery: discoveryProfile(p) }; };
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() === "POST") {
        writes.push(path);
        if (!path.startsWith("/api/v1/components/")) return route.abort();
        const proxy = await page.request.post(`${app.listeningOrigin}${path}`, { data: request.postDataJSON() });
        return route.fulfill({ response: proxy });
      }
      if (path === "/api/v1/projects") {
        const response = await route.fetch();
        return route.fulfill({ response, json: [...await response.json(), publicFixture()] });
      }
      if (path === "/api/v1/projects/77") return route.fulfill({ json: publicFixture() });
      return route.continue();
    });
    await page.goto(`${production}/opportunities?project=${origin.id}&issue=${issue.number}`);
    const form = page.getByRole("region", { name: "定向研究", exact: true });
    await form.locator(".component-finder > summary").click();
    const finder = page.getByRole("region", { name: "寻找互补组件" });
    await finder.getByLabel("GitHub 组件搜索", { exact: true }).fill("local file interface");
    await finder.getByRole("button", { name: "搜索组件", exact: true }).click();
    await finder.getByRole("link", { name: "fixture/local-interface ↗", exact: true }).waitFor();
    await finder.locator(".component-result").getByRole("button", { name: "刷新并选择", exact: true }).click();
    await finder.getByRole("status").waitFor();
    assert.equal(await form.getByLabel("研究组件 2", { exact: true }).inputValue(), "77");
    assert.equal(await form.getByLabel("研究问题起点", { exact: true }).inputValue(), `${origin.id}:${issue.number}`);
    assert.equal(await form.locator(".research-material").count(), 2);
    assert.equal(await form.getByLabel("待证伪的研究问题", { exact: true }).inputValue(), "");
    assert.equal(store.listAnalysisRuns().length, 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    mkdirSync(".data/browser", { recursive: true });
    await page.screenshot({ path: ".data/browser/component-finder-mobile.png", fullPage: true });
    const after = await (await fetch(`${production}/api/v1/projects`)).json();
    assert.deepEqual(after.map((p) => p.id), before.map((p) => p.id));
    assert.ok(writes.length >= 2 && writes.every((path) => path.startsWith("/api/v1/components/")));
    assert.deepEqual(errors, []);
    browserResult = { source: "temporary_fixture_only", originPreserved: true, selectedImportedComponent: true, mobileOverflow: false, productionWrites: 0, modelCalls: 0, errors };
  }
  const result = { realEngine: runtime.mode === "iii", fixtureHttp: "passed", searchDoesNotPersist: "passed", importW2A: "passed", invalidInputNoRequest: "passed", modelCalls: 0, browser: browserResult };
  if (process.env.RADAR_TEST_BROWSER === "1") writeFileSync(".data/browser/component-finder-verification.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await app.close();
  await runtime.close();
  await new Promise((done) => upstream.close(done));
  store.close();
  const target = resolve(directory), parent = resolve(tmpdir());
  if (!target.startsWith(`${parent}\\radar-components-`) && !target.startsWith(`${parent}/radar-components-`)) throw new Error("Unexpected temporary test directory");
  rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
