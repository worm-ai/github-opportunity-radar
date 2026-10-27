import { expect, it } from "vitest";
import { researchSources } from "./research.js";
import { boundedIssueBody, issueBodyDescription } from "./issues.js";
import type { IssueContext } from "./issues.js";

it("retains checked origins after sample rotation without duplicating or reviving stale comments", () => {
  const issue = { id: 7, number: 7, title: "Retained origin", bodyExcerpt: "The original saved problem remains available.", bodyTruncated: false, url: "https://github.com/sample/app/issues/7", state: "open" as const, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z", comments: 1, reactions: 0, authorAssociation: "NONE", stateReason: null, closedAt: null };
  const context: IssueContext = { issue, comments: [{ id: 99, url: issue.url + "#issuecomment-99", bodyExcerpt: "A retained comment with a real source.", bodyTruncated: false, authorLogin: null, authorAssociation: "NONE", isBot: false, createdAt: issue.createdAt, updatedAt: issue.updatedAt }], commentsComplete: true, commentsError: null, commentsObservedAt: "2026-10-20T01:00:00Z", observedAt: "2026-10-20T01:00:00Z" };
  const project = { id: "1", fullName: "sample/app", url: "https://github.com/sample/app", description: null, readmeExcerpt: null, observedAt: "2026-10-22T00:00:00Z", issuesFetchedAt: "2026-10-22T00:00:00Z", issues: [], issueContexts: { "7": context } };
  const retained = researchSources([project]);
  expect(retained.map(s => s.ref.kind)).toEqual(["issue", "comment"]);
  expect(retained[0]?.observedAt).toBe(context.observedAt);
  expect(researchSources([{ ...project, issues: [issue] }])).toEqual(retained);
  const newer = { ...issue, bodyExcerpt: "A newer sampled body supersedes the old discussion.", updatedAt: "2026-10-21T00:00:00Z" };
  const sampled = researchSources([{ ...project, issues: [newer] }]);
  expect(sampled).toHaveLength(1);
  expect(sampled[0]?.text).toContain(newer.bodyExcerpt);
  expect(researchSources([{ ...project, issueContexts: { "7": { ...context, newestSampleUpdatedAt: newer.updatedAt } } }])).toEqual([]);
  const failed = researchSources([{ ...project, issueContexts: { "7": { ...context, commentsError: "refresh failed" } } }]);
  expect(failed.map(s => s.ref.kind)).toEqual(["issue"]);
  expect(failed[0]?.notice).toContain("评论读取失败");
});

it.each([
  [2000, false, 2000, false], [2001, false, 2000, true],
  [2000, true, 2000, true], [2000, undefined, 2000, null], [2001, undefined, 2000, true],
] as const)("preserves completeness across another text budget (%i, %s)", (length, previous, limit, truncated) => {
  const source = { bodyExcerpt: "x".repeat(length), ...(previous === undefined ? {} : { bodyTruncated: previous }) };
  expect(boundedIssueBody(source, limit)).toEqual({ bodyExcerpt: "x".repeat(Math.min(length, limit)), bodyTruncated: truncated });
});

it("describes actual stored lengths without equating missing flags with completeness", () => {
  expect(issueBodyDescription({ bodyExcerpt: "x".repeat(8000), bodyTruncated: true })).toContain("8,000");
  expect(issueBodyDescription({ bodyExcerpt: "x".repeat(2000), bodyTruncated: false })).toContain("正文未截断");
  expect(issueBodyDescription({ bodyExcerpt: "x".repeat(2000) })).toContain("未记录正文截断状态");
});

it("carries sampled Issue truncation status into research provenance, preserving legacy uncertainty", () => {
  const project = { id: "1", fullName: "sample/app", url: "https://github.com/sample/app", description: null, readmeExcerpt: null, observedAt: "2026-10-22T00:00:00Z", issuesFetchedAt: "2026-10-22T00:00:00Z", issues: [{ number: 7, title: "Long report", bodyExcerpt: "x".repeat(2000), bodyTruncated: true, url: "https://github.com/sample/app/issues/7", updatedAt: "2026-10-21T00:00:00Z" }] };
  const [truncated] = researchSources([project]);
  expect(truncated?.notice).toContain("正文截断");
  expect(truncated?.text).toContain("x".repeat(2000));
  const legacyIssue = { ...project.issues[0]! };
  Reflect.deleteProperty(legacyIssue, "bodyTruncated");
  const [legacy] = researchSources([{ ...project, issues: [legacyIssue] }]);
  expect(legacy?.notice).toContain("正文截断状态未知（旧档案）");
  expect(legacy?.notice).not.toContain("正文未截断");
  const [complete] = researchSources([{ ...project, issues: [{ ...project.issues[0]!, bodyTruncated: false }] }]);
  expect(complete?.notice).toContain("正文未截断");
});

it("keeps historical HEAD notices stable and binds pinned research evidence to its own version", () => {
  const document = { path: "docs/api.md", url: "https://github.com/sample/chart/blob/HEAD/docs/api.md", sha: "a".repeat(40), excerpt: "SVG export is documented.", observedAt: "2026-10-21T00:00:00Z" };
  const project = { id: "42", fullName: "sample/chart", url: "https://github.com/sample/chart", description: null, readmeExcerpt: null, observedAt: document.observedAt, documentation: { documents: [document], attemptedPaths: [document.path], warnings: [], observedAt: document.observedAt } };
  const legacy = researchSources([project])[0]!;
  expect(legacy.notice).toBe(`文档摘录；Blob ${document.sha}；链接指向可变 HEAD，未做运行验证。`);
  const commitSha = "b".repeat(40), pinned = { ...document, ref: "v1", commitSha, url: document.url.replace("HEAD", commitSha) };
  // The report may describe a newer, failed request. Each retained file has its own provenance.
  project.documentation = { ...project.documentation, documents: [pinned] };
  const source = researchSources([project])[0]!;
  expect(source.key).toBe(legacy.key);
  expect(source.notice).toContain(`版本 v1；固定提交 ${commitSha}`);
  expect(source.notice).toContain("未验证安装运行、发行状态或接口兼容性");
  expect(source.notice).not.toContain("可变 HEAD");
  expect(source.url).toBe(pinned.url);
});
