// A narrow, reproducible boundary test. Never use this as a general DOC repairer.
// No model calls, hosted OCR, user files, or writes to the product database.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = resolve(root, ".data/experiments/anydoc-cfb");
const require = createRequire(resolve(directory, "package.json"));
const anydoc = require("@firecrawl/anydoc"), cfb = require("cfb");
const lock = JSON.parse(readFileSync(resolve(directory, "package-lock.json"), "utf8"));
const pins = [
  { name: "@firecrawl/anydoc", version: "0.2.4", repository: "firecrawl/anydoc", commit: "42bf1c5ecdde9eb0d96d6bd75a9e6698cf93b14c", integrity: "sha512-rfJxa5L+nhoqR5yodcRZoGDLaSfxMTpBuhVj1gSacfW4ZGjBt4cjfErXwaKjPYrpWRTPIBye2sh36UhqgOP1Og==" },
  { name: "cfb", version: "1.2.2", repository: "SheetJS/js-cfb", commit: "ad93f76a36f893362efe96f738a327c290c1f2a9", integrity: "sha512-KfdUZsSOw19/ObEWasvBP/Ac4reZvAGauZhs6S/gqNhXhI7cKwvlH7ulj+dOEYnca4bm4SGo8C1bTAQvnTjgQA==" },
];
for (const pin of pins) {
  const entry = lock.packages[`node_modules/${pin.name}`];
  assert.equal(entry.version, pin.version); assert.equal(entry.integrity, pin.integrity);
  assert.equal(require(`${pin.name}/package.json`).version, pin.version);
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = JSON.parse(readFileSync(resolve(directory, "source.json"), "utf8"));
const original = readFileSync(resolve(directory, "textedit-minimal.doc"));
assert.equal(sha256(original), "fee05b029dc6ee2ce8cdc4388a03cd150fe7dff3eef9a013b387e996d9dcb8e6");
assert.equal(source.sha256, sha256(original));
const convert = async (bytes, format) => {
  try { return { ok: true, markdown: await anydoc.toMarkdownBytes(bytes, format) }; }
  catch (error) { return { ok: false, code: error.code, message: error.message }; }
};
const streamHashes = (bytes) => {
  const container = cfb.read(bytes, { type: "buffer" });
  return container.FileIndex.flatMap((entry, index) => entry.type === 2 ? [{ path: container.FullPaths[index], bytes: entry.content.length, sha256: sha256(entry.content) }] : []).sort((a, b) => a.path.localeCompare(b.path));
};
const originalStreams = streamHashes(original);
const cutoff = original.readUInt32LE(0x38), sectorSize = 2 ** original.readUInt16LE(0x1e);
assert.equal(cutoff, 4096); assert.equal(sectorSize, 512);
assert.equal(original.readUInt32LE(0x40), 1);
assert.equal(originalStreams.length, 4);
assert.ok(originalStreams.every((stream) => stream.bytes >= cutoff));
const miniFatStart = (original.readUInt32LE(0x3c) + 1) * sectorSize;
assert.ok(miniFatStart + sectorSize <= original.length);
assert.ok(original.subarray(miniFatStart, miniFatStart + sectorSize).every((byte) => byte === 0));

const originalAuto = await convert(original), originalExplicit = await convert(original, "doc");
// A plausible two-library fallback: lenient reader -> general OLE writer -> AnyDoc.
// Preserve its failure as counterevidence, rather than silently substituting the patch.
const rewritten = Buffer.from(cfb.write(cfb.read(original, { type: "buffer" }), { type: "buffer" }));
const rewrittenAuto = await convert(rewritten), rewrittenExplicit = await convert(rewritten, "doc");
const patched = Buffer.from(original);
// Exact public fixture only, all live streams >= cutoff: these MiniFAT entries are unused.
patched.fill(0xff, miniFatStart, miniFatStart + sectorSize);
const patchedAuto = await convert(patched), patchedExplicit = await convert(patched, "doc");
const patchedStreams = streamHashes(patched);
assert.deepEqual(patchedStreams, originalStreams);
assert.equal(originalAuto.ok, false); assert.equal(originalAuto.code, "unsupported");
assert.equal(originalExplicit.ok, false); assert.equal(originalExplicit.code, "malformed");
assert.equal(rewrittenExplicit.ok, false);
assert.equal(patchedAuto.ok, true); assert.equal(patchedExplicit.ok, true);
assert.equal(patchedAuto.markdown.trim().replace(/\s+/g, " "), "Alpha paragraph. Beta paragraph.");
assert.equal(patchedAuto.markdown, patchedExplicit.markdown);
const invalid = await convert(Buffer.from("This is deliberately not an OLE document."), "doc");
assert.equal(invalid.ok, false);
const result = {
  executedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch },
  source, packages: pins,
  nativePackage: lock.packages["node_modules/@firecrawl/anydoc-win32-x64-msvc"] ?? null,
  original: { bytes: original.length, sha256: sha256(original), auto: originalAuto, explicit: originalExplicit, streams: originalStreams },
  rewrite: { bytes: rewritten.length, sha256: sha256(rewritten), auto: rewrittenAuto, explicit: rewrittenExplicit, streams: streamHashes(rewritten) },
  patch: { bytes: patched.length, sha256: sha256(patched), offset: miniFatStart, changedBytes: original.reduce((total, value, index) => total + Number(value !== patched[index]), 0), rule: "Exact pinned fixture only; change 128 unused MiniFAT entries from 0 to FREESECT", auto: patchedAuto, explicit: patchedExplicit, streams: patchedStreams },
  invalidInput: invalid,
  checks: { reproducedReportedFailure: true, genericRewriteFailed: true, patchedExpectedParagraphs: true, liveStreamsByteIdentical: true, invalidInputRejected: true },
  limits: ["One public two-paragraph fixture, not a representative e-mail corpus.", "The narrow patch is not a deployable repair policy; it is deliberately restricted by the input hash.", "Stream byte equality under one parser is not a general proof of document semantics, safety, layout or metadata preservation.", "Registry gitHead identifies the package publisher's source claim; source-to-binary reproducibility was not verified.", "No hosted OCR, model calls, user documents, user interviews or willingness-to-pay evidence."],
};
writeFileSync(resolve(directory, "result.json"), JSON.stringify(result, null, 2));
writeFileSync(resolve(directory, "output.md"), patchedAuto.markdown);
writeFileSync(resolve(directory, "minifat-patched.doc"), patched);
writeFileSync(resolve(directory, "rewritten.doc"), rewritten);
console.log(JSON.stringify({ executedAt: result.executedAt, originalAuto: originalAuto.code, originalExplicit: originalExplicit.message, rewrittenExplicit: rewrittenExplicit.message, patched: patchedAuto.markdown, changedBytes: result.patch.changedBytes, streamsPreserved: result.checks.liveStreamsByteIdentical }));
