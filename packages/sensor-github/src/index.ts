import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import { readmeEvidenceExcerpt } from "@radar/contracts";
import { buildDiscoveryPlan, type DiscoveryProgress, type DiscoverySettings, type DiscoveryTrack } from "./discovery.js";
import { collectReferencedPullRequests } from "./pull-requests.js";
import { sourceInventory, sourceText, type SourceInventory } from "./source-study.js";
export type { SourceInventory, SourceText } from "./source-study.js";
export { advanceDiscoveryProgress, buildDiscoveryPlan, buildRepositorySearchQuery, maxDiscoveryPage, type DiscoveryProgress, type DiscoverySettings, type DiscoveryTrack } from "./discovery.js";

const maxResponseBytes = 16 * 1024 * 1024;
const certificateErrorCodes = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

let configuredCaPath: string | null = null;
let configuredCa: Buffer | null = null;

/**
 * Load an administrator-provided CA bundle without weakening TLS verification.
 * The value is read lazily because the server loads .env after this module is
 * imported. A CA file is deliberately opt-in; the default remains the OS/Node
 * trust store and the Windows HTTP transport.
 */
function githubCaBundle(): Buffer | undefined {
  const configuredPath = process.env.RADAR_GITHUB_CA_FILE?.trim();
  if (!configuredPath) return undefined;
  const path = resolve(configuredPath);
  if (configuredCaPath === path && configuredCa) return configuredCa;
  const ca = readFileSync(path);
  if (!ca.toString("ascii").includes("BEGIN CERTIFICATE")) {
    throw new Error("RADAR_GITHUB_CA_FILE must point to a PEM CA bundle");
  }
  configuredCaPath = path;
  configuredCa = ca;
  return ca;
}

function certificateErrorCode(error: unknown): string | null {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    if ("code" in error && typeof error.code === "string" && certificateErrorCodes.has(error.code)) return error.code;
    error = "cause" in error ? error.cause : null;
  }
  return null;
}

const powershellRequest = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$request = [Net.HttpWebRequest]::Create($env:RADAR_GITHUB_REQUEST_URL)
$request.Method = 'GET'
$request.Accept = $env:RADAR_GITHUB_ACCEPT
$request.UserAgent = $env:RADAR_GITHUB_USER_AGENT
$request.Headers.Add('X-GitHub-Api-Version', $env:RADAR_GITHUB_API_VERSION)
if ($env:GITHUB_TOKEN) { $request.Headers['Authorization'] = 'Bearer ' + $env:GITHUB_TOKEN }
$request.AllowAutoRedirect = $false
try { $response = $request.GetResponse() } catch [System.Net.WebException] { if ($_.Exception.Response) { $response = $_.Exception.Response } else { throw } }
$memory = New-Object System.IO.MemoryStream
$stream = $response.GetResponseStream()
if ($stream) { $stream.CopyTo($memory); $stream.Dispose() }
$responseHeaders = @{}
foreach ($name in $response.Headers.AllKeys) { $responseHeaders[$name] = $response.Headers[$name] }
$result = [ordered]@{ status = [int]$response.StatusCode; statusText = $response.StatusDescription; headers = $responseHeaders; body = [Convert]::ToBase64String($memory.ToArray()) }
[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 5))
$response.Dispose()
`;

function windowsHttpFetch(url: URL, headers: Headers, signal: AbortSignal | null, redirectMode: RequestRedirect, redirectsRemaining = 5): Promise<Response> {
  if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("GitHub request aborted"));
  const authorization = headers.get("authorization");
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    RADAR_GITHUB_REQUEST_URL: url.href,
    RADAR_GITHUB_ACCEPT: headers.get("accept") ?? "application/vnd.github+json",
    RADAR_GITHUB_API_VERSION: headers.get("x-github-api-version") ?? "2022-11-28",
    RADAR_GITHUB_USER_AGENT: headers.get("user-agent") ?? "github-opportunity-radar/0.1.0",
  };
  if (authorization?.startsWith("Bearer ")) childEnv.GITHUB_TOKEN = authorization.slice(7);
  else delete childEnv.GITHUB_TOKEN;

  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"], {
      env: childEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let outputTooLarge = false;
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => child.kill();
    child.stdout.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += bytes.byteLength;
      if (outputBytes > maxResponseBytes * 2) {
        outputTooLarge = true;
        child.kill();
        return;
      }
      chunks.push(bytes);
    });
    child.stderr.on("data", () => undefined);
    child.once("error", (error) => { cleanup(); reject(error); });
    child.stdin.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code) => {
      cleanup();
      if (outputTooLarge) { reject(new Error("GitHub response exceeded 16 MiB")); return; }
      if (code !== 0) { reject(new Error(`Windows HTTP fallback exited with code ${code ?? "unknown"}`)); return; }
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { status: number; statusText: string; headers: Record<string, string | string[]>; body: string };
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(result.headers)) {
          for (const headerValue of Array.isArray(value) ? value : [value]) responseHeaders.append(name, headerValue);
        }
        const bodyBytes = Buffer.from(result.body, "base64");
        if (bodyBytes.byteLength > maxResponseBytes) throw new Error("GitHub response exceeded 16 MiB");
        const status = Number(result.status);
        const body = [204, 205, 304].includes(status) ? null : new Uint8Array(bodyBytes);
        const response = new Response(body, { status, statusText: result.statusText ?? "", headers: responseHeaders });
        const location = response.headers.get("location");
        if ([301, 302, 303, 307, 308].includes(status) && location && redirectMode !== "manual") {
          if (redirectMode === "error" || redirectsRemaining <= 0) throw new TypeError("GitHub request exceeded the redirect limit");
          const nextUrl = new URL(location, url);
          if ((url.protocol === "https:" && nextUrl.protocol !== "https:") || !["http:", "https:"].includes(nextUrl.protocol)) throw new TypeError("GitHub request refused an insecure redirect");
          const nextHeaders = new Headers(headers);
          if (nextUrl.origin !== url.origin) nextHeaders.delete("authorization");
          resolve(windowsHttpFetch(nextUrl, nextHeaders, signal, redirectMode, redirectsRemaining - 1));
          return;
        }
        resolve(response);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Invalid Windows HTTP response"));
      }
    });
    if (signal) signal.addEventListener("abort", abort, { once: true });
    child.stdin.end(powershellRequest);
  });
}

const nodeHttpFetch: typeof fetch = (input, init) => {
  const requestInput = input instanceof Request ? input : null;
  const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
  const method = init?.method ?? requestInput?.method ?? "GET";
  const headers = new Headers(requestInput?.headers);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const signal = init?.signal ?? requestInput?.signal;
  const redirectMode = init?.redirect ?? requestInput?.redirect ?? "follow";

  if (url.protocol !== "https:" && url.protocol !== "http:") return Promise.reject(new TypeError("GitHub request URL must use HTTP or HTTPS"));
  if (init?.body != null) return Promise.reject(new TypeError("GitHub sensor requests do not support a request body"));

  const perform = (target: URL, requestHeaders: Headers, redirectsRemaining: number): Promise<Response> => new Promise((resolve, reject) => {
    let settled = false;
    let request: ReturnType<typeof httpRequest>;
    const cleanup = () => signal?.removeEventListener("abort", abortRequest);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abortRequest = () => request.destroy(signal?.reason instanceof Error ? signal.reason : new Error("GitHub request aborted"));
    const requestFn = target.protocol === "https:" ? httpsRequest : httpRequest;
    const ca = target.protocol === "https:" ? githubCaBundle() : undefined;
    request = requestFn(target, {
      method,
      headers: Object.fromEntries(requestHeaders.entries()),
      ...(ca ? { ca } : {}),
    }, (response) => {
      const chunks: Buffer[] = [];
      let byteLength = 0;
      response.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteLength += bytes.byteLength;
        if (byteLength > maxResponseBytes) {
          fail(new Error("GitHub response exceeded 16 MiB"));
          response.destroy();
          request.destroy();
          return;
        }
        chunks.push(bytes);
      });
      response.once("error", fail);
      response.once("end", async () => {
        if (settled) return;
        const status = response.statusCode ?? 502;
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location && redirectMode !== "manual") {
          if (redirectMode === "error" || redirectsRemaining <= 0) {
            fail(new TypeError("GitHub request exceeded the redirect limit"));
            return;
          }
          const nextUrl = new URL(location, target);
          if ((target.protocol === "https:" && nextUrl.protocol !== "https:") || !["http:", "https:"].includes(nextUrl.protocol)) {
            fail(new TypeError("GitHub request refused an insecure redirect"));
            return;
          }
          const nextHeaders = new Headers(requestHeaders);
          if (nextUrl.origin !== target.origin) nextHeaders.delete("authorization");
          settled = true;
          cleanup();
          try { resolve(await perform(nextUrl, nextHeaders, redirectsRemaining - 1)); }
          catch (error) { reject(error); }
          return;
        }

        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value === undefined) continue;
          for (const headerValue of Array.isArray(value) ? value : [value]) responseHeaders.append(name, headerValue);
        }
        const body = [204, 205, 304].includes(status) ? null : new Uint8Array(Buffer.concat(chunks));
        try {
          const result = new Response(body, { status, statusText: response.statusMessage ?? "", headers: responseHeaders });
          settled = true;
          cleanup();
          resolve(result);
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Invalid GitHub response"));
        }
      });
    });
    request.once("error", fail);
    if (signal) {
      if (signal.aborted) abortRequest();
      else signal.addEventListener("abort", abortRequest, { once: true });
    }
    request.end();
  });

  // Windows uses the OS HTTP stack for GitHub, with Node HTTP as a fallback.
  // An explicit CA bundle belongs to the Node transport, so skip PowerShell in
  // that mode; this keeps the configured trust source deterministic.
  if (!process.env.RADAR_GITHUB_CA_FILE?.trim() && process.platform === "win32" && url.hostname.toLowerCase() === "api.github.com") {
    return windowsHttpFetch(url, headers, signal ?? null, redirectMode).catch((error) => {
      if (signal?.aborted) throw error;
      return perform(url, headers, 5);
    });
  }
  return perform(url, headers, 5);
};

export { documentationPath, documentationRef, linkedDocumentation } from "./documentation.js";
import { documentationPath, documentationRef, linkedDocumentation } from "./documentation.js";
import type { RepositoryDocumentation, PublicIssue, IssueContext } from "@radar/contracts";

export type GitHubIssue = PublicIssue;
export type GitHubRepository = {
  id: number;
  fullName: string;
  description: string | null;
  language: string | null;
  license: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  createdAt: string;
  pushedAt: string | null;
  url: string;
  readmeExcerpt: string | null;
  releaseTag: string | null;
  releaseUrl: string | null;
  readmeFetchSucceeded?: boolean;
  releaseFetchSucceeded?: boolean;
  issues?: GitHubIssue[];
  issuesFetchSucceeded?: boolean;
  issuesFetchedAt?: string | null;
  discoveryChannels?: string[];
  documentation?: RepositoryDocumentation | null;
  issueContexts?: Record<string, IssueContext>;
  raw: unknown;
  warning: string | null;
};

export type RepositoryPreview = Pick<GitHubRepository, "id" | "fullName" | "description" | "language" | "license" | "stars" | "createdAt" | "pushedAt" | "url"> & { archived: boolean; fork: boolean };

export function repositoryName(input: string): string | null {
  let name = input.trim();
  if (name.startsWith("https://")) {
    try {
      const url = new URL(name);
      if (url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) return null;
      name = url.pathname.slice(1).replace(/\/$/, "");
    } catch { return null; }
  }
  name = name.replace(/\.git$/, "");
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(name) && ![".", ".."].includes(name.split("/")[1]!) ? name : null;
}

type GitHubSearchItem = {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  license: { spdx_id?: string | null } | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  created_at: string;
  pushed_at: string | null;
  default_branch: string;
  archived?: boolean;
  fork?: boolean;
  private?: boolean;
};

type GitHubRelease = { tag_name: string; html_url: string };
type GitHubIssueResponse = {
  id: number; number: number; title: string; body?: string | null; html_url: string;
  state: "open" | "closed"; created_at: string; updated_at: string; comments: number;
  reactions?: { total_count?: number }; author_association?: string; user?: { login?: string; type?: string } | null; pull_request?: unknown;
  state_reason?: string | null; closed_at?: string | null;
};
type GitHubComment = { id: number; html_url: string; body?: string; created_at: string; updated_at: string; author_association?: string; user?: { login?: string; type?: string } | null };

export class GitHubApiError extends Error {
  readonly code: "rate_limited" | "bad_query" | "not_found" | "upstream_error";

  constructor(message: string, code: GitHubApiError["code"], readonly retryAt: string | null = null) {
    super(message);
    this.name = "GitHubApiError";
    this.code = code;
  }
}

type ClientOptions = {
  token?: string;
  fetcher?: typeof fetch;
  apiBase?: string;
};

export class GitHubClient {
  private readonly fetcher: typeof fetch;
  private readonly apiBase: string;
  private deadlineAt = Infinity;

  constructor(private readonly options: ClientOptions = {}) {
    this.fetcher = options.fetcher ?? nodeHttpFetch;
    this.apiBase = options.apiBase ?? "https://api.github.com";
  }

  async checkSearchAccess(): Promise<void> {
    const previous = this.deadlineAt;
    this.deadlineAt = Math.min(previous, Date.now() + 8000);
    try {
      const payload = await this.request<{ resources?: { search?: { remaining?: number; reset?: number } } }>(new URL(`${this.apiBase}/rate_limit`));
      const quota = payload.resources?.search;
      if (!quota || !Number.isInteger(quota.remaining) || quota.remaining! < 0) throw new GitHubApiError("GitHub returned an invalid search quota response", "upstream_error");
      if (quota.remaining === 0) {
        const reset = quota.reset;
        const retryAt = typeof reset === "number" && Number.isFinite(reset) && reset > 0 && reset < 8640000000000 ? new Date(reset * 1000).toISOString() : null;
        throw new GitHubApiError("GitHub search quota is exhausted", "rate_limited", retryAt);
      }
    } finally { this.deadlineAt = previous; }
  }

  async sourceInventory(fullName: string) {
    const previous = this.deadlineAt;
    this.deadlineAt = Math.min(previous, Date.now() + 60000);
    try { return await sourceInventory(fullName, url => this.request(url), this.apiBase); }
    finally { this.deadlineAt = previous; }
  }

  async sourceText(inventory: SourceInventory, path: string, maxChars?: number, startLine?: number) {
    return sourceText(inventory, path, url => this.request(url), this.apiBase, maxChars, startLine);
  }

  async findRepositories(query: string) {
    if (query.trim().length < 2 || query.trim().length > 256) throw new Error("Provide a GitHub query of 2 to 256 characters");
    const url = new URL(`${this.apiBase}/search/repositories`);
    url.searchParams.set("q", `${query.trim()} is:public`);
    url.searchParams.set("per_page", "6");
    const payload = await this.request<{ items: GitHubSearchItem[]; total_count: number; incomplete_results: boolean }>(url);
    const items: RepositoryPreview[] = payload.items.filter((item) => item.private !== true).slice(0, 6).map((item) => ({
      id: item.id, fullName: item.full_name, description: item.description, language: item.language,
      license: item.license?.spdx_id && item.license.spdx_id !== "NOASSERTION" ? item.license.spdx_id : null,
      stars: item.stargazers_count, createdAt: item.created_at, pushedAt: item.pushed_at, url: item.html_url,
      archived: item.archived === true, fork: item.fork === true,
    }));
    return { query: query.trim(), items, total: payload.total_count, incomplete: payload.incomplete_results, observedAt: new Date().toISOString() };
  }

  async collectRepository(input: string): Promise<GitHubRepository> {
    const name = repositoryName(input);
    if (!name) throw new Error("Provide an owner/repository name or a GitHub repository URL");
    const previousDeadline = this.deadlineAt;
    this.deadlineAt = Math.min(previousDeadline, Date.now() + 60_000);
    try {
      const item = await this.request<GitHubSearchItem>(new URL(`${this.apiBase}/repos/${name}`));
      if (item.private === true) throw new GitHubApiError("Only public repositories can be collected", "bad_query");
      return { ...await this.enrich(item, true), discoveryChannels: ["按需收录"] };
    } finally { this.deadlineAt = previousDeadline; }
  }

  async collectIssueContext(fullName: string, number: number, options: { throwOnRateLimit?: boolean } = {}): Promise<IssueContext> {
    const name = repositoryName(fullName);
    if (!name || !Number.isSafeInteger(number) || number <= 0) throw new Error("Provide a repository name and positive Issue number");
    const previousDeadline = this.deadlineAt;
    this.deadlineAt = Math.min(previousDeadline, Date.now() + 60_000);
    try {
      const repository = await this.request<GitHubSearchItem>(new URL(`${this.apiBase}/repos/${name}`));
      if (repository.private === true) throw new GitHubApiError("Only public Issue discussions can be collected", "bad_query");
      const raw = await this.request<GitHubIssueResponse>(new URL(`${this.apiBase}/repos/${name}/issues/${number}`));
      if (raw.pull_request || raw.number !== number) throw new GitHubApiError("The requested resource is not the selected Issue", "bad_query");
      const issue: IssueContext["issue"] = {
        id: raw.id, number: raw.number, title: raw.title, bodyExcerpt: (raw.body ?? "").slice(0, 8000), bodyTruncated: (raw.body?.length ?? 0) > 8000,
        url: raw.html_url, state: raw.state, stateReason: raw.state_reason ?? null, closedAt: raw.closed_at ?? null,
        createdAt: raw.created_at, updatedAt: raw.updated_at, comments: raw.comments, reactions: raw.reactions?.total_count ?? 0,
        authorLogin: raw.user?.login ?? null, authorAssociation: raw.author_association ?? "UNKNOWN",
      };
      let comments: IssueContext["comments"] = [], commentsComplete = false, commentsError: string | null = null;
      let commentSampling: IssueContext["commentSampling"] = "first";
      try {
        const endpoint = new URL(`${this.apiBase}/repos/${name}/issues/${number}/comments`);
        const readPage = async (page: number) => {
          const url = new URL(endpoint);
          url.searchParams.set("per_page", "10"); url.searchParams.set("page", String(page));
          const response = await this.fetchResponse(url.toString());
          if (!response.ok) throw this.errorFrom(response);
          const entries = await response.json() as GitHubComment[];
          if (!Array.isArray(entries) || entries.length > 10) throw new Error("Unexpected Issue comment page");
          return { entries, link: response.headers.get("link") ?? "" };
        };
        const first = await readPage(1);
        let entries = first.entries;
        const hasNext = /rel="next"/.test(first.link);
        commentsComplete = !hasNext && new Set(entries.map((entry) => entry.id)).size === entries.length && entries.length === raw.comments;
        if (commentsComplete) commentSampling = "all";
        if (hasNext) {
          // Parse a page number only; never follow an upstream URL with the GitHub token.
          const lastLink = first.link.split(",").find((link) => /rel="last"/.test(link))?.match(/<([^>]+)>/)?.[1];
          let lastPage = Math.ceil(raw.comments / 10);
          if (lastLink) {
            const parsed = new URL(lastLink);
            const canonicalPath = Number.isSafeInteger(repository.id) && repository.id > 0 ? `/repositories/${repository.id}/issues/${number}/comments` : null;
            if (parsed.origin !== endpoint.origin || (parsed.pathname !== endpoint.pathname && parsed.pathname !== canonicalPath) || parsed.searchParams.get("per_page") !== "10") throw new Error("Unexpected Issue comment pagination");
            lastPage = Number(parsed.searchParams.get("page"));
          }
          if (!Number.isSafeInteger(lastPage) || lastPage < 2) throw new Error("Issue comment pagination changed during collection; refresh the discussion");
          const last = await readPage(lastPage);
          if (!last.entries.length || /rel="next"/.test(last.link)) throw new Error("Issue comment pagination changed during collection; refresh the discussion");
          const previous = last.entries.length < 5 ? lastPage === 2 ? first : await readPage(lastPage - 1) : null;
          // A changing page boundary must not silently turn an early page into the latest sample.
          if (previous && previous.entries.length !== 10) throw new Error("Issue comment pagination changed during collection; refresh the discussion");
          const tail = [...(previous?.entries ?? []), ...last.entries].slice(-5);
          entries = [...first.entries.slice(0, 5), ...tail];
          commentSampling = "first-and-latest";
        }
        comments = [...new Map(entries.map((entry) => [entry.id, entry])).values()]
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id).slice(0, 10).map((comment) => ({ id: comment.id, url: comment.html_url, bodyExcerpt: (comment.body ?? "").slice(0, 2000), bodyTruncated: (comment.body?.length ?? 0) > 2000,
          authorLogin: comment.user?.login ?? null, authorAssociation: comment.author_association ?? "UNKNOWN", isBot: comment.user?.type === "Bot", createdAt: comment.created_at, updatedAt: comment.updated_at }));
      } catch (error) {
        if (options.throwOnRateLimit && error instanceof GitHubApiError && error.code === "rate_limited") throw error;
        commentsComplete = false; commentsError = error instanceof Error ? error.message : "Issue comments unavailable";
      }
      const referencedPullRequests = await collectReferencedPullRequests(name, number, [issue.bodyExcerpt, ...(commentsError ? [] : comments.map((comment) => comment.bodyExcerpt))].join("\n"), (pullNumber) => this.request(new URL(`${this.apiBase}/repos/${name}/pulls/${pullNumber}`)), options.throwOnRateLimit);
      const observedAt = new Date().toISOString();
      return { issue, comments, commentSampling, commentsComplete, commentsError, commentsObservedAt: commentsError ? null : observedAt, referencedPullRequests, observedAt };
    } finally { this.deadlineAt = previousDeadline; }
  }

  async collectDocumentation(fullName: string, explicitPaths?: string[], ref?: string): Promise<RepositoryDocumentation> {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new Error("Invalid GitHub repository name");
    if (ref !== undefined && !documentationRef(ref)) throw new Error("Provide a valid repository tag, branch or commit ref");
    const normalized = explicitPaths?.map(documentationPath);
    if (normalized && (normalized.some((path) => !path) || normalized.length > 2)) throw new Error("Provide at most two repository text-document paths");
    const previousDeadline = this.deadlineAt;
    this.deadlineAt = Math.min(previousDeadline, Date.now() + 60_000);
    try {
      const observedAt = new Date().toISOString();
      let commitSha: string | undefined;
      if (ref !== undefined) {
        const commit = await this.request<{ sha?: string }>(new URL(`${this.apiBase}/repos/${fullName}/commits/${encodeURIComponent(ref)}?per_page=1`));
        if (!/^[a-f0-9]{40,64}$/i.test(commit.sha ?? "")) throw new GitHubApiError("GitHub did not resolve the requested documentation version to a commit", "upstream_error");
        commitSha = commit.sha!.toLowerCase();
      }
      const version = commitSha ? { ref: ref!, commitSha } : {};
      const contentUrl = (path: string) => {
        const url = new URL(`${this.apiBase}/repos/${fullName}/${path}`);
        if (commitSha) url.searchParams.set("ref", commitSha);
        return url;
      };
      let paths: string[];
      if (explicitPaths?.length) {
        paths = [...new Set(normalized as string[])];
      } else {
        const readme = await this.request<{ content?: string; encoding?: string; path?: string; html_url?: string }>(contentUrl("readme"));
        const decoded = readme.encoding === "base64" ? Buffer.from(readme.content ?? "", "base64").toString("utf8") : readme.content ?? "";
        paths = linkedDocumentation(fullName, decoded.slice(0, 200_000), readme.path ?? "README.md", readme.html_url);
      }
      const results = await Promise.allSettled(paths.map(async (path) => {
        const file = await this.request<{ type?: string; content?: string; encoding?: string; sha?: string; size?: number }>(contentUrl(`contents/${path.split("/").map(encodeURIComponent).join("/")}`));
        if (file.type !== "file" || file.encoding !== "base64" || !file.content || !/^[a-f0-9]{40,64}$/i.test(file.sha ?? "") || (file.size ?? 0) > 512_000) throw new Error("Not a supported text document (maximum 512 KB)");
        const bytes = Buffer.from(file.content, "base64");
        if (bytes.length > 512_000) throw new Error("Document exceeds the 512 KB limit");
        const decoded = bytes.toString("utf8");
        if (decoded.includes("\0")) throw new Error("Binary content is not documentation");
        return { path, url: `https://github.com/${fullName}/blob/${commitSha ?? "HEAD"}/${path.split("/").map(encodeURIComponent).join("/")}`, sha: file.sha!, excerpt: readmeEvidenceExcerpt(decoded, 8000), observedAt: new Date().toISOString(), stale: false, ...version };
      }));
      return {
        documents: results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []), attemptedPaths: paths,
        warnings: results.flatMap((result, index) => result.status === "rejected" ? [`${paths[index]}: ${result.reason instanceof Error ? result.reason.message : "Document unavailable"}`] : []), observedAt, ...version,
      };
    } finally { this.deadlineAt = previousDeadline; }
  }

  async search(query: string, limit: number, sort: DiscoveryTrack["sort"] = "created"): Promise<GitHubRepository[]> {
    return (await this.searchPage(query, limit, sort, 1)).repositories;
  }

  private async searchPage(query: string, limit: number, sort: DiscoveryTrack["sort"], page: number) {
    const url = new URL(`${this.apiBase}/search/repositories`);
    url.searchParams.set("q", query);
    url.searchParams.set("sort", sort);
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", String(Math.min(Math.max(limit, 1), 60)));
    url.searchParams.set("page", String(page));
    const payload = await this.request<{ items: GitHubSearchItem[]; total_count?: number; incomplete_results?: boolean }>(url);
    payload.items = payload.items.slice(0, limit);
    const repositories: GitHubRepository[] = [];

    for (let offset = 0; offset < payload.items.length; offset += 2) {
      if (Date.now() >= this.deadlineAt) {
        repositories.push(...payload.items.slice(offset).map((item) => this.fromSearchItem(item, "Detail enrichment skipped: discovery time budget exhausted")));
        break;
      }
      const batch = await Promise.all(payload.items.slice(offset, offset + 2).map((item) => this.enrich(item)));
      repositories.push(...batch);
      const rateLimitWarning = batch.find((repository) => repository.warning?.includes("rate limit"))?.warning;
      if (rateLimitWarning) {
        repositories.push(...payload.items.slice(offset + batch.length).map((item) => this.fromSearchItem(item, `README and Release enrichment skipped: ${rateLimitWarning}`)));
        break;
      }
    }

    const totalCount = Number.isSafeInteger(payload.total_count) && payload.total_count! >= 0 ? payload.total_count : undefined;
    return { repositories, totalCount, incomplete: payload.incomplete_results === true, hasMore: payload.items.length > 0 && (totalCount === undefined ? payload.items.length === limit : page * limit < Math.min(1000, totalCount)) };
  }

  async discover(settings: DiscoverySettings, progress: DiscoveryProgress = {}, now = new Date()) {
    // Bound collection as a whole, including retries, independently of later model analysis.
    this.deadlineAt = Date.now() + 180_000;
    try { return await this.discoverWithinBudget(buildDiscoveryPlan(settings, now, progress)); }
    finally { this.deadlineAt = Infinity; }
  }

  private async discoverWithinBudget(tracks: DiscoveryTrack[]) {
    const buckets: GitHubRepository[][] = [];
    const warnings: string[] = [];
    let succeeded = 0;
    // Search has a separate per-minute quota; bounded sequential tracks avoid bursts.
    for (const track of tracks) {
      try {
        const result = await this.searchPage(track.query, track.limit, track.sort, track.page ?? 1);
        const { repositories } = result;
        track.found = repositories.length;
        if (result.totalCount !== undefined) track.totalCount = result.totalCount;
        track.hasMore = result.hasMore;
        track.incomplete = result.incomplete;
        track.searchComplete = !result.incomplete && repositories.every((repository) => !repository.warning);
        if (result.incomplete) warnings.push(`${track.label}: GitHub returned incomplete search results; this page will be retried`);
        buckets.push(repositories.map((repository) => ({ ...repository, discoveryChannels: [track.label] })));
        succeeded += 1;
      } catch (error) {
        track.error = error instanceof Error ? error.message : "GitHub discovery failed";
        warnings.push(`${track.label}: ${track.error}`);
        buckets.push([]);
        if (error instanceof GitHubApiError && error.code === "rate_limited" || Date.now() >= this.deadlineAt) {
          for (const skipped of tracks.slice(tracks.indexOf(track) + 1)) skipped.error = "Skipped after rate limit or discovery time budget exhausted";
          break;
        }
      }
    }
    if (!succeeded) throw Object.assign(new GitHubApiError(warnings.join("; ") || "No discovery query completed", "upstream_error"), { tracks });
    const repositories = new Map<number, GitHubRepository>();
    for (let row = 0; row < Math.max(0, ...buckets.map((bucket) => bucket.length)); row++) {
      for (const bucket of buckets) {
        const repository = bucket[row];
        if (!repository) continue;
        const previous = repositories.get(repository.id);
        if (previous) previous.discoveryChannels = [...new Set([...(previous.discoveryChannels ?? []), ...(repository.discoveryChannels ?? [])])];
        else repositories.set(repository.id, repository);
      }
    }
    return { repositories: [...repositories.values()], tracks, warnings };
  }

  private async enrich(item: GitHubSearchItem, failOnRateLimit = false): Promise<GitHubRepository> {
    const [readmeResult, releaseResult, issuesResult] = await Promise.allSettled([
      this.readme(item.full_name),
      this.latestRelease(item.full_name),
      this.publicIssues(item.full_name),
    ]);
    if (failOnRateLimit) {
      for (const result of [readmeResult, releaseResult, issuesResult]) {
        if (result.status === "rejected" && result.reason instanceof GitHubApiError && result.reason.code === "rate_limited") throw result.reason;
      }
    }
    const readmeExcerpt = readmeResult.status === "fulfilled" ? readmeResult.value : null;
    const release = releaseResult.status === "fulfilled" ? releaseResult.value : null;
    const failures = [readmeResult, releaseResult, issuesResult].flatMap((result, index) => result.status === "rejected" ? [`${["README", "Release", "Issues"][index]}: ${result.reason instanceof Error ? result.reason.message : "GitHub detail fetch failed"}`] : []);

    return {
      id: item.id,
      fullName: item.full_name,
      description: item.description,
      language: item.language,
      license: item.license?.spdx_id && item.license.spdx_id !== "NOASSERTION" ? item.license.spdx_id : null,
      stars: item.stargazers_count,
      forks: item.forks_count,
      openIssues: item.open_issues_count,
      createdAt: item.created_at,
      pushedAt: item.pushed_at,
      url: item.html_url,
      readmeExcerpt,
      releaseTag: release?.tag_name ?? null,
      releaseUrl: release?.html_url ?? null,
      readmeFetchSucceeded: readmeResult.status === "fulfilled",
      releaseFetchSucceeded: releaseResult.status === "fulfilled",
      issues: issuesResult.status === "fulfilled" ? issuesResult.value : [],
      issuesFetchSucceeded: issuesResult.status === "fulfilled",
      issuesFetchedAt: issuesResult.status === "fulfilled" ? new Date().toISOString() : null,
      raw: item,
      warning: failures.length ? failures.join("; ") : null,
    };
  }

  private fromSearchItem(item: GitHubSearchItem, warning: string): GitHubRepository {
    return {
      id: item.id,
      fullName: item.full_name,
      description: item.description,
      language: item.language,
      license: item.license?.spdx_id && item.license.spdx_id !== "NOASSERTION" ? item.license.spdx_id : null,
      stars: item.stargazers_count,
      forks: item.forks_count,
      openIssues: item.open_issues_count,
      createdAt: item.created_at,
      pushedAt: item.pushed_at,
      url: item.html_url,
      readmeExcerpt: null,
      releaseTag: null,
      releaseUrl: null,
      readmeFetchSucceeded: false,
      releaseFetchSucceeded: false,
      issues: [], issuesFetchSucceeded: false, issuesFetchedAt: null,
      raw: item,
      warning,
    };
  }

  private async readme(fullName: string): Promise<string | null> {
    const url = `${this.apiBase}/repos/${fullName}/readme`;
    const response = await this.fetchResponse(url);
    if (response.status === 404) return null;
    if (!response.ok) throw this.errorFrom(response);
    const content = await response.json() as { content?: string; encoding?: string };
    if (!content.content) return null;
    const decoded = content.encoding === "base64" ? Buffer.from(content.content, "base64").toString("utf8") : content.content;
    return readmeEvidenceExcerpt(decoded, 20000);
  }

  private async publicIssues(fullName: string): Promise<GitHubIssue[]> {
    const response = await this.fetchResponse(`${this.apiBase}/repos/${fullName}/issues?state=open&sort=updated&direction=desc&per_page=15`);
    if (!response.ok) throw this.errorFrom(response);
    const issues = await response.json() as GitHubIssueResponse[];
    return issues.filter((issue) => !issue.pull_request).slice(0, 5).map((issue) => ({
      id: issue.id, number: issue.number, title: issue.title, bodyExcerpt: (issue.body ?? "").slice(0, 2000), bodyTruncated: (issue.body?.length ?? 0) > 2000,
      url: issue.html_url, state: issue.state, createdAt: issue.created_at, updatedAt: issue.updated_at,
      comments: issue.comments, reactions: issue.reactions?.total_count ?? 0, authorAssociation: issue.author_association ?? "NONE", authorLogin: issue.user?.login ?? null,
    }));
  }

  private async latestRelease(fullName: string): Promise<GitHubRelease | null> {
    const response = await this.fetchResponse(`${this.apiBase}/repos/${fullName}/releases?per_page=1`);
    if (!response.ok) throw this.errorFrom(response);
    const releases = await response.json() as GitHubRelease[];
    return releases[0] ?? null;
  }

  private async request<T>(url: URL): Promise<T> {
    const response = await this.fetchResponse(url);
    if (!response.ok) throw this.errorFrom(response);
    return response.json() as Promise<T>;
  }

  private async fetchResponse(url: string | URL) {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const remaining = this.deadlineAt - Date.now();
      if (remaining <= 0) throw new GitHubApiError("GitHub discovery time budget exhausted", "upstream_error");
      let response: Response;
      try {
        response = await this.fetcher(url, { headers: this.headers(), signal: AbortSignal.timeout(Math.min(12_000, Math.ceil(remaining))) });
      } catch (error) {
        // Repeating the same request cannot repair certificate trust. The Windows
        // transport has already tried its independently verified Node fallback.
        if (error instanceof Error && error.message.startsWith("RADAR_GITHUB_CA_FILE")) {
          throw new GitHubApiError(error.message, "upstream_error");
        }
        const certificateCode = certificateErrorCode(error);
        if (certificateCode) throw new GitHubApiError(`GitHub certificate verification failed (${certificateCode}); automatic retries stopped`, "upstream_error");
        if (attempt < maxAttempts - 1 && this.deadlineAt - Date.now() > 1200) {
          await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
          continue;
        }
        const getCode = (value: unknown) => value && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : null;
        const code = getCode(error) ?? (error instanceof Error ? getCode(error.cause) ?? error.name : "network_error");
        throw new GitHubApiError(`GitHub connection failed after ${attempt + 1} attempts (${code})`, "upstream_error");
      }
      if (attempt < maxAttempts - 1 && response.status >= 500 && response.status <= 504) {
        await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
        continue;
      }
      return response;
    }
    throw new GitHubApiError(`GitHub API request failed after ${maxAttempts} attempts`, "upstream_error");
  }

  private headers(): HeadersInit {
    return {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "github-opportunity-radar/0.1.0",
      ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
    };
  }

  private errorFrom(response: Response) {
    if (response.status === 403 || response.status === 429) {
      if (response.status === 403 && response.headers.get("x-ratelimit-remaining") !== "0" && !response.headers.has("retry-after") && !response.headers.has("x-ratelimit-reset")) {
        return new GitHubApiError("GitHub denied access (HTTP 403); check token permissions or secondary limits", "upstream_error");
      }
      const reset = response.headers.get("x-ratelimit-reset");
      const retryAt = reset ? new Date(Number(reset) * 1000).toISOString() : response.headers.get("retry-after");
      return new GitHubApiError(`GitHub API rate limit reached${retryAt ? `; retry after ${retryAt}` : ""}`, "rate_limited", retryAt);
    }
    if (response.status === 422) return new GitHubApiError("GitHub rejected the repository search query", "bad_query");
    if (response.status === 404) return new GitHubApiError("GitHub repository or resource was not found", "not_found");
    return new GitHubApiError(`GitHub API returned HTTP ${response.status}`, "upstream_error");
  }
}
