import { expect, it, vi } from "vitest";
import { GitHubApiError, GitHubClient } from "./index.js";
import { collectReferencedPullRequests, referencedNumbers } from "./pull-requests.js";

const raw = (number: number) => ({ number, title: "Expose PDF validation errors", body: "Render the validator's existing error details.", state: "closed" as const, draft: false, merged: true,
  merged_at: "2026-10-19T13:37:27Z", merge_commit_sha: "a".repeat(40), updated_at: "2026-10-20T00:00:00Z", base: { repo: { full_name: "sample/invoice", private: false } } });

it("only recognizes same-repository prose references, deduplicates them and preserves mention order", () => {
  const text = "See #14 then https://github.com/sample/invoice/pull/15. #14 and sample/other#16; https://github.com/other/repo/pull/17#18 https://evil.invalid/#19 `#20` ```js\n#21\n``` #7 https://github.com:123/sample/invoice/pull/22 https://user@github.com/sample/invoice/pull/23";
  expect(referencedNumbers("sample/invoice", 7, text)).toEqual([14, 15]);
  expect(referencedNumbers("Sample/Invoice", 7, "https://github.com/sample/invoice/issues/14 #15")).toEqual([14, 15]);
});

it("bounds upstream reads to three and keeps merge, closure and draft status distinct", async () => {
  const request = vi.fn(async (number: number) => number === 14 ? raw(number) : { ...raw(number), merged: false, merged_at: null, state: number === 15 ? "closed" as const : "open" as const, draft: number === 16 });
  const result = await collectReferencedPullRequests("sample/invoice", 7, "#14 #15 #16 #17 #18", request);
  expect(request.mock.calls.map(([number]) => number)).toEqual([14, 15, 16]);
  expect(result).toMatchObject({ checkedNumbers: [14, 15, 16], omitted: 2, items: [{ number: 14, merged: true }, { number: 15, merged: false, state: "closed" }, { number: 16, merged: false, state: "open", draft: true }] });
});

it("reports unavailable references and stops upstream requests after a rate limit", async () => {
  const request = vi.fn(async (number: number) => { throw new GitHubApiError("Unavailable", number === 14 ? "not_found" : "rate_limited"); });
  const result = await collectReferencedPullRequests("sample/invoice", 7, "#14 #15 #16", request);
  expect(request).toHaveBeenCalledTimes(2);
  expect(result.items).toEqual([]);
  expect(result.notFoundNumbers).toEqual([14]);
  expect(result.errors.map((error) => error.number)).toEqual([15, 16]);
});

it.each(["private", "other-repository", "wrong-number", "invalid-merge"])("rejects %s PR metadata", async (kind) => {
  const response = { ...raw(14), ...(kind === "private" ? { base: { repo: { full_name: "sample/invoice", private: true } } } : {}), ...(kind === "other-repository" ? { base: { repo: { full_name: "other/repo", private: false } } } : {}), ...(kind === "wrong-number" ? { number: 15 } : {}), ...(kind === "invalid-merge" ? { merged_at: null } : {}) };
  const result = await collectReferencedPullRequests("sample/invoice", 7, "#14", async () => response);
  expect(result.items).toEqual([]); expect(result.errors).toHaveLength(1);
});

it("collects referenced PRs through the configured API and retains comments when a PR fetch fails", async () => {
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input)); paths.push(url.pathname);
    expect(url.origin).toBe("http://fixture.local");
    if (url.pathname.endsWith("/comments")) return Response.json([{ id: 99, body: "I opened #14 and #15. https://other.invalid/pull/16", html_url: "https://github.com/sample/invoice/issues/7#issuecomment-99", created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T00:00:00Z" }]);
    if (url.pathname.endsWith("/pulls/14")) return Response.json(raw(14));
    if (url.pathname.endsWith("/pulls/15")) return Response.json({}, { status: 404 });
    if (url.pathname.endsWith("/issues/7")) return Response.json({ id: 7, number: 7, title: "Missing report errors", body: "Keep the human-facing details.", html_url: "https://github.com/sample/invoice/issues/7", state: "open", comments: 1, created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T00:00:00Z" });
    return Response.json({ id: 1, private: false });
  };
  const result = await new GitHubClient({ apiBase: "http://fixture.local", fetcher }).collectIssueContext("sample/invoice", 7);
  expect(result.commentsComplete).toBe(true);
  expect(result.referencedPullRequests).toMatchObject({ notFoundNumbers: [15], items: [{ number: 14, merged: true }] });
  expect(paths).toHaveLength(5);
});
