// Real iii + HTTP fixtures + temporary SQLite + optional Edge. No production writes or paid model.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RadarStore } from "../packages/storage/dist/index.js";
import { createIssueContextSignal, createRepositorySignal } from "../packages/contracts/dist/index.js";
import { GitHubClient } from "../packages/sensor-github/dist/index.js";
import { createRuntimeAdapter } from "../packages/runtime/dist/index.js";
import { registerIssueContextRoute } from "../apps/server/dist/issue-context.js";
import { discoveryProfile } from "../apps/server/dist/discovery.js";

const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const Fastify = require("fastify"), fastifyStatic = require("@fastify/static");
const directory = mkdtempSync(join(tmpdir(), "radar-issue-context-"));
const store = new RadarStore(join(directory, "test.sqlite"));
const sample = { id: 7, number: 7, title: "Keep native depth in an external editor round trip", bodyExcerpt: "A returning edit must retain the original depth and placement.", url: "https://github.com/fixture/editor/issues/7", state: "open", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", comments: 0, reactions: 0, authorAssociation: "NONE", authorLogin: "reporter" };
for (const [index, name] of ["editor", "image-worker"].entries()) {
  const item = { id: index + 1, fullName: `fixture/${name}`, description: `A local ${name} component.`, url: `https://github.com/fixture/${name}`, language: "Rust", license: "MIT", stars: 1, forks: 0, openIssues: 1, createdAt: sample.createdAt, pushedAt: sample.updatedAt, readmeExcerpt: "A local file interface.", releaseTag: null, releaseUrl: null, raw: { id: index + 1 }, warning: null, issues: index === 0 ? [sample] : [], issuesFetchSucceeded: true };
  store.saveRepository(item, createRepositorySignal({ repositoryId: item.id, ...item }), 0, [], [], sample.updatedAt);
}
let operation = null, commentsFail = false, githubRequests = 0, analysisRequests = 0;
const comment = { id: 99, html_url: `${sample.url}#issuecomment-99`, body: "A bridge already exists; a native-depth pixel comparison is still needed.", created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-20T00:00:00Z", author_association: "CONTRIBUTOR", user: { login: "bridge-bot", type: "Bot" } };
const implementationComment = "Maintainer: an existing implementation already covers this task. See #14, #15 and #16.";
const upstream = createServer((request, response) => {
  githubRequests += 1;
  response.setHeader("content-type", "application/json");
  const url = new URL(request.url, "http://fixture");
  if (url.pathname === "/repos/fixture/editor") return response.end(JSON.stringify({ id: 1, private: false }));
  if (url.pathname === "/repos/fixture/editor/issues/7") return response.end(JSON.stringify({ id: 7, number: 7, title: sample.title, body: `${sample.bodyExcerpt}\nCurrent body with implementation context.`, html_url: sample.url, state: "closed", state_reason: "completed", closed_at: comment.updated_at, created_at: sample.createdAt, updated_at: comment.updated_at, comments: 1, reactions: { total_count: 0 }, author_association: "NONE", user: { login: "reporter" } }));
  if (url.pathname === "/repos/fixture/editor/issues/8") return response.end(JSON.stringify({ id: 8, number: 8, title: "A recurring order item categorization task", body: "Every month I manually review and categorize many merchant orders.", html_url: "https://github.com/fixture/editor/issues/8", state: "closed", state_reason: "completed", closed_at: comment.updated_at, created_at: sample.createdAt, updated_at: comment.updated_at, comments: 22, reactions: { total_count: 0 }, author_association: "NONE", user: { login: "another-reporter" } }));
  if (/^\/repos\/fixture\/editor\/pulls\/(14|15|16)$/.test(url.pathname)) {
    const number = Number(url.pathname.split("/").at(-1));
    return response.end(JSON.stringify({ number, title: "Expose existing validation details", body: "Check whether this change actually covers the original workflow.", state: number === 16 ? "open" : "closed", draft: number === 16, merged: number === 14, merged_at: number === 14 ? "2026-10-19T13:37:27Z" : null, merge_commit_sha: "a".repeat(40), updated_at: comment.updated_at, base: { repo: { full_name: "fixture/editor", private: false } } }));
  }
  if (url.pathname.endsWith("/comments")) {
    assert.equal(url.searchParams.get("per_page"), "10");
    if (commentsFail) { response.statusCode = 403; response.setHeader("x-ratelimit-remaining", "0"); return response.end("{}"); }
    if (url.pathname.includes("/issues/8/")) {
      const page = Number(url.searchParams.get("page"));
      if (page < 3) response.setHeader("link", `<http://${request.headers.host}/repositories/1/issues/8/comments?per_page=10&page=${page + 1}>; rel="next", <http://${request.headers.host}/repositories/1/issues/8/comments?per_page=10&page=3>; rel="last"`);
      return response.end(JSON.stringify(Array.from({ length: page === 3 ? 2 : 10 }, (_, index) => {
        const id = 100 + (page - 1) * 10 + index + 1;
        return { ...comment, id, html_url: `https://github.com/fixture/editor/issues/8#issuecomment-${id}`, body: id === 122 ? implementationComment : `Earlier comment ${id}`, user: { login: "contributor", type: "User" } };
      })));
    }
    return response.end(JSON.stringify([comment]));
  }
  response.statusCode = 404; response.end("{}");
});
const runtime = createRuntimeAdapter(process.env.III_URL || "ws://127.0.0.1:49134", `radar-issues-${process.pid}`);
const app = Fastify();
let browser;
try {
  await new Promise((done) => upstream.listen(0, "127.0.0.1", done));
  await runtime.ready();
  const integration = () => ({ runtime: runtime.mode, engineState: runtime.engineState, completedExecutions: runtime.completedExecutions, github: { tokenConfigured: false }, evidence: { running: operation !== null, projectId: operation ? "1" : null }, analysis: { mode: "deepseek", state: "configured", model: "fixture-only", running: false, lastRun: null } });
  app.register(async (api) => {
    registerIssueContextRoute(api, { store, runtime, client: () => new GitHubClient({ apiBase: `http://127.0.0.1:${upstream.address().port}` }), busy: () => operation !== null, collection: (value) => { operation = value; } });
    api.get("/projects", async () => store.getProjects().map((project) => ({ ...project, discovery: discoveryProfile(project) })));
    api.get("/projects/:id", async (request) => { const project = store.getProject(request.params.id); return { ...project, discovery: discoveryProfile(project) }; });
    api.get("/projects/:id/observations", async () => []);
    api.get("/integrations", async () => integration());
    api.get("/dashboard", async () => ({ ...store.dashboard(), ...integration() }));
    api.get("/opportunities", async () => []);
    api.get("/analysis/runs", async () => []);
    api.get("/research-notes", async () => []);
    api.post("/analysis", async (_request, reply) => { analysisRequests += 1; return reply.code(500).send({ error: { message: "Model analysis is forbidden in this test" } }); });
  }, { prefix: "/api/v1" });
  await app.register(fastifyStatic, { root: resolve(process.env.RADAR_TEST_WEB_DIR || "apps/web/dist"), wildcard: false });
  app.setNotFoundHandler((request, reply) => request.url.startsWith("/api/") ? reply.code(404).send({}) : reply.sendFile("index.html"));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `${app.listeningOrigin}/api/v1`;
  const refresh = (number = 7) => fetch(`${base}/projects/1/issues/${number}/context`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal((await refresh(8)).status, 400);
  assert.equal(githubRequests, 0);
  const result = await refresh(); assert.equal(result.status, 200);
  const context = await result.json();
  assert.equal(context.issue.state, "closed");
  assert.equal(context.commentsComplete, true);
  assert.equal(context.comments[0].url, comment.html_url);
  assert.equal(context.comments[0].isBot, true);
  assert.equal(store.getProject("1").issues[0].state, "open");
  assert.equal(store.getProject("1").issuesFetchedAt, sample.updatedAt);
  commentsFail = true;
  const partial = await (await refresh()).json();
  assert.ok(partial.commentsError);
  assert.deepEqual(partial.comments, context.comments);
  assert.equal(partial.commentsObservedAt, context.commentsObservedAt);
  assert.equal(partial.commentsComplete, false);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM signals WHERE event_type='github.issue.context.observed'").get().n, 2);
  commentsFail = false;
  const selectedResponse = await fetch(`${base}/projects/1/issues/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issue: "https://github.com/fixture/editor/issues/8" }) });
  assert.equal(selectedResponse.status, 200);
  const selectedContext = await selectedResponse.json();
  assert.equal(selectedContext.selectedForResearch, true);
  assert.equal(selectedContext.commentSampling, "first-and-latest");
  assert.equal(selectedContext.commentsComplete, false);
  assert.deepEqual(selectedContext.referencedPullRequests.items.map(({ number, merged, state, draft }) => ({ number, merged, state, draft })), [{ number: 14, merged: true, state: "closed", draft: false }, { number: 15, merged: false, state: "closed", draft: false }, { number: 16, merged: false, state: "open", draft: true }]);
  assert.deepEqual(selectedContext.comments.map((entry) => entry.id), [101, 102, 103, 104, 105, 118, 119, 120, 121, 122]);
  assert.deepEqual(store.getProject("1").issues.map((issue) => issue.number), [7, 8]);
  assert.equal(store.dashboard().issueSampleCount, 2);
  let browserResult = "not_requested";
  if (process.env.RADAR_TEST_BROWSER === "1") {
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    const errors = [], writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const request = route.request();
      assert.equal(new URL(request.url()).origin, app.listeningOrigin, "The isolated browser must not access production or external services");
      if (request.method() === "POST") writes.push(new URL(request.url()).pathname);
      return route.continue();
    });
    await page.goto(`${app.listeningOrigin}/opportunities?project=1&project=2&issue=7`);
    const panel = page.getByRole("region", { name: "讨论核查 #7", exact: true });
    await panel.getByText("本次评论读取失败", { exact: false }).waitFor();
    assert.ok((await panel.innerText()).includes("不用于本次模型分析"));
    commentsFail = false;
    const refreshButton = panel.getByRole("button", { name: "核查状态与评论", exact: true });
    await refreshButton.click();
    await panel.getByText("条数与分页核对完整", { exact: false }).waitFor();
    assert.ok((await panel.innerText()).includes("当时关闭"));
    assert.equal(await panel.getByText("本次评论读取失败", { exact: false }).count(), 0);
    const discussion = panel.locator(".issue-comment");
    await discussion.locator("summary").click();
    assert.equal(await discussion.locator("pre").textContent(), comment.body);
    assert.ok((await discussion.innerText()).includes("Bot"));
    assert.equal(await discussion.getByRole("link", { name: "核对这条评论 ↗" }).getAttribute("href"), comment.html_url);
    await panel.locator(".issue-current-body > summary").click();
    assert.ok((await panel.locator(".issue-current-body pre").textContent()).includes("Current body"));
    commentsFail = true;
    await refreshButton.click();
    await panel.getByText("本次评论读取失败", { exact: false }).waitFor();
    assert.equal(await discussion.locator("pre").textContent(), comment.body);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    mkdirSync(".data/browser", { recursive: true });
    await page.screenshot({ path: ".data/browser/issue-context-mobile.png", fullPage: true });
    // A newer scan sample invalidates the earlier discussion without erasing it.
    const project = store.getProject("1");
    const changed = { ...project, issues: [{ ...sample, updatedAt: "2026-10-21T00:00:00Z" }], issuesFetchSucceeded: true };
    store.saveRepository(changed, createRepositorySignal({ repositoryId: 1, ...changed }), 0, [], [], "2026-10-21T00:00:00Z");
    await page.reload();
    await panel.getByText("新样本比此快照更新", { exact: false }).waitFor();
    assert.equal(writes.length, 2);
    assert.ok(writes.every((path) => path === "/api/v1/projects/1/issues/7/context"));
    await page.goto(`${app.listeningOrigin}/projects/1`);
    await page.locator(".issue-collector > summary").click();
    const collector = page.getByRole("form", { name: "补充指定讨论", exact: true });
    const beforeInvalid = githubRequests;
    await collector.getByLabel("补充的 Issue", { exact: true }).fill("https://github.com/fixture/other/issues/8");
    await collector.getByRole("button", { name: "收录并核查讨论", exact: true }).click();
    await page.locator(".issue-collector").getByRole("alert").waitFor();
    assert.equal(githubRequests, beforeInvalid);
    commentsFail = false;
    await collector.getByLabel("补充的 Issue", { exact: true }).fill("8");
    await collector.getByRole("button", { name: "收录并核查讨论", exact: true }).click();
    await page.locator(".issue-collector").getByRole("status").waitFor();
    assert.deepEqual(store.getProject("1").issues.map((issue) => issue.number), [7, 8]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: ".data/browser/selected-issue-fixture-mobile.png", fullPage: true });
    await page.getByRole("link", { name: "查看问题与组合材料 →", exact: true }).click();
    assert.equal(await page.getByLabel("研究问题起点", { exact: true }).inputValue(), "1:8");
    const selectedPanel = page.getByRole("region", { name: "讨论核查 #8", exact: true });
    await selectedPanel.getByText("当时关闭", { exact: false }).waitFor();
    await selectedPanel.getByText("中间可能遗漏", { exact: false }).waitFor();
    assert.equal(await selectedPanel.locator(":scope > .issue-comment").count(), 10);
    const latest = selectedPanel.locator(":scope > .issue-comment").last();
    await latest.locator("summary").click();
    assert.equal(await latest.locator("pre").textContent(), implementationComment);
    assert.equal(await latest.getByRole("link").getAttribute("href"), "https://github.com/fixture/editor/issues/8#issuecomment-122");
    const pulls = selectedPanel.getByRole("region", { name: "提及的 PR 核查", exact: true });
    assert.ok((await pulls.innerText()).includes("PR #14 · 已合并"));
    assert.ok((await pulls.innerText()).includes("PR #15 · 关闭未合并"));
    assert.ok((await pulls.innerText()).includes("PR #16 · 草稿"));
    await pulls.locator("summary").first().click();
    assert.equal(await pulls.getByRole("link", { name: "核对 PR ↗", exact: true }).first().getAttribute("href"), "https://github.com/fixture/editor/pull/14");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(writes.length, 4);
    assert.equal(writes.filter((path) => path === "/api/v1/projects/1/issues/import").length, 2);
    // Historical contexts and shorter excerpts must not inherit an 8,000-character claim.
    for (const [flag, expected] of [[true, "正文已截断，仅保留前 2,000 字符"], [false, "正文未截断"], [undefined, "未记录正文截断状态"]]) {
      const bounded = { ...selectedContext, issue: { ...selectedContext.issue, bodyExcerpt: "x".repeat(2000), bodyTruncated: flag } };
      if (flag === undefined) Reflect.deleteProperty(bounded.issue, "bodyTruncated");
      store.saveIssueContext("1", bounded, createIssueContextSignal("1", "fixture/editor", bounded));
      await page.reload();
      await selectedPanel.locator(".issue-current-body > summary").click();
      assert.ok((await selectedPanel.locator(".issue-context-body-notice").innerText()).includes(expected));
      assert.equal((await selectedPanel.locator(".issue-current-body pre").textContent()).length, 2000);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.equal(writes.length, 4, "Checking saved completeness boundaries must not trigger API writes");
    assert.deepEqual(errors, []);
    browserResult = { fixtureOnly: true, sourceLink: "exact", oldCommentsRetained: true, newerScanWarning: true, selectedClosedIssue: true, firstAndLatestSample: true, omittedMiddleVisible: true, latestCounterevidenceVisible: true, pullRequestStatesDistinct: true, crossRepositoryBlockedBeforeFetch: true, selectedIssueRemainsResearchOrigin: true, mobileOverflow: false, errors };
  }
  assert.equal(operation, null);
  assert.equal(analysisRequests, 0);
  assert.equal(store.listAnalysisRuns().length, 0);
  const report = { realEngine: runtime.mode === "iii", fixtureHttp: "passed", preservedOriginalSample: true, partialFailureRetainsOldComments: true, executions: runtime.completedExecutions, productionWrites: 0, modelCalls: 0, browser: browserResult };
  if (process.env.RADAR_TEST_BROWSER === "1") writeFileSync(".data/browser/issue-context-verification.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await app.close();
  await runtime.close();
  await new Promise((done) => upstream.close(done));
  store.close();
  const target = resolve(directory), parent = resolve(tmpdir());
  if (!target.startsWith(`${parent}\\radar-issue-context-`) && !target.startsWith(`${parent}/radar-issue-context-`)) throw new Error("Unexpected temporary test directory");
  rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
