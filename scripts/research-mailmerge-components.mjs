// Real research operation: searches GitHub and imports Gradio into the current workspace.
// No model analysis, opportunity creation, external messages or market validation.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.RADAR_BROWSER_URL || "http://127.0.0.1:4317";
const read = async (path) => { const r = await fetch(`${base}/api/v1${path}`); assert.equal(r.status, 200); return r.json(); };
const before = await read("/projects"), beforeRuns = await read("/analysis/runs");
const origin = before.find((p) => p.fullName === "genspark-ai/genoffice");
assert.ok(origin?.issues.some((i) => i.number === 2097), "The actual originating discussion is required");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const writes = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/**", (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "POST") {
      writes.push(path);
      if (!["/api/v1/components/search", "/api/v1/components/import"].includes(path)) return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${base}/opportunities?project=${origin.id}&issue=2097`);
  const form = page.getByRole("region", { name: "定向研究", exact: true });
  await form.locator(".component-finder > summary").click();
  const finder = page.getByRole("region", { name: "寻找互补组件" });
  await finder.getByLabel("GitHub 组件搜索", { exact: true }).fill('"mail merge" docx');
  const searchResponse = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/components/search"));
  await finder.getByRole("button", { name: "搜索组件", exact: true }).click();
  const searchHttp = await searchResponse;
  assert.equal(searchHttp.status(), 200);
  const search = await searchHttp.json();
  await finder.locator(".component-results").waitFor();
  assert.equal(await finder.locator(".component-result").count(), search.items.length);
  const afterSearch = await read("/projects");
  assert.deepEqual(afterSearch.map((p) => p.id), before.map((p) => p.id));
  mkdirSync(".data/browser", { recursive: true });
  await page.screenshot({ path: ".data/browser/real-component-search-desktop.png", fullPage: true });
  await finder.getByLabel("按地址收录组件", { exact: true }).fill("https://github.com/gradio-app/gradio");
  const importResponse = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/components/import"));
  await finder.locator("form").nth(1).getByRole("button", { name: "收录并选择", exact: true }).click();
  const importHttp = await importResponse;
  assert.equal(importHttp.status(), 200);
  const imported = await importHttp.json();
  await finder.getByRole("status").waitFor();
  assert.equal(imported.fullName, "gradio-app/gradio");
  assert.equal(await form.getByLabel("研究组件 2", { exact: true }).inputValue(), imported.id);
  assert.equal(await form.getByLabel("研究问题起点", { exact: true }).inputValue(), `${origin.id}:2097`);
  assert.equal(await form.getByLabel("待证伪的研究问题", { exact: true }).inputValue(), "");
  const project = await read(`/projects/${imported.id}`);
  assert.ok(project.discoveryChannels.includes("按需收录"));
  assert.ok(project.readmeExcerpt);
  const afterRuns = await read("/analysis/runs"), after = await read("/projects");
  assert.deepEqual(afterRuns.map((r) => r.id), beforeRuns.map((r) => r.id));
  assert.ok(before.every((p) => after.some((q) => q.id === p.id)));
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: ".data/browser/real-component-import-mobile.png", fullPage: true });
  const result = { observedAt: new Date().toISOString(), origin: { projectId: origin.id, issueNumber: 2097, issue: origin.issues.find((i) => i.number === 2097) }, search, imported, project: { ...project, readmeExcerpt: project.readmeExcerpt }, beforeProjects: before.length, afterProjects: after.length, beforeAnalysis: beforeRuns[0]?.id, afterAnalysis: afterRuns[0]?.id, modelCalls: 0, writes, errors, limits: ["Search descriptions are project self-reports, not compatibility proof", "Gradio is a UI research candidate, not a recommended combination", "No interviews, trials, payments or market validation"] };
  mkdirSync(".data/research", { recursive: true });
  writeFileSync(".data/research/2026-10-20-mailmerge-component-research.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ query: search.query, totalMatches: search.total, displayed: search.items.length, imported: imported.fullName, warning: imported.warning, beforeProjects: before.length, afterProjects: after.length, originPreserved: true, modelCalls: 0, errors }));
} finally { await browser.close(); }
