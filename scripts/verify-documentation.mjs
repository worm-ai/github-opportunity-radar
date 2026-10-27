// Real iii, isolated GitHub HTTP fixtures, temporary SQLite and optional Edge. No paid model.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { RadarStore } from "../packages/storage/dist/index.js";
import { createRepositorySignal } from "../packages/contracts/dist/index.js";
import { GitHubClient } from "../packages/sensor-github/dist/index.js";
import { createRuntimeAdapter } from "../packages/runtime/dist/index.js";
import { registerDocumentationRoute } from "../apps/server/dist/documentation.js";
import { registerResearchNoteRoutes } from "../apps/server/dist/research-notes.js";
import { discoveryProfile } from "../apps/server/dist/discovery.js";

const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const Fastify = require("fastify"), fastifyStatic = require("@fastify/static");
const directory = mkdtempSync(join(tmpdir(), "radar-documentation-"));
const store = new RadarStore(join(directory, "test.sqlite")), app = Fastify();
const commit = "b".repeat(40), next = "c".repeat(40), blob = "a".repeat(40);
const text = "This version documents SVG output from a local chart specification.";
const item = { id: 1, fullName: "fixture/chart", description: "A local chart component.", url: "https://github.com/fixture/chart", language: "TypeScript", license: "MIT", stars: 1, forks: 0, openIssues: 0, createdAt: "2026-10-01T00:00:00Z", pushedAt: null, readmeExcerpt: "Local chart specification input.", releaseTag: "v1", releaseUrl: null, raw: { id: 1 }, warning: null };
store.saveRepository(item, createRepositorySignal({ repositoryId: 1, ...item }), 0, [], [], item.createdAt);
let operation = null, fileFail = false, modelCalls = 0;
const requests = [];
const upstream = createServer((request, response) => {
  const url = new URL(request.url, "http://fixture"); requests.push(url.pathname + url.search);
  response.setHeader("content-type", "application/json");
  if (url.pathname.endsWith("/commits/missing")) { response.statusCode = 404; return response.end("{}"); }
  if (url.pathname.includes("/commits/")) return response.end(JSON.stringify({ sha: url.pathname.endsWith("/v1") ? commit : next }));
  assert.ok([commit, next].includes(url.searchParams.get("ref")), "Every content request must use the resolved commit");
  if (url.pathname.endsWith("/readme")) return response.end(JSON.stringify({ path: "README.md", encoding: "base64", content: Buffer.from("[API](docs/api.md)").toString("base64") }));
  if (fileFail) { response.statusCode = 404; return response.end("{}"); }
  response.end(JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(text).toString("base64"), sha: blob }));
});
const runtime = createRuntimeAdapter(process.env.III_URL || "ws://127.0.0.1:49134", `radar-documents-${process.pid}`);
let browser;
try {
  await new Promise((done) => upstream.listen(0, "127.0.0.1", done));
  await runtime.ready(); assert.equal(runtime.mode, "iii");
  const integration = () => ({ runtime: runtime.mode, engineState: runtime.engineState, completedExecutions: runtime.completedExecutions, github: { tokenConfigured: false }, evidence: { running: operation !== null, projectId: operation }, analysis: { mode: "deepseek", state: "configured", model: "fixture-only", running: false, lastRun: null } });
  app.register(async (api) => {
    registerDocumentationRoute(api, { store, runtime, client: () => new GitHubClient({ apiBase: `http://127.0.0.1:${upstream.address().port}` }), busy: () => operation !== null, collection: (value) => { operation = value; } });
    registerResearchNoteRoutes(api, store);
    const project = () => { const project = store.getProject("1"); return { ...project, discovery: discoveryProfile(project) }; };
    api.get("/projects", async () => [project()]); api.get("/projects/:id", project);
    api.get("/projects/:id/observations", async () => []);
    api.get("/projects/:id/monitor", async () => ({ enabled: false, running: false }));
    api.get("/integrations", integration); api.get("/dashboard", async () => ({ ...store.dashboard(), ...integration() }));
    api.get("/opportunities", async () => []); api.get("/analysis/runs", async () => []);
    api.post("/analysis", async (_request, reply) => { modelCalls += 1; return reply.code(500).send({}); });
  }, { prefix: "/api/v1" });
  await app.register(fastifyStatic, { root: resolve("apps/web/dist"), wildcard: false });
  app.setNotFoundHandler((request, reply) => request.url.startsWith("/api/") ? reply.code(404).send({}) : reply.sendFile("index.html"));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `${app.listeningOrigin}/api/v1`;
  const post = (path, payload) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const collect = (ref) => post("/projects/1/documentation", { ref });
  const first = await collect("v1"); assert.equal(first.status, 200);
  const document = (await first.json()).documents[0]; assert.equal(document.commitSha, commit);
  const saved = await post("/research-notes", { requestId: randomUUID(), author: "assistant", title: "Fixed version documentation check", question: "Does this published version document a compatible file interface?", projectIds: ["1"], decision: "watch", conclusion: "Only a document statement is available; installation and interface compatibility are unverified.", nextAction: "Review the fixed source and validate an actual input before drawing a conclusion.", evidence: [{ ref: { projectId: "1", kind: "documentation", documentPath: "docs/api.md" }, quote: text }] });
  assert.equal(saved.status, 201); const note = await saved.json();
  const report = await (await fetch(`${base}/research-notes/${note.id}/report.md`)).text();
  assert.ok(report.includes(commit) && report.includes(`blob/${commit}/docs/api.md`) && !report.includes("可变 HEAD"));
  fileFail = true;
  const failed = await (await collect("v2")).json();
  assert.equal(failed.ref, "v2"); assert.equal(failed.documents[0].ref, "v1"); assert.equal(failed.documents[0].stale, true);
  const currentNote = () => fetch(`${base}/research-notes/${note.id}`).then((response) => response.json());
  assert.deepEqual((await currentNote()).evidenceStates, ["unavailable"]);
  assert.equal((await collect("missing")).status, 404); assert.equal(operation, null);
  fileFail = false; await collect("v1");
  assert.deepEqual((await currentNote()).evidenceStates, ["same"]);
  await collect("v2"); assert.deepEqual((await currentNote()).evidenceStates, ["changed"]);
  assert.equal((await currentNote()).evidence[0].url, document.url, "Saved evidence must remain immutable");
  let browserResult = "not_requested";
  if (process.env.RADAR_TEST_BROWSER === "1") {
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      assert.equal(new URL(route.request().url()).origin, app.listeningOrigin);
      if (route.request().method() === "POST") writes.push(new URL(route.request().url()).pathname);
      return route.continue();
    });
    await page.goto(`${app.listeningOrigin}/projects/1`);
    const panel = page.getByRole("region", { name: "补充技术文档" });
    await panel.getByLabel("文档版本", { exact: true }).fill("v1");
    await panel.getByRole("button", { name: "补充接口文档", exact: true }).click();
    await panel.locator("summary").filter({ hasText: "版本 v1" }).waitFor();
    await panel.locator("summary").click(); assert.ok((await panel.innerText()).includes(commit));
    assert.equal(await panel.getByRole("link", { name: "查看仓库文档" }).getAttribute("href"), document.url);
    await page.reload(); await panel.locator("summary").filter({ hasText: "版本 v1" }).waitFor();
    fileFail = true;
    await panel.getByLabel("文档版本", { exact: true }).fill("v2");
    await panel.getByRole("button", { name: "补充接口文档", exact: true }).click();
    await panel.locator("summary").filter({ hasText: "本次读取失败" }).waitFor();
    assert.ok((await panel.locator("summary").innerText()).includes("版本 v1"));
    await panel.getByLabel("文档版本", { exact: true }).fill("missing");
    await panel.getByRole("button", { name: "补充接口文档", exact: true }).click();
    await panel.locator(".form-error").filter({ hasText: "resource was not found" }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []); assert.ok(writes.every((path) => path === "/api/v1/projects/1/documentation"));
    mkdirSync(".data/browser", { recursive: true });
    await page.screenshot({ path: ".data/browser/documentation-version-mobile.png", fullPage: true });
    browserResult = "passed";
  }
  assert.equal(modelCalls, 0); assert.equal(store.listAnalysisRuns().length, 0);
  const result = { realEngine: true, immutableContentRequests: true, versionFailurePreservesProvenance: true, immutableResearchExport: true, browser: browserResult, executions: runtime.completedExecutions, modelCalls, productionWrites: 0 };
  mkdirSync(".data/browser", { recursive: true }); writeFileSync(".data/browser/documentation-version-verification.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close(); await app.close(); await runtime.close();
  await new Promise((done) => upstream.close(done)); store.close();
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !target.split(/[\\/]/).at(-1).startsWith("radar-documentation-")) throw new Error("Unexpected temporary test directory");
  rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
