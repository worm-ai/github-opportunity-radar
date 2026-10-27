import { expect, it, vi } from "vitest";
import { GitHubClient } from "./index.js";

it.each(["comments", "referenced-pr"])("exposes nested %s rate limits to the scheduled queue and stops further requests", async (stage) => {
  const paths: string[] = [];
  const api = new GitHubClient({ fetcher: async (input) => {
    const path = new URL(String(input)).pathname; paths.push(path);
    if (path.endsWith("/comments")) return stage === "comments" ? new Response("{}", { status: 429, headers: { "retry-after": "120" } }) : Response.json([]);
    if (path.endsWith("/pulls/8")) return new Response("{}", { status: 429, headers: { "retry-after": "120" } });
    if (path.endsWith("/issues/7")) return Response.json({ ...issue, comments: 0, body: "An existing implementation is in #8 and #9." });
    return Response.json({ id: 42, private: false });
  } });
  await expect(api.collectIssueContext("sample/editor", 7, { throwOnRateLimit: true })).rejects.toMatchObject({ code: "rate_limited", retryAt: expect.any(String) });
  expect(paths.some((path) => path.endsWith("/pulls/9"))).toBe(false);
  if (stage === "comments") expect(paths.some((path) => path.includes("/pulls/"))).toBe(false);
});

const issue = { id: 7, number: 7, title: "Need a safer external editor round trip", body: "The result needs to keep its original pixel depth.", html_url: "https://github.com/sample/editor/issues/7", state: "closed", state_reason: "completed", closed_at: "2026-10-20T01:00:00Z", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-20T01:00:00Z", comments: 1, reactions: { total_count: 2 }, author_association: "NONE", user: { login: "reporter" } };
const comment = { id: 99, html_url: `${issue.html_url}#issuecomment-99`, body: "A bridge exists, but placement and native depth remain uncertain.", created_at: issue.created_at, updated_at: issue.updated_at, author_association: "CONTRIBUTOR", user: { login: "bridge-bot", type: "Bot" } };
function client(options: { comments?: Response | ((page: number) => Response); private?: boolean; rawIssue?: object } = {}) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/comments")) { expect(url.searchParams.get("per_page")).toBe("10"); return typeof options.comments === "function" ? options.comments(Number(url.searchParams.get("page"))) : options.comments?.clone() ?? Response.json([comment]); }
    if (url.pathname.endsWith("/issues/7")) return Response.json(options.rawIssue ?? issue);
    return Response.json({ id: 42, private: options.private ?? false });
  });
  return { api: new GitHubClient({ fetcher: fetcher as typeof fetch }), fetcher };
}

it("refreshes public Issue state and comments with source identity without treating closure as a verified fix", async () => {
  const { api, fetcher } = client();
  const context = await api.collectIssueContext("sample/editor", 7);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(context).toMatchObject({ issue: { state: "closed", stateReason: "completed", closedAt: issue.closed_at, authorLogin: "reporter", bodyExcerpt: issue.body }, comments: [{ id: 99, url: comment.html_url, isBot: true, authorAssociation: "CONTRIBUTOR" }], commentSampling: "all", commentsComplete: true, commentsError: null });
  expect(context.commentsObservedAt).toBe(context.observedAt);
});

it("bounds bodies and flags pagination, missing comments and truncation", async () => {
  const { api } = client({ rawIssue: { ...issue, body: "x".repeat(9000), comments: 2 }, comments: Response.json([{ ...comment, body: "x".repeat(2500) }]) });
  const context = await api.collectIssueContext("sample/editor", 7);
  expect(context.issue.bodyExcerpt).toHaveLength(8000);
  expect(context.issue.bodyTruncated).toBe(true);
  expect(context.comments[0]?.bodyExcerpt).toHaveLength(2000);
  expect(context.comments[0]?.bodyTruncated).toBe(true);
  expect(context.commentsComplete).toBe(false);
  expect(context.commentSampling).toBe("first");
});

function pageResponse(page: number, total = 22, transform = (entry: typeof comment) => entry) {
  const entries = Array.from({ length: Math.max(0, Math.min(10, total - (page - 1) * 10)) }, (_, index) => {
    const id = (page - 1) * 10 + index + 1;
    return transform({ ...comment, id, html_url: `${issue.html_url}#issuecomment-${id}`, body: id === total ? "Maintainer: the proposed integration already exists; do not build it again." : `Comment ${id}` });
  });
  const endpoint = "https://api.github.com/repos/sample/editor/issues/7/comments?per_page=10&page=";
  return Response.json(entries, { headers: page < Math.ceil(total / 10) ? { link: `<${endpoint}${page + 1}>; rel="next", <${endpoint}${Math.ceil(total / 10)}>; rel="last"` } : {} });
}

it.each([11, 20, 22, 29, 103])("includes the latest counterevidence in a %i-reply discussion with at most three page reads", async (total) => {
  const { api, fetcher } = client({ rawIssue: { ...issue, comments: total }, comments: (page) => pageResponse(page, total) });
  const context = await api.collectIssueContext("sample/editor", 7);
  expect(context.comments.map((entry) => entry.id)).toEqual([1, 2, 3, 4, 5, total - 4, total - 3, total - 2, total - 1, total]);
  expect(context.comments.at(-1)?.bodyExcerpt).toContain("already exists");
  expect(context).toMatchObject({ commentSampling: "first-and-latest", commentsComplete: false, commentsError: null });
  const pages = fetcher.mock.calls.map(([url]) => new URL(String(url))).filter((url) => url.pathname.endsWith("/comments")).map((url) => Number(url.searchParams.get("page")));
  expect(pages[0]).toBe(1);
  expect(pages[1]).toBe(Math.ceil(total / 10));
  expect(pages.length).toBeLessThanOrEqual(3);
});

it("uses the current pagination boundary when the Issue count has changed without claiming completeness", async () => {
  const { api } = client({ rawIssue: { ...issue, comments: 18 }, comments: (page) => pageResponse(page, 22) });
  const context = await api.collectIssueContext("sample/editor", 7);
  expect(context.comments.at(-1)?.id).toBe(22);
  expect(context.commentsComplete).toBe(false);
});

it("accepts GitHub's numeric-repository pagination only for the verified repository and selected Issue", async () => {
  for (const [path, expectedError] of [["repositories/42/issues/7/comments", false], ["repositories/43/issues/7/comments", true], ["repositories/42/issues/8/comments", true]] as const) {
    const { api, fetcher } = client({ rawIssue: { ...issue, comments: 22 }, comments: (page) => {
      const response = pageResponse(page);
      const link = response.headers.get("link");
      if (link) response.headers.set("link", link.replaceAll("repos/sample/editor/issues/7/comments", path));
      return response;
    } });
    const context = await api.collectIssueContext("sample/editor", 7);
    expect(Boolean(context.commentsError)).toBe(expectedError);
    if (!expectedError) expect(context.comments.at(-1)?.id).toBe(22);
    expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).pathname.startsWith("/repos/sample/editor"))).toBe(true);
  }
});

it("deduplicates overlapping page contents without presenting a complete discussion", async () => {
  const { api } = client({ rawIssue: { ...issue, comments: 20 }, comments: (page) => pageResponse(page, 20, (entry) => entry.id === 16 ? { ...entry, id: 5 } : entry) });
  const context = await api.collectIssueContext("sample/editor", 7);
  const ids = context.comments.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain(20);
  expect(context.commentsComplete).toBe(false);
});

it.each(["failed-tail", "moving-tail", "empty-tail", "foreign-link"])("keeps a failed comments boundary visible: %s", async (kind) => {
  const { api, fetcher } = client({ rawIssue: { ...issue, comments: 20 }, comments: (page) => {
    if (page === 1 && kind === "foreign-link") return Response.json([], { headers: { link: '<https://untrusted.test/steal?per_page=10&page=2>; rel="last", <https://untrusted.test/steal>; rel="next"' } });
    if (page > 1 && kind === "failed-tail") return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
    if (page > 1 && kind === "empty-tail") return Response.json([]);
    return pageResponse(page, kind === "moving-tail" && page > 1 ? 30 : 20);
  } });
  const context = await api.collectIssueContext("sample/editor", 7);
  expect(context.commentsError).toBeTruthy();
  expect(context.commentsObservedAt).toBeNull();
  expect(context.commentsComplete).toBe(false);
  expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).origin === "https://api.github.com")).toBe(true);
  expect(fetcher.mock.calls.length).toBeLessThanOrEqual(4);
});

it("returns a partial context when comments fail instead of inventing zero replies", async () => {
  const { api } = client({ comments: new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }) });
  const context = await api.collectIssueContext("sample/editor", 7);
  expect(context.issue.comments).toBe(1);
  expect(context.commentsComplete).toBe(false);
  expect(context.commentsError).toContain("rate limit");
  expect(context.commentsObservedAt).toBeNull();
});

it("rejects private repositories and pull requests before reading discussion bodies", async () => {
  const privateClient = client({ private: true });
  await expect(privateClient.api.collectIssueContext("sample/editor", 7)).rejects.toThrow("Only public");
  expect(privateClient.fetcher).toHaveBeenCalledTimes(1);
  const pull = client({ rawIssue: { ...issue, pull_request: { url: "https://api.github.com/pull/7" } } });
  await expect(pull.api.collectIssueContext("sample/editor", 7)).rejects.toThrow("not the selected Issue");
  expect(pull.fetcher).toHaveBeenCalledTimes(2);
});

it("does not mark inconsistent counts as a complete discussion", async () => {
  const { api } = client({ rawIssue: { ...issue, comments: 2 } });
  expect((await api.collectIssueContext("sample/editor", 7)).commentsComplete).toBe(false);
});
