// Retrieve a fixed upstream release and its public DOCX regression inputs.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

process.loadEnvFile(".env");
const directory = resolve(".data/experiments/pandoc-comments");
mkdirSync(directory, { recursive: true });
const discovery = JSON.parse(readFileSync(resolve(directory, "discovery.json"), "utf8"));
const release = discovery.release;
const headers = {
  accept: "application/vnd.github+json", "user-agent": "github-opportunity-radar-research",
  ...(process.env.GITHUB_TOKEN?.trim() ? { authorization: `Bearer ${process.env.GITHUB_TOKEN.trim()}` } : {}),
};
async function get(path) {
  const response = await fetch(`https://api.github.com/repos/jgm/pandoc${path}`, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}
const commit = (await get(`/commits/${encodeURIComponent(release.tag_name)}`)).sha;
const tree = await get(`/git/trees/${commit}?recursive=1`);
if (tree.truncated) throw new Error("Upstream tree is truncated");
const candidates = tree.tree.filter((item) => item.type === "blob" && /comment|track.change/i.test(item.path) && /\.docx$|\.native$/.test(item.path));
writeFileSync(resolve(directory, "upstream-files.json"), JSON.stringify({ commit, tag: release.tag_name, candidates }, null, 2));
console.log(JSON.stringify({ tag: release.tag_name, commit, candidates }, null, 2));
const sourcePaths = [
  "MANUAL.txt", "COPYING.md",
  ...candidates.filter((item) => /\.docx$/.test(item.path)).slice(0, 6).map((item) => item.path),
  ...candidates.filter((item) => /comments.*\.native$/.test(item.path)).slice(0, 2).map((item) => item.path),
];
const sources = [];
for (const path of sourcePaths) {
  const file = await get(`/contents/${path}?ref=${commit}`);
  if (!file.content || file.encoding !== "base64") throw new Error(`Missing source bytes: ${path}`);
  const bytes = Buffer.from(file.content, "base64");
  const blobSha = createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
  if (blobSha !== file.sha) throw new Error(`Blob mismatch: ${path}`);
  const name = path.replaceAll("/", "_");
  writeFileSync(resolve(directory, name), bytes);
  sources.push({ path, name, blobSha, sha256: createHash("sha256").update(bytes).digest("hex"), url: `https://github.com/jgm/pandoc/blob/${commit}/${path}` });
}
writeFileSync(resolve(directory, "sources.json"), JSON.stringify({ observedAt: new Date().toISOString(), tag: release.tag_name, commit, sources }, null, 2));
console.log(JSON.stringify({ tag: release.tag_name, commit, sourceFiles: sources.length, files: sources.map((source) => source.path) }));
