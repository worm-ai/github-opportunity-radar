import { expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createRepositorySignal } from "@radar/contracts";
import { GitHubClient } from "@radar/sensor-github";
import { RadarStore } from "@radar/storage";
import { InProcessRuntimeAdapter } from "@radar/runtime";
import { registerDocumentationRoute } from "./documentation.js";

it("persists pinned W2A documents and retains their own provenance when a different version fails", async () => {
  const app = Fastify(), store = new RadarStore(":memory:"), runtime = new InProcessRuntimeAdapter();
  const item = { id: 42, fullName: "sample/chart", description: null, url: "https://github.com/sample/chart", language: "TypeScript", license: "MIT", stars: 1, forks: 0, openIssues: 0, createdAt: "2026-10-01T00:00:00Z", pushedAt: null, readmeExcerpt: null, releaseTag: null, releaseUrl: null, raw: { id: 42 }, warning: null };
  store.saveRepository(item, createRepositorySignal({ repositoryId: 42, ...item }), 0, [], [], item.createdAt);
  const save = vi.spyOn(store, "saveDocumentation");
  const sha = "a".repeat(40), commit = "b".repeat(40), next = "c".repeat(40);
  let operation: string | null = null;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    expect(operation).toBe("42");
    const url = new URL(String(input));
    if (url.pathname.endsWith("/commits/missing")) return new Response("not found", { status: 404 });
    if (url.pathname.includes("/commits/")) return Response.json({ sha: url.pathname.endsWith("/v1") ? commit : next });
    if (url.searchParams.get("ref") === next) return new Response("not found", { status: 404 });
    return Response.json({ type: "file", content: Buffer.from("SVG exports are documented for this version.").toString("base64"), encoding: "base64", sha });
  });
  registerDocumentationRoute(app, { store, runtime, client: () => new GitHubClient({ fetcher }), busy: () => operation !== null, collection: (value) => { operation = value; } });
  const collect = (payload: Record<string, unknown>, id = "42") => app.inject({ method: "POST", url: `/projects/${id}/documentation`, payload });
  try {
    for (const payload of [{ ref: "https://evil.example" }, { paths: ["../api.md"], ref: "v1" }, { ref: "v1", force: true }]) expect((await collect(payload)).statusCode).toBe(400);
    expect((await collect({}, "missing")).statusCode).toBe(404);
    operation = "scan"; expect((await collect({ ref: "v1" })).statusCode).toBe(409); operation = null;
    expect(fetcher).not.toHaveBeenCalled();
    const first = await collect({ paths: ["docs/api.md"], ref: "v1" });
    expect(first.statusCode).toBe(200);
    const document = first.json().documents[0];
    expect(document).toMatchObject({ ref: "v1", commitSha: commit, sha, stale: false, url: `${item.url}/blob/${commit}/docs/api.md` });
    expect(save.mock.calls[0]?.[2].source_event?.data.documentation).toMatchObject({ documents: [document] });
    const failed = await collect({ paths: ["docs/api.md"], ref: "v2" });
    expect(failed.json()).toMatchObject({ ref: "v2", commitSha: next, documents: [{ ...document, stale: true }] });
    const previous = store.getProject("42")?.documentation;
    expect((await collect({ paths: ["docs/api.md"], ref: "missing" })).statusCode).toBe(404);
    expect(store.getProject("42")?.documentation).toEqual(previous);
    expect(operation).toBeNull();
    const legacy = await collect({ paths: ["docs/api.md"] });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().documents[0]).not.toHaveProperty("ref");
    expect(legacy.json().documents[0].url).toContain("/blob/HEAD/");
    expect(store.listAnalysisRuns()).toEqual([]);
    expect(operation).toBeNull();
  } finally { await app.close(); store.close(); }
});
