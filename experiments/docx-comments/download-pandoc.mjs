// Download the fixed official Windows release in bounded ranges. Never run partial/unverified bytes.
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve(".data/experiments/pandoc-comments");
const { release } = JSON.parse(readFileSync(resolve(directory, "discovery.json"), "utf8"));
const asset = release.assets.find((item) => item.name === "pandoc-3.12.1-windows-x86_64.zip");
if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw new Error("Missing fixed release digest");
const headers = { "user-agent": "github-opportunity-radar-research", accept: "application/octet-stream" };
const redirect = await fetch(asset.url, { headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });
const location = redirect.headers.get("location");
if (!location || new URL(location).protocol !== "https:" || new URL(location).hostname !== "release-assets.githubusercontent.com") throw new Error(`Unexpected asset redirect (${redirect.status})`);
const parts = resolve(directory, "download-parts");
mkdirSync(parts, { recursive: true });
const block = 512 * 1024;
const count = Math.ceil(asset.size / block);
const queue = Array.from({ length: count }, (_, index) => index);
let completed = 0;
const failures = [];
async function worker() {
  while (queue.length) {
    const index = queue.shift();
    const start = index * block, end = Math.min(asset.size - 1, start + block - 1);
    const path = resolve(parts, String(index).padStart(3, "0") + ".part");
    if (existsSync(path) && readFileSync(path).length === end - start + 1) { completed++; continue; }
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(location, { headers: { range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(30_000) });
        if (response.status !== 206 || response.headers.get("content-range") !== `bytes ${start}-${end}/${asset.size}`) throw new Error(`Unexpected range response (${response.status})`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== end - start + 1) throw new Error("Incomplete range");
        writeFileSync(path, bytes);
        completed++;
        console.log(JSON.stringify({ completed, count }));
        lastError = null;
        break;
      } catch (error) { lastError = String(error); }
    }
    if (lastError) failures.push({ index, error: lastError });
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()));
if (failures.length) {
  console.log(JSON.stringify({ completed, count, failures }));
  process.exitCode = 1;
} else {
  const bytes = Buffer.concat(Array.from({ length: count }, (_, index) => readFileSync(resolve(parts, String(index).padStart(3, "0") + ".part"))));
  const digest = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  if (digest !== asset.digest || bytes.length !== asset.size) throw new Error("Release integrity mismatch; not writing runnable archive");
  writeFileSync(resolve(directory, asset.name), bytes);
  console.log(JSON.stringify({ verified: true, name: asset.name, bytes: bytes.length, digest }));
}
