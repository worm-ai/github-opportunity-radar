import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GitHubClient } from "../../packages/sensor-github/dist/index.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
const client = new GitHubClient({ token: process.env.GITHUB_TOKEN });
const sources = [
  { name: "map-design", repository: "ashishkaloge/map-design", commit: "48f8c523bca829a8f94d35ac1bf6cbff786bd800",
    include: (path) => (path.startsWith("skills/map-design/") && !path.includes("/admin1/")) || path.startsWith("examples/us-population-change/") || ["LICENSE", "THIRD_PARTY_NOTICES.md"].includes(path) },
  { name: "genoffice", repository: "genspark-ai/genoffice", commit: "04f1457170394eda597f032cc6e0850e3d956847",
    include: (path) => /^packages\/(pptx-engine|pptx-ops|zip-gate|font-metrics|agent-core)\/(src\/|package.json|tsconfig.json)/.test(path) || ["LICENSE", "THIRD_PARTY_NOTICES.md", "tsconfig.base.json", "packages/docx-engine/src/math.ts", "packages/docx-engine/src/xml-utils.ts", "packages/docx-engine/package.json"].includes(path) },
];
const blobHash = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
for (const source of sources) {
  const directory = resolve(root, ".data/experiments", source.name);
  mkdirSync(directory, { recursive: true });
  const tree = await client.request(new URL(`https://api.github.com/repos/${source.repository}/git/trees/${source.commit}?recursive=1`));
  if (tree.truncated) throw new Error(`${source.repository}: incomplete source tree`);
  const selected = tree.tree.filter((entry) => entry.type === "blob" && source.include(entry.path));
  const queue = [...selected];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      const target = resolve(directory, entry.path);
      if (existsSync(target) && blobHash(readFileSync(target)) === entry.sha) continue;
      const blob = await client.request(new URL(`https://api.github.com/repos/${source.repository}/git/blobs/${entry.sha}`));
      const bytes = Buffer.from(blob.content, "base64");
      if (blobHash(bytes) !== entry.sha) throw new Error(`Source integrity mismatch: ${entry.path}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
  }));
  writeFileSync(resolve(directory, "verified-source.json"), JSON.stringify({ repository: source.repository, commit: source.commit, fetchedAt: new Date().toISOString(), files: selected.map(({ path, sha }) => ({ path, sha })) }, null, 2));
  console.log(`${source.name}: ${selected.length} files verified at ${source.commit}`);
}
const runtime = resolve(root, ".data/experiments/package.json");
if (!existsSync(runtime)) writeFileSync(runtime, JSON.stringify({ name: "radar-local-experiments", private: true, type: "module" }, null, 2));
