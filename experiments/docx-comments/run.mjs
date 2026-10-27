// Reproducible DOCX comment baseline. This is evidence gathering, not a repairer.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const outDir = resolve(root, ".data/experiments/docx-comments");
mkdirSync(outDir, { recursive: true });
const require = createRequire(resolve(root, ".data/experiments/anydoc-cfb/package.json"));
const anydoc = require("@firecrawl/anydoc");

const crcTable = (() => {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, source] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const input = Buffer.from(source, "utf8");
    const compressed = deflateRawSync(input, { level: 9 });
    const header = Buffer.concat([Buffer.from("PK\x03\x04", "binary"), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc32(input)), u32(compressed.length), u32(input.length), u16(nameBytes.length), u16(0), nameBytes]);
    locals.push(header, compressed);
    const central = Buffer.concat([Buffer.from("PK\x01\x02", "binary"), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc32(input)), u32(compressed.length), u32(input.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]);
    centrals.push(central);
    offset += header.length + compressed.length;
  }
  const centralBytes = Buffer.concat(centrals);
  return Buffer.concat([...locals, centralBytes, Buffer.from("PK\x05\x06", "binary"), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBytes.length), u32(offset), u16(0)]);
}

const ns = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
  pr: "http://schemas.openxmlformats.org/package/2006/relationships",
};
const contentTypes = (comments) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${comments ? `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>` : ""}</Types>`;
const documentXml = (comments) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${ns.w}" xmlns:r="${ns.r}"><w:body><w:p><w:r><w:t>Reviewed sentence. </w:t></w:r>${comments ? `<w:commentRangeStart w:id="0"/><w:r><w:t>Annotated phrase.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:rPr><w:commentReference w:id="0"/></w:rPr></w:r>` : `<w:r><w:t>Annotated phrase.</w:t></w:r>`}</w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns.pr}"><Relationship Id="rId1" Type="${ns.r}/officeDocument" Target="word/document.xml"/></Relationships>`;
const documentRels = (comments) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns.pr}">${comments ? `<Relationship Id="rIdComments" Type="${ns.r}/comments" Target="comments.xml"/>` : ""}</Relationships>`;
const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${ns.w}"><w:comment w:id="0" w:author="Reviewer" w:initials="RV" w:date="2026-10-22T00:00:00Z"><w:p><w:r><w:t>Needs source.</w:t></w:r></w:p></w:comment></w:comments>`;
function makeDocx(comments) {
  const entries = [["[Content_Types].xml", contentTypes(comments)], ["_rels/.rels", rootRels], ["word/document.xml", documentXml(comments)], ["word/_rels/document.xml.rels", documentRels(comments)]];
  if (comments) entries.push(["word/comments.xml", commentsXml]);
  return zip(entries);
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const truth = { hasCommentsPart: true, comments: [{ id: "0", author: "Reviewer", initials: "RV", text: "Needs source.", rangeText: "Annotated phrase." }] };
const noCommentsTruth = { hasCommentsPart: false, comments: [] };
async function convert(bytes) {
  try {
    const markdown = await anydoc.toMarkdownBytes(bytes, "docx");
    return { ok: true, markdown: String(markdown) };
  } catch (error) {
    return { ok: false, name: error?.name, code: error?.code, message: String(error?.message ?? error) };
  }
}
const withComments = makeDocx(true);
const withoutComments = makeDocx(false);
const withResult = await convert(withComments);
const withoutResult = await convert(withoutComments);
assert.equal(withComments.subarray(0, 2).toString("ascii"), "PK");
assert.equal(withoutComments.subarray(0, 2).toString("ascii"), "PK");
assert.equal(withResult.ok, true);
assert.equal(withoutResult.ok, true);
assert.match(withResult.markdown, /Reviewed sentence\. Annotated phrase\./);
assert.doesNotMatch(withResult.markdown, /Needs source\.|Reviewer/);
assert.equal(withResult.markdown, withoutResult.markdown);
writeFileSync(resolve(outDir, "with-comments.docx"), withComments);
writeFileSync(resolve(outDir, "without-comments.docx"), withoutComments);
const result = {
  executedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  fixture: { withComments: { bytes: withComments.length, sha256: sha256(withComments), truth }, withoutComments: { bytes: withoutComments.length, sha256: sha256(withoutComments), truth: noCommentsTruth } },
  anydoc: { package: require("@firecrawl/anydoc/package.json").version, withComments: withResult, withoutComments: withoutResult },
  checks: { bothAreZipContainers: true, positiveFixtureHasOneComment: true, negativeFixtureHasNoComments: true, visibleBodyPreserved: true, commentBodyAndAuthorOmitted: true, positiveAndNegativeOutputIdentical: true },
  limits: ["OOXML truth is fixed by this fixture; no GenOffice execution was possible from the incomplete/corrupt source archive.", "AnyDoc output is an extraction baseline, not proof of current production behavior for all DOCX files.", "No user documents, interviews, frequency, replacement cost or willingness-to-pay evidence."],
};
writeFileSync(resolve(outDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ executedAt: result.executedAt, withComments: withResult, withoutComments: withoutResult, hashes: { withComments: result.fixture.withComments.sha256, withoutComments: result.fixture.withoutComments.sha256 } }));
