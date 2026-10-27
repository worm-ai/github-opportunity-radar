// Read-only upstream collection; no model requests or production database writes.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (existsSync(".env")) process.loadEnvFile(".env");
const root = resolve(".data/experiments/gpt-researcher-report-failure-20261022");
mkdirSync(root, { recursive: true });
const repository = "assafelovic/gpt-researcher";
const headers = { accept: "application/vnd.github+json", "user-agent": "opportunity-radar-source-audit",
  ...(process.env.GITHUB_TOKEN?.trim() ? { authorization: "Bearer " + process.env.GITHUB_TOKEN.trim() } : {}) };
async function get(path) {
  const response = await fetch("https://api.github.com/repos/" + repository + path, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(path + ": HTTP " + response.status);
  return response.json();
}
const snapshots = [];
for (const [label, ref] of [["reported", "3582a684"], ["current", "main"]]) {
  const commit = await get("/commits/" + ref);
  if (!/^[0-9a-f]{40}$/.test(commit.sha)) throw new Error("Expected a full commit SHA");
  const sources = [];
  for (const path of ["gpt_researcher/actions/report_generation.py", "gpt_researcher/skills/writer.py"]) {
    const file = await get("/contents/" + path + "?ref=" + commit.sha);
    if (file.encoding !== "base64" || !file.content) throw new Error("Missing source bytes: " + path);
    const bytes = Buffer.from(file.content, "base64");
    const blobSha = createHash("sha1").update(Buffer.from("blob " + bytes.length + String.fromCharCode(0))).update(bytes).digest("hex");
    if (blobSha !== file.sha) throw new Error("Git blob mismatch: " + path);
    const name = label + "-" + path.split("/").at(-1);
    writeFileSync(resolve(root, name), bytes);
    sources.push({ path, name, blobSha, sha256: createHash("sha256").update(bytes).digest("hex"), url: "https://github.com/" + repository + "/blob/" + commit.sha + "/" + path });
  }
  snapshots.push({ label, ref, commit: commit.sha, committedAt: commit.commit.committer.date, sources });
}
const manifest = { observedAt: new Date().toISOString(), repository, issue: 2218, snapshots };
writeFileSync(resolve(root, "sources.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ directory: root, snapshots: snapshots.map(({ label, commit, committedAt }) => ({ label, commit, committedAt })), files: 4 }));
