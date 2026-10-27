import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { GitHubClient } from "./index.js";
import { sourcePath } from "./source-study.js";

const commitSha = "a".repeat(40), rootSha = "b".repeat(40), subtree = "c".repeat(40);
const content = "state = {}\r\nstate['memory'] = event\r\naction = decide(state)\r\n";
const bytes = Buffer.from(content), sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
function setup(options: { truncated?: boolean; corrupt?: boolean; private?: boolean } = {}) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input)), path = url.pathname;
    if (path === "/repos/sample/world") return Response.json({ private: options.private ?? false });
    if (path.endsWith("/commits/HEAD")) return Response.json({ sha: commitSha, commit: { tree: { sha: rootSha } } });
    if (path.endsWith(`/git/trees/${rootSha}`) && url.search) return Response.json({ truncated: options.truncated ?? false, tree: options.truncated ? [] : [{ path: "world/engine.py", type: "blob", mode: "100644", sha, size: bytes.length }, { path: "link.py", type: "blob", mode: "120000", sha, size: bytes.length }] });
    if (path.endsWith(`/git/trees/${rootSha}`)) return Response.json({ truncated: options.truncated ?? false, tree: [{ path: "world", type: "tree", sha: subtree }, { path: "link.py", type: "blob", mode: "120000", sha, size: bytes.length }] });
    if (path.endsWith(`/git/trees/${subtree}`)) return Response.json({ truncated: false, tree: [{ path: "engine.py", type: "blob", mode: "100644", sha, size: bytes.length }] });
    if (path.endsWith(`/git/blobs/${sha}`)) return Response.json({ sha, encoding: "base64", content: Buffer.from(options.corrupt ? content.replace("decide", "delete") : content).toString("base64"), size: bytes.length });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  return { client: new GitHubClient({ fetcher: fetcher as typeof fetch }), fetcher };
}

it("pins real paths, rejects symlinks, verifies the raw Git blob and keeps exact lines when truncating", async () => {
  const { client, fetcher } = setup();
  const inventory = await client.sourceInventory("sample/world");
  expect(inventory).toMatchObject({ fullName: "sample/world", commitSha, complete: true, files: [{ path: "world/engine.py", sha }] });
  const source = await client.sourceText(inventory, "world/engine.py", 40);
  expect(source).toMatchObject({ content: "state = {}\r\nstate['memory'] = event\r", startLine: 1, endLine: 2, totalLines: 4, truncated: true, sha, commitSha });
  expect(source.url).toContain(`/blob/${commitSha}/world/engine.py#L1-L2`);
  const nextPage = await client.sourceText(inventory, "world/engine.py", 40, 3);
  expect(nextPage).toMatchObject({ content: "action = decide(state)\r\n", startLine: 3, endLine: 4, totalLines: 4, truncated: false });
  expect(nextPage.url).toContain(`#L3-L4`);
  const requests = fetcher.mock.calls.length;
  await expect(client.sourceText(inventory, "guessed.py")).rejects.toThrow("pinned inventory");
  expect(fetcher.mock.calls).toHaveLength(requests);
});

it("reads actual subtrees and preserves a truncated listing boundary", async () => {
  const { client, fetcher } = setup({ truncated: true });
  const inventory = await client.sourceInventory("sample/world");
  expect(inventory.files.map(item => item.path)).toEqual(["world/engine.py"]);
  expect(inventory.warnings.join(" ")).toContain("截断");
  expect(fetcher.mock.calls.map(([input]) => String(input))).toContain(`https://api.github.com/repos/sample/world/git/trees/${subtree}`);
});

it("refuses corrupted blobs and private repository reads", async () => {
  const corrupted = setup({ corrupt: true });
  const inventory = await corrupted.client.sourceInventory("sample/world");
  await expect(corrupted.client.sourceText(inventory, "world/engine.py")).rejects.toThrow("hash or length mismatch");
  const privateRepo = setup({ private: true });
  await expect(privateRepo.client.sourceInventory("sample/world")).rejects.toThrow("public repository");
  expect(privateRepo.fetcher).toHaveBeenCalledOnce();
});

it("never treats an unfinished subtree walk as proof of absence", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/world")) return Response.json({ private: false });
    if (path.endsWith("/HEAD")) return Response.json({ sha: commitSha, commit: { tree: { sha: rootSha } } });
    return Response.json({ truncated: true, tree: Array.from({ length: 20 }, (_, i) => ({ path: `directory${i}`, type: "tree", sha: subtree })) });
  });
  const inventory = await new GitHubClient({ fetcher: fetcher as typeof fetch }).sourceInventory("sample/world");
  expect(inventory.complete).toBe(false);
  expect(inventory.warnings.join(" ")).toContain("不能据此断言");
  expect(fetcher).toHaveBeenCalledTimes(15); // metadata + commit + recursive listing + 12 real directories
});

it("limits source collection to safe text paths", () => {
  for (const path of ["../engine.py", "a/../engine.py", ".env", "secrets.pem", "foo\\engine.py", "foo%2fengine.py", ".github/config.yml", "a//engine.py"]) expect(sourcePath(path)).toBe(false);
  for (const path of ["script/AIAgent.gd", "world/engine.py", "src/main.ts", "project.godot"]) expect(sourcePath(path)).toBe(true);
});

it("reaches source directories before asset directories consume the bounded walk", async () => {
  const visited: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/world")) return Response.json({ private: false });
    if (path.endsWith("/HEAD")) return Response.json({ sha: commitSha, commit: { tree: { sha: rootSha } } });
    visited.push(path);
    if (path.endsWith(rootSha)) return Response.json({ tree: [...Array.from({ length: 20 }, (_, i) => ({ path: `images/part${i}`, type: "tree", sha: "d".repeat(40) })), { path: "script", type: "tree", sha: subtree }] });
    return Response.json({ tree: path.endsWith(subtree) ? [{ path: "agent.gd", type: "blob", mode: "100644", sha, size: bytes.length }] : [] });
  });
  const inventory = await new GitHubClient({ fetcher: fetcher as typeof fetch }).sourceInventory("sample/world");
  expect(visited.some(value => value.includes(subtree))).toBe(true);
  expect(inventory.files.map(file => file.path)).toContain("script/agent.gd");
  expect(inventory.complete).toBe(false);
  expect(visited).toHaveLength(13); // recursive probe plus the bounded directory walk
});

it("prioritizes nested agent/persona cognition code in an incomplete large repository", async () => {
  const visited: string[] = [];
  const persona = "e".repeat(40), assets = "f".repeat(40), misc = "9".repeat(40);
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/world")) return Response.json({ private: false });
    if (path.endsWith("/HEAD")) return Response.json({ sha: commitSha, commit: { tree: { sha: rootSha } } });
    visited.push(path);
    if (path.endsWith(rootSha)) return Response.json({ tree: [
      ...Array.from({ length: 20 }, (_, i) => ({ path: `misc${i}`, type: "tree", sha: misc })),
      { path: "assets", type: "tree", sha: assets }, { path: "reverie", type: "tree", sha: "8".repeat(40) },
    ] });
    if (path.endsWith("8".repeat(40))) return Response.json({ tree: [{ path: "backend_server", type: "tree", sha: "7".repeat(40) }] });
    if (path.endsWith("7".repeat(40))) return Response.json({ tree: [{ path: "persona", type: "tree", sha: persona }] });
    if (path.endsWith(persona)) return Response.json({ tree: [{ path: "persona.py", type: "blob", mode: "100644", sha, size: bytes.length }] });
    return Response.json({ tree: [] });
  });
  const inventory = await new GitHubClient({ fetcher: fetcher as typeof fetch }).sourceInventory("sample/world");
  expect(inventory.files.map(file => file.path)).toContain("reverie/backend_server/persona/persona.py");
  expect(visited.slice(0, 4).some(value => value.endsWith("8".repeat(40)))).toBe(true);
  expect(inventory.complete).toBe(false);
});
