import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { advanceDiscoveryProgress, buildDiscoveryPlan, buildRepositorySearchQuery, GitHubApiError, GitHubClient, repositoryName } from "./index.js";

const searchItem = {
  id: 77,
  full_name: "sample/agent-memory",
  html_url: "https://github.com/sample/agent-memory",
  description: "Persistent memory for agents",
  language: "TypeScript",
  license: { spdx_id: "MIT" },
  stargazers_count: 100,
  forks_count: 8,
  open_issues_count: 4,
  created_at: "2026-10-01T00:00:00Z",
  pushed_at: "2026-10-10T00:00:00Z",
  default_branch: "main",
};

describe("GitHubClient", () => {
  it("checks search quota without consuming a repository search or enriching projects", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ resources: { search: { remaining: 10, reset: 1792807200 } } }));
    await new GitHubClient({ fetcher }).checkSearchAccess();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe("/rate_limit");
  });

  it("rejects a configured CA file that is not a PEM bundle before making a request", async () => {
    const path = join(tmpdir(), `radar-invalid-ca-${process.pid}-${Date.now()}.pem`);
    writeFileSync(path, "not a certificate");
    const previous = process.env.RADAR_GITHUB_CA_FILE;
    process.env.RADAR_GITHUB_CA_FILE = path;
    try {
      await expect(new GitHubClient().findRepositories("agent-memory")).rejects.toThrow("RADAR_GITHUB_CA_FILE must point to a PEM CA bundle");
    } finally {
      if (previous === undefined) delete process.env.RADAR_GITHUB_CA_FILE;
      else process.env.RADAR_GITHUB_CA_FILE = previous;
      unlinkSync(path);
    }
  });

  it.each([{}, { resources: {} }, { resources: { search: { remaining: -1 } } }, { resources: { search: { remaining: "10" } } }])("rejects an invalid access response instead of accepting a successful HTTP status", async payload => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(payload));
    await expect(new GitHubClient({ fetcher }).checkSearchAccess()).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("rejects an exhausted search quota even when core API quota remains", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ resources: { core: { remaining: 5000 }, search: { remaining: 0, reset: 1792807200 } } }));
    await expect(new GitHubClient({ fetcher }).checkSearchAccess()).rejects.toMatchObject({ code: "rate_limited", retryAt: new Date(1792807200000).toISOString() });
  });

  it("previews at most six relevant repositories without enrichment or an implicit creation cutoff", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({ items: Array.from({ length: 8 }, (_, index) => ({ ...searchItem, id: index + 1, archived: index === 0, fork: index === 1 })), total_count: 800, incomplete_results: true }));
    const result = await new GitHubClient({ fetcher: fetcher as typeof fetch }).findRepositories(' "mail merge" docx ');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.searchParams.get("q")).toBe('"mail merge" docx is:public');
    expect(url.searchParams.get("sort")).toBeNull();
    expect(url.searchParams.get("per_page")).toBe("6");
    expect(result).toMatchObject({ total: 800, incomplete: true, items: [{ archived: true }, { fork: true }, {}, {}, {}, {}] });
    expect(result.items).toHaveLength(6);
  });

  it("collects one repository by canonical name, including its actual evidence and source channel", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/repos/sample/agent-memory") return Response.json(searchItem);
      if (path.endsWith("/readme")) return Response.json({ content: Buffer.from("Memory API input and output specification.").toString("base64"), encoding: "base64" });
      return Response.json([]);
    });
    const result = await new GitHubClient({ fetcher: fetcher as typeof fetch }).collectRepository("https://github.com/sample/agent-memory.git");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ id: 77, fullName: searchItem.full_name, readmeFetchSucceeded: true, issuesFetchSucceeded: true, discoveryChannels: ["按需收录"], warning: null });
    expect(result.readmeExcerpt).toContain("Memory API");
  });

  it("does not hide an unavailable import as an empty successful collection", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(new GitHubClient({ fetcher: fetcher as typeof fetch }).collectRepository("sample/missing")).rejects.toMatchObject({ code: "not_found" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("excludes private repositories from previews and refuses their collection before reading evidence", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/search/repositories"
      ? Response.json({ items: [{ ...searchItem, private: true }], total_count: 1, incomplete_results: false })
      : Response.json({ ...searchItem, private: true }));
    const client = new GitHubClient({ fetcher: fetcher as typeof fetch });
    expect((await client.findRepositories("local interface")).items).toEqual([]);
    await expect(client.collectRepository("sample/agent-memory")).rejects.toMatchObject({ code: "bad_query", message: "Only public repositories can be collected" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retains usable metadata with explicit detail failure flags on an imported repository", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname === "/repos/sample/agent-memory" ? Response.json(searchItem) : new Response("{}", { status: 500 }));
    const result = await new GitHubClient({ fetcher: fetcher as typeof fetch }).collectRepository("sample/agent-memory");
    expect(result).toMatchObject({ id: 77, readmeFetchSucceeded: false, releaseFetchSucceeded: false, issuesFetchSucceeded: false });
    expect(result.warning).toContain("README:");
    expect(result.warning).toContain("Issues:");
  });

  it("propagates detail rate limits with their retry time for bounded repository refresh", async () => {
    const reset = Math.ceil(Date.now() / 1000) + 1800;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/repos/sample/agent-memory") return Response.json(searchItem);
      if (path.endsWith("/readme")) return new Response("{}", { status: 429, headers: { "x-ratelimit-reset": String(reset), "x-ratelimit-remaining": "0" } });
      return Response.json([]);
    });
    await expect(new GitHubClient({ fetcher: fetcher as typeof fetch }).collectRepository("sample/agent-memory")).rejects.toMatchObject({ code: "rate_limited", retryAt: new Date(reset * 1000).toISOString() });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("rejects external hosts, credentials, branch paths and traversal before making a request", async () => {
    for (const invalid of ["https://evil.example/owner/repo", "https://github.com@evil.example/owner/repo", "https://user@github.com/owner/repo", "https://github.com/owner/repo/tree/main", "https://github.com/owner/repo?tab=readme", "https://github.com:444/owner/repo", "owner/..", "owner/repo/../../other", "https://github.com/owner/%2e%2e", "file:///owner/repo", "http://github.com/owner/repo"]) {
      expect(repositoryName(invalid)).toBeNull();
    }
    expect(repositoryName(" owner/repo ")).toBe("owner/repo");
    expect(repositoryName("https://github.com/owner/repo.git/")).toBe("owner/repo");
    const fetcher = vi.fn();
    await expect(new GitHubClient({ fetcher }).collectRepository("https://evil.example/owner/repo")).rejects.toThrow("owner/repository");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses Node HTTP transport by default and sends the configured token", async () => {
    let authorization: string | undefined;
    let requestPath: string | undefined;
    const server = createServer((request, response) => {
      authorization = request.headers.authorization;
      requestPath = request.url;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: [] }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Local test server did not bind a TCP port");

    try {
      const client = new GitHubClient({ apiBase: `http://127.0.0.1:${address.port}`, token: "test-token" });
      await expect(client.search("topic:tools", 1)).resolves.toEqual([]);
      expect(authorization).toBe("Bearer test-token");
      expect(requestPath).toContain("/search/repositories?q=topic%3Atools");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("adds a rolling created-after window unless the user supplied one", () => {
    const now = new Date("2026-10-17T00:00:00.000Z");
    expect(buildRepositorySearchQuery("topic:ai-agent", 90, now)).toBe("topic:ai-agent created:>=2026-07-19");
    expect(buildRepositorySearchQuery("topic:ai-agent created:>=2026-09-01", 90, now)).toBe("topic:ai-agent created:>=2026-09-01");
  });

  it("searches within the configured query and reads README and latest release", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/repositories") return Response.json({ items: [searchItem] });
      if (url.pathname.endsWith("/readme")) return Response.json({ content: Buffer.from("Agent memory uses vector retrieval.").toString("base64"), encoding: "base64" });
      if (url.pathname.endsWith("/issues")) return Response.json([]);
      return Response.json([{ tag_name: "v1.2.0", html_url: "https://github.com/sample/agent-memory/releases/tag/v1.2.0" }]);
    });
    const client = new GitHubClient({ fetcher: fetcher as typeof fetch, token: "test-token" });
    const repositories = await client.search("topic:ai-agent language:TypeScript", 2);
    const searchUrl = new URL(String(fetcher.mock.calls[0]?.[0]));

    expect(searchUrl.searchParams.get("q")).toBe("topic:ai-agent language:TypeScript");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(repositories[0]).toMatchObject({ fullName: "sample/agent-memory", license: "MIT", readmeExcerpt: "Agent memory uses vector retrieval.", releaseTag: "v1.2.0", readmeFetchSucceeded: true, releaseFetchSucceeded: true, warning: null });
  });

  it.each([[2000, false], [2001, true]] as const)("samples open Issues and flags body truncation at the 2,000-character boundary (%i)", async (bodyLength, truncated) => {
    const issue = { id: 10, number: 4, title: "Export data without manual copying", body: "x".repeat(bodyLength), html_url: "https://github.com/sample/agent-memory/issues/4", state: "open", created_at: searchItem.created_at, updated_at: searchItem.pushed_at, comments: 7, reactions: { total_count: 3 }, author_association: "NONE", user: { login: "reporter" } };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/search/repositories") return Response.json({ items: [searchItem] });
      if (path.endsWith("/issues")) return Response.json([{ ...issue, number: 5, pull_request: { url: "https://api.github.com/pulls/5" } }, issue]);
      if (path.endsWith("/readme")) return new Response("{}", { status: 404 });
      return Response.json([]);
    });
    const result = await new GitHubClient({ fetcher: fetcher as typeof fetch }).search("topic:memory", 1);
    expect(result[0]?.issues).toHaveLength(1);
    expect(result[0]?.issues?.[0]).toMatchObject({ number: 4, url: issue.html_url, comments: 7, reactions: 3, authorAssociation: "NONE", authorLogin: "reporter" });
    expect(result[0]?.issues?.[0]?.bodyExcerpt.length).toBe(Math.min(2000, bodyLength));
    expect(result[0]?.issues?.[0]?.bodyTruncated).toBe(truncated);
    expect(result[0]?.issuesFetchSucceeded).toBe(true);
  });

  it("splits a bounded budget across broad and early discovery without applying the new-project window to mature components", () => {
    const plan = buildDiscoveryPlan({ searchQuery: "topic:robotics", createdWithinDays: 90, maxResults: 32, discoveryMode: "balanced" }, new Date("2026-10-20T00:00:00Z"));
    expect(plan).toHaveLength(5);
    expect(plan.reduce((total, track) => total + track.limit, 0)).toBe(32);
    expect(plan.find((track) => track.id === "rising")?.query).toContain("created:>=2026-07-22");
    expect(plan.find((track) => track.id === "early")?.query).toContain("stars:10..1000");
    expect(plan.find((track) => track.id === "automation")?.query).not.toContain("created:");
    expect(buildDiscoveryPlan({ searchQuery: "language:Rust", createdWithinDays: 90, maxResults: 3, discoveryMode: "custom" })).toHaveLength(1);
  });

  it("keeps successful discovery tracks when another query fails", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/repositories") {
        if (url.searchParams.get("q")?.includes("topic:automation")) return new Response("{}", { status: 422 });
        return Response.json({ items: [searchItem] });
      }
      if (url.pathname.endsWith("/readme")) return new Response("{}", { status: 404 });
      return Response.json([]);
    });
    const result = await new GitHubClient({ fetcher: fetcher as typeof fetch }).discover({ searchQuery: "topic:memory", createdWithinDays: 90, maxResults: 10, discoveryMode: "balanced" });
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]?.discoveryChannels).toHaveLength(4);
    expect(result.warnings).toHaveLength(1);
    expect(result.tracks.find((track) => track.id === "automation")?.error).toContain("rejected");
  });

  it("requests the checkpoint page and holds its position on incomplete search or detail failures", async () => {
    const settings = { searchQuery: "topic:memory", createdWithinDays: 90, maxResults: 2, discoveryMode: "custom" as const };
    let incomplete = false, detailFailure = false, emptyPage = false;
    const pages: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/repositories") {
        pages.push(url.searchParams.get("page")!);
        return Response.json({ items: emptyPage ? [] : [searchItem], total_count: 25, incomplete_results: incomplete });
      }
      if (url.pathname.endsWith("/readme") && detailFailure) return new Response("{}", { status: 422 });
      return Response.json([]);
    });
    const client = new GitHubClient({ fetcher: fetcher as typeof fetch });
    const first = await client.discover(settings);
    expect(first.tracks[0]).toMatchObject({ page: 1, totalCount: 25, searchComplete: true, hasMore: true });
    const progress = advanceDiscoveryProgress({}, first.tracks);
    incomplete = true;
    const second = await client.discover(settings, progress);
    expect(second.tracks[0]).toMatchObject({ page: 2, searchComplete: false, incomplete: true });
    expect(second.warnings[0]).toContain("incomplete");
    expect(advanceDiscoveryProgress(progress, second.tracks)).toEqual(progress);
    incomplete = false; detailFailure = true;
    const third = await client.discover(settings, progress);
    expect(third.tracks[0]?.searchComplete).toBe(false);
    expect(third.repositories).toHaveLength(1);
    expect(advanceDiscoveryProgress(progress, third.tracks)).toEqual(progress);
    expect(pages).toEqual(["1", "2", "2"]);
    detailFailure = false; emptyPage = true;
    const empty = await client.discover(settings, progress);
    expect(empty.tracks[0]).toMatchObject({ page: 2, searchComplete: true, hasMore: false });
    expect(advanceDiscoveryProgress(progress, empty.tracks).custom).toMatchObject({ page: 1, explorePage: 2 });
  });

  it("retains attempted page diagnostics if every search fails", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 422 }));
    await expect(new GitHubClient({ fetcher: fetcher as typeof fetch }).discover({ searchQuery: "invalid", createdWithinDays: 30, maxResults: 2, discoveryMode: "custom" }))
      .rejects.toMatchObject({ tracks: [{ id: "custom", page: 1, error: expect.any(String) }] });
  });

  it("classifies GitHub search quota exhaustion without exposing request headers", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 403, headers: { "x-ratelimit-reset": "1792000000" } }));
    const client = new GitHubClient({ fetcher: fetcher as typeof fetch });
    await expect(client.search("topic:ai-agent", 4)).rejects.toMatchObject({ name: "GitHubApiError", code: "rate_limited" } satisfies Partial<GitHubApiError>);
  });

  it("keeps all search results when detail enrichment hits the API quota", async () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ ...searchItem, id: 77 + index, full_name: `sample/repo-${index}` }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/repositories") return Response.json({ items });
      return new Response("{}", { status: 403, headers: { "x-ratelimit-reset": "1792000000" } });
    });
    const client = new GitHubClient({ fetcher: fetcher as typeof fetch });

    const repositories = await client.search("topic:ai-agent", 5);

    expect(repositories).toHaveLength(5);
    expect(repositories[0]).toMatchObject({ readmeFetchSucceeded: false, releaseFetchSucceeded: false });
    expect(repositories[4]).toMatchObject({ id: 81, fullName: "sample/repo-4", description: searchItem.description, warning: expect.stringContaining("enrichment skipped") });
  });

  it("retries a transient connection failure once and respects the advertised 60-result custom limit", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(Response.json({ items: [] }));
    await expect(new GitHubClient({ fetcher: fetcher as typeof fetch }).search("topic:tools", 60)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get("per_page")).toBe("60");
  });

  it.each([
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT",
    "ERR_TLS_CERT_ALTNAME_INVALID",
  ])("stops retries for certificate error %s without exposing request secrets", async code => {
    const error = Object.assign(new Error("request failed with secret-token"), { code });
    const fetcher = vi.fn().mockRejectedValue(error);
    const client = new GitHubClient({ fetcher, token: "secret-token" });
    await expect(client.findRepositories("generative_agents")).rejects.toMatchObject({
      code: "upstream_error",
      message: `GitHub certificate verification failed (${code}); automatic retries stopped`,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("finds a certificate error through fetch cause wrappers and permits a later recovery", async () => {
    const cause = Object.assign(new Error("certificate rejected"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
    const error = new TypeError("fetch failed", { cause: new Error("transport failed", { cause }) });
    const fetcher = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(Response.json({ items: [], total_count: 0, incomplete_results: false }));
    const client = new GitHubClient({ fetcher });
    await expect(client.findRepositories("generative_agents")).rejects.toThrow("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(client.findRepositories("generative_agents")).resolves.toMatchObject({ items: [], total: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses a third attempt when two transient GitHub connections fail", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(Response.json({ items: [] }));
    await expect(new GitHubClient({ fetcher: fetcher as typeof fetch }).search("topic:tools", 1)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
