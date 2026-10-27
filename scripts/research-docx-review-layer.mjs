// Read-only GitHub evidence for the document review-layer hypothesis.
// It records issue/source snapshots and never calls a model or writes production data.
import { mkdirSync, writeFileSync } from "node:fs";

process.loadEnvFile(".env");
const headers = {
  accept: "application/vnd.github+json",
  "user-agent": "github-opportunity-radar-research",
  ...(process.env.GITHUB_TOKEN?.trim() ? { authorization: `Bearer ${process.env.GITHUB_TOKEN.trim()}` } : {}),
};
const base = "https://api.github.com/repos/firecrawl/anydoc";
async function get(path) {
  const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(25_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: GitHub ${response.status} ${body.message ?? "request failed"}`);
  return body;
}
async function search(query) {
  const response = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=30`, { headers, signal: AbortSignal.timeout(25_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`search: GitHub ${response.status} ${body.message ?? "request failed"}`);
  return body;
}
const issues = [];
for (const number of [191, 202, 203]) {
  const [issue, comments] = await Promise.all([get(`/issues/${number}`), get(`/issues/${number}/comments`)]);
  issues.push({ number, title: issue.title, state: issue.state, stateReason: issue.state_reason, author: issue.user?.login ?? null, authorAssociation: issue.author_association, updatedAt: issue.updated_at, comments: comments.length, body: issue.body ?? "", url: issue.html_url });
}
const sources = [];
for (const path of ["src/formats/docx/content.rs", "src/package/relationships.rs"]) {
  const file = await get(`/contents/${path}`);
  const source = Buffer.from(file.content, "base64").toString("utf8");
  sources.push({ path, blobSha: file.sha, size: file.size, terms: Object.fromEntries(["commentRange", "commentReference", "comments.xml", "revision", "w:ins", "w:del"].map((term) => [term, source.toLowerCase().includes(term.toLowerCase())])) });
}
const pullSearch = await search("repo:firecrawl/anydoc comments is:pull-request");
const result = {
  observedAt: new Date().toISOString(),
  repository: "firecrawl/anydoc",
  issues,
  sourceFiles: sources,
  pullRequestSearch: { query: "repo:firecrawl/anydoc comments is:pull-request", total: pullSearch.total_count, matches: (pullSearch.items ?? []).filter((item) => /comments?\.xml|commentrange|issue\s*#?191|#191\b/i.test(`${item.title} ${item.body ?? ""}`)).map((item) => ({ number: item.number, title: item.title, state: item.state, mergedAt: item.pull_request?.merged_at ?? null, url: item.html_url })) },
  limits: ["Issue authors are not independent customer samples.", "Open or absent PR evidence does not prove that a release has or has not fixed the behavior.", "Source blobs are a code indicator, not a complete runtime compatibility or market test.", "No external message was sent and no private document was read."],
};
mkdirSync(".data/research", { recursive: true });
writeFileSync(".data/research/2026-10-22-docx-review-layer.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ observedAt: result.observedAt, issues: issues.map(({ number, state, comments, authorAssociation }) => ({ number, state, comments, authorAssociation })), sourceFiles: sources, pullRequestSearch: result.pullRequestSearch }));
