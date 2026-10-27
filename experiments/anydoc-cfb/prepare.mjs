// Downloads only the public minimal reproduction linked from AnyDoc issue #37.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GitHubClient } from "../../packages/sensor-github/dist/index.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
const client = new GitHubClient({ token: process.env.GITHUB_TOKEN });
const directory = resolve(root, ".data/experiments/anydoc-cfb");
mkdirSync(directory, { recursive: true });
const gitBlobSha = "6f1ec72a6697a7ca9f7abb59b36a94c0a48a8755";
const expectedHash = "fee05b029dc6ee2ce8cdc4388a03cd150fe7dff3eef9a013b387e996d9dcb8e6";
const blob = await client.request(new URL(`https://api.github.com/repos/H0rowitz/anydoc/git/blobs/${gitBlobSha}`));
if (blob.encoding !== "base64") throw new Error("Expected a base64 Git blob");
const bytes = Buffer.from(blob.content, "base64");
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (bytes.length !== 19456 || sha256 !== expectedHash || createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== gitBlobSha) throw new Error("Public sample integrity mismatch");
writeFileSync(resolve(directory, "textedit-minimal.doc"), bytes);
writeFileSync(resolve(directory, "source.json"), JSON.stringify({
  repository: "H0rowitz/anydoc", gitBlobSha, sha256, bytes: bytes.length,
  sourceUrl: "https://github.com/H0rowitz/anydoc/blob/apple-doc-sample/issue-samples/textedit-minimal.doc",
  issueUrl: "https://github.com/firecrawl/anydoc/issues/37", observedAt: new Date().toISOString(),
}, null, 2));
writeFileSync(resolve(directory, "package.json"), JSON.stringify({
  name: "radar-anydoc-cfb-experiment", private: true, type: "module",
  dependencies: { "@firecrawl/anydoc": "0.2.4", cfb: "1.2.2" },
}, null, 2));
console.log(JSON.stringify({ sample: "textedit-minimal.doc", bytes: bytes.length, sha256, next: "Install the two pinned experiment dependencies as documented; run.mjs performs no network calls." }));
