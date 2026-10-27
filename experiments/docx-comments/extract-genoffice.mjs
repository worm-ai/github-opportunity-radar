// Recover selected files from a damaged GitHub ZIP using local file records.
// Every extracted file must match the Git blob SHA stored in verified-source.json.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const zipPath = resolve(root, ".data/experiments/genoffice-source.zip");
const verifiedPath = resolve(root, ".data/experiments/genoffice/verified-source.json");
const destination = resolve(root, ".data/experiments/genoffice-recovered");
const prefix = "genoffice-04f1457170394eda597f032cc6e0850e3d956847/";
const zip = readFileSync(zipPath);
const verified = JSON.parse(readFileSync(verifiedPath, "utf8"));
assert.equal(verified.commit, prefix.slice("genoffice-".length, -1));
const shaByPath = new Map(verified.files.map(({ path, sha }) => [path, sha]));
const selected = (path) => path === "packages/docx-engine/package.json"
  || path === "packages/docx-engine/src/index.ts"
  || path === "packages/docx-engine/src/xml-utils.ts"
  || path === "packages/docx-engine/src/notes.ts"
  || path === "packages/docx-engine/src/comments.ts"
  || path === "packages/docx-engine/src/parse.ts"
  || path === "packages/cli/package.json"
  || path === "packages/cli/src/commands/docs.ts"
  || path === "packages/cli/src/formats/docx.ts"
  || path === "packages/cli/src/index.ts"
  || path === "packages/zip-gate/package.json"
  || path === "packages/zip-gate/src/index.ts"
  || path === "packages/zip-gate/src/byte-stream.ts"
  || path === "packages/pptx-engine/package.json"
  || path === "packages/pptx-engine/src/xml-utils.ts"
  || path === "packages/pptx-engine/src/zip.ts"
  || path === "packages/agent-core/package.json"
  || path === "package.json"
  || path === "pnpm-lock.yaml";

function gitBlobSha(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}
const signature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const recovered = [];
let offset = 0, skipped = [], entries = 0;
while (offset + 30 <= zip.length) {
  if (!zip.subarray(offset, offset + 4).equals(signature)) {
    const next = zip.indexOf(signature, offset + 1);
    if (next < 0) break;
    offset = next;
  }
  const flags = zip.readUInt16LE(offset + 6);
  const method = zip.readUInt16LE(offset + 8);
  const compressedSize = zip.readUInt32LE(offset + 18);
  const nameLength = zip.readUInt16LE(offset + 26);
  const extraLength = zip.readUInt16LE(offset + 28);
  const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
  const dataStart = offset + 30 + nameLength + extraLength;
  if (!name.startsWith(prefix)) break;
  const relative = name.slice(prefix.length);
  entries++;
  if (name.endsWith("/")) {
    offset = dataStart;
    continue;
  }
  if (flags & 0x08) throw new Error(`Unexpected data descriptor in ${name}`);
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > zip.length) {
    skipped.push({ path: relative, error: "truncated local record" });
    const next = zip.indexOf(signature, dataStart + 1);
    if (next < 0) break;
    offset = next;
    continue;
  }
  try {
    let bytes;
    if (method === 0) bytes = zip.subarray(dataStart, dataEnd);
    else if (method === 8) bytes = inflateRawSync(zip.subarray(dataStart, dataEnd));
    else throw new Error(`Unsupported ZIP compression method ${method}`);
    if (selected(relative)) {
      const expected = shaByPath.get(relative);
      assert.ok(expected, `No verified Git blob SHA for ${relative}`);
      const actual = gitBlobSha(bytes);
      assert.equal(actual, expected, `Git blob SHA mismatch for ${relative}`);
      const target = resolve(destination, relative);
      assert.ok(target.startsWith(destination + sep), `Unsafe output path ${relative}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: "wx" });
      recovered.push({ path: relative, bytes: bytes.length, gitBlobSha: actual });
    }
    offset = dataEnd;
  } catch (error) {
    skipped.push({ path: relative, error: String(error.message ?? error) });
    const next = zip.indexOf(signature, dataStart + 1);
    if (next < 0) break;
    offset = next;
  }
}
const requested = [
  "packages/cli/src/commands/docs.ts",
  "packages/docx-engine/src/index.ts",
  "packages/docx-engine/src/notes.ts",
];
const extracted = new Set(recovered.map(({ path }) => path));
console.log(JSON.stringify({ commit: verified.commit, entriesVisited: entries, extractedAndVerified: recovered, missingRequested: requested.filter((path) => !extracted.has(path)), skipped }));
