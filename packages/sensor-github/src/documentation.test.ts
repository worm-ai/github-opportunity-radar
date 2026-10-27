import { describe, expect, it, vi } from "vitest";
import { documentationPath, documentationRef, linkedDocumentation } from "./documentation.js";
import { GitHubClient } from "./index.js";

const file = (text = "The CLI accepts a local image path as input.") => ({ type: "file", content: Buffer.from(text).toString("base64"), encoding: "base64", sha: "a".repeat(40), size: Buffer.byteLength(text) });

describe("bounded repository documentation", () => {
  it("rejects invalid refs and paths before resolving any version", async () => {
    const fetcher = vi.fn<typeof fetch>(), client = new GitHubClient({ fetcher });
    for (const ref of ["", "https://github.com/owner/repo", "../main", "a..b", "main/", "a//b", ".hidden", "v1.lock", "a/.b", "main@{1}", "a b", "a\n", "a\\b", "main?ref=x", "a%2fb", "@", "a".repeat(161)]) {
      expect(documentationRef(ref)).toBeNull();
      await expect(client.collectDocumentation("owner/repo", ["api.md"], ref)).rejects.toThrow("ref");
    }
    for (const ref of ["v1.1.0", "release/v1", "@scope/package@1.0.0", "HEAD", "a".repeat(40)]) expect(documentationRef(ref)).toBe(ref);
    await expect(client.collectDocumentation("owner/repo", ["../api.md"], "v1")).rejects.toThrow("paths");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("resolves a moving ref once and reads both documents from the same immutable commit", async () => {
    const commitSha = "c".repeat(40), requests: URL[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input)); requests.push(url);
      if (url.pathname.includes("/commits/")) return Response.json({ sha: requests.length === 1 ? commitSha : "d".repeat(40) });
      expect(url.searchParams.get("ref")).toBe(commitSha);
      return Response.json(file());
    });
    const report = await new GitHubClient({ fetcher }).collectDocumentation("owner/repo", ["docs/api.md", "docs/cli.md"], "release/v1");
    expect(requests[0]?.pathname).toBe("/repos/owner/repo/commits/release%2Fv1");
    expect(requests).toHaveLength(3);
    expect(report).toMatchObject({ ref: "release/v1", commitSha, warnings: [] });
    for (const document of report.documents) {
      expect(document).toMatchObject({ ref: "release/v1", commitSha, sha: "a".repeat(40) });
      expect(document.url).toBe(`https://github.com/owner/repo/blob/${commitSha}/${document.path}`);
    }
  });

  it("discovers links from the pinned README and never falls back to HEAD on missing files", async () => {
    const commitSha = "c".repeat(40);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/commits/")) return Response.json({ sha: commitSha });
      expect(url.searchParams.get("ref")).toBe(commitSha);
      if (url.pathname.endsWith("/readme")) return Response.json({ path: "README.md", encoding: "base64", content: Buffer.from("[API](docs/api.md)\n[CLI](docs/cli.md)").toString("base64") });
      return url.pathname.endsWith("/api.md") ? Response.json(file()) : new Response("missing", { status: 404 });
    });
    const report = await new GitHubClient({ fetcher }).collectDocumentation("owner/repo", undefined, "v1");
    expect(report.documents).toHaveLength(1);
    expect(report.documents[0]?.commitSha).toBe(commitSha);
    expect(report.warnings).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each(["missing", "invalid-sha"])("fails a %s ref resolution without reading any HEAD material", async (mode) => {
    const fetcher = vi.fn<typeof fetch>(async () => mode === "missing" ? new Response("missing", { status: 404 }) : Response.json({ sha: "HEAD" }));
    await expect(new GitHubClient({ fetcher }).collectDocumentation("owner/repo", ["api.md"], "v1")).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects URL, traversal and binary-file inputs before any request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new GitHubClient({ fetcher, token: "private-fixture" });
    for (const path of ["../README.md", "%2e%2e/README.md", "docs/%2e%2e/%2e%2e/a.md", "https://evil.example/api.md", "//evil.example/api.md", "docs\\api.md", "a.md%00", ".git/config.txt", "image.png"]) {
      expect(documentationPath(path)).toBeNull();
      await expect(client.collectDocumentation("owner/repo", [path])).rejects.toThrow("paths");
    }
    await expect(client.collectDocumentation("owner/repo", ["a.md", "b.md", "c.md"])).rejects.toThrow("at most two");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("resolves relative links from a nested README and follows at most two useful same-repo documents", () => {
    const markdown = [
      "[API](../docs/api.md#input)", "[CLI](https://github.com/owner/repo/blob/main/docs/cli.md)",
      "[Usage](../docs/usage.md)", "[License](../LICENSE.md)",
      "[external API](https://evil.example/api.md)", "[other API](https://github.com/other/repo/blob/main/docs/api.md)",
      "[branch API](https://github.com/owner/repo/blob/untrusted/docs/api.md)",
      "![API image](../docs/image.md)", "```md\n[API example](../docs/example.md)\n```",
    ].join("\n");
    expect(linkedDocumentation("owner/repo", markdown, ".github/README.md", "https://github.com/owner/repo/blob/main/.github/README.md")).toEqual(["docs/api.md", "docs/cli.md"]);
  });

  it("prioritizes a concrete input specification over general reference guides", () => {
    const readme = "[Basemaps](skills/map-design/references/basemaps.md)\n[Cartography guide](skills/map-design/references/cartography.md)\n[JSON spec](skills/map-design/references/spec.md)";
    expect(linkedDocumentation("owner/repo", readme)[0]).toBe("skills/map-design/references/spec.md");
  });

  it("keeps partial success and never sends the token to README link hosts", async () => {
    const requests: URL[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input)); requests.push(url);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-fixture");
      if (url.pathname.endsWith("/readme")) return Response.json({ path: "README.md", encoding: "base64", content: Buffer.from("[CLI](docs/cli.md)\n[API](docs/api.md)\n[API](https://evil.example/api.md)").toString("base64") });
      return url.pathname.endsWith("/docs/cli.md") ? Response.json(file()) : new Response("missing", { status: 404 });
    });
    const report = await new GitHubClient({ fetcher, token: "private-fixture" }).collectDocumentation("owner/repo");
    expect(requests).toHaveLength(3);
    expect(requests.every((url) => url.origin === "https://api.github.com" && url.pathname.startsWith("/repos/owner/repo/"))).toBe(true);
    expect(report.documents).toMatchObject([{ path: "docs/cli.md", sha: "a".repeat(40), excerpt: "The CLI accepts a local image path as input." }]);
    expect(report.warnings).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain("private-fixture");
  });

  it("rejects oversized and binary documents while retaining attempted paths", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => Response.json(String(input).endsWith("/large.md") ? { ...file(), size: 512_001 } : file("binary\0content")));
    const report = await new GitHubClient({ fetcher }).collectDocumentation("owner/repo", ["large.md", "binary.md"]);
    expect(report.documents).toEqual([]);
    expect(report.attemptedPaths).toEqual(["large.md", "binary.md"]);
    expect(report.warnings).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
