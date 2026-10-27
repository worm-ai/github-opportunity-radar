import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const data = resolve(root, ".data/experiments");
const upstream = resolve(data, "map-design");
const output = resolve(data, "runs", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(output, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const { createBlankPptx, openPptx, savePptx, runTxn, getSlideNotes } = await import(pathToFileURL(resolve(data, "genoffice-bridge.mjs")).href);
const { default: JSZip } = await import(pathToFileURL(resolve(data, "node_modules/jszip/lib/index.js")).href);
const sourceManifests = ["map-design", "genoffice"].map((name) => JSON.parse(readFileSync(resolve(data, name, "verified-source.json"), "utf8")));
// Verify the pinned source at execution time, including against local edits.
for (const [index, name] of ["map-design", "genoffice"].entries()) {
  for (const entry of sourceManifests[index].files) {
    const bytes = readFileSync(resolve(data, name, entry.path));
    const actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(actual, entry.sha, `Upstream source changed: ${name}/${entry.path}`);
  }
}
const originalCsv = readFileSync(resolve(upstream, "examples/us-population-change/states.csv"), "utf8");
const upstreamSpec = JSON.parse(readFileSync(resolve(upstream, "examples/us-population-change/spec.json"), "utf8"));
const baseSpec = { ...upstreamSpec, title: "Population change by US state, 2020-2024", subtitle: "Pinned repository example attributed to US Census Bureau; not independently revalidated", format: { suffix: "%", decimals: 2 } };
const csvRows = originalCsv.trim().split(/\r?\n/);
const california = csvRows.find((line) => line.startsWith("06,"));
assert.ok(california);
const cases = [
  { name: "baseline", csv: originalCsv, note: baseSpec.note },
  { name: "repeat", csv: originalCsv, note: baseSpec.note },
  { name: "updated", csv: originalCsv.replace(california, california.replace(/-0\.31$/, "10.00")), note: "Synthetic update test only: California changed from -0.31% to 10.00%. Not a factual population update." },
  { name: "unmatched", csv: originalCsv + '99,"Not a state",0,0,5\n', note: "Injected invalid FIPS row; diagnostic test only." },
  { name: "duplicate", csv: originalCsv + california.replace(/-0\.31$/, "99.00") + "\n", note: "Injected duplicate California row; diagnostic test only." },
  { name: "missing", csv: originalCsv.replace(california, california.replace(/-0\.31$/, "")), note: "Injected missing California value; diagnostic test only." },
];
const mapRuns = [];
for (const item of cases) {
  const csv = resolve(output, `${item.name}.csv`);
  const spec = resolve(output, `${item.name}.json`);
  writeFileSync(csv, item.csv);
  writeFileSync(spec, JSON.stringify({ ...baseSpec, data: `${item.name}.csv`, note: item.note }, null, 2));
  const args = [resolve(upstream, "skills/map-design/scripts/map.mjs"), "render", spec, "--json", ...(mapRuns.length >= 3 ? ["--no-png"] : [])];
  const started = performance.now();
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 150_000, windowsHide: true });
  writeFileSync(resolve(output, `${item.name}.stdout.txt`), result.stdout || "");
  writeFileSync(resolve(output, `${item.name}.stderr.txt`), result.stderr || "");
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const parsed = JSON.parse(result.stdout);
  const svg = readFileSync(parsed.files.svg, "utf8");
  const values = [...svg.matchAll(/data-name="([^"]+)" data-value="([^"]*)"/g)].map((match) => ({ region: match[1], value: match[2] }));
  const record = { name: item.name, elapsedMs: Math.round(performance.now() - started), exitCode: result.status, report: parsed.report, regions: values.length, california: values.find((entry) => entry.region === "California")?.value ?? null, svgSha256: hash(svg), csvSha256: hash(item.csv), files: Object.fromEntries(Object.entries(parsed.files).map(([kind, path]) => [kind, relative(root, path).replaceAll("\\", "/")])) };
  if (parsed.files.png) {
    const png = readFileSync(parsed.files.png);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    record.pngSize = [png.readUInt32BE(16), png.readUInt32BE(20)];
    record.pngSha256 = hash(png);
  }
  mapRuns.push(record);
}
assert.equal(mapRuns[0].regions, 51);
assert.equal(mapRuns[0].california, "-0.31%");
assert.deepEqual(mapRuns[0].report.unmatched, []);
assert.deepEqual(mapRuns[0].report.warnings, []);
assert.equal(mapRuns[0].svgSha256, mapRuns[1].svgSha256, "Same input must preserve SVG content");
assert.equal(mapRuns[2].california, "10.00%");
assert.notEqual(mapRuns[0].pngSha256, mapRuns[2].pngSha256);
assert.equal(mapRuns[3].report.unmatched.length, 1);
assert.ok(mapRuns[4].report.warnings.some((text) => /Two rows match California/.test(text)));
assert.equal(mapRuns[4].california, "-0.31%", "Duplicate data silently keeping first must be visible as a warning");
assert.ok(mapRuns[5].report.warnings.some((text) => /no numeric/.test(text)));
assert.equal(mapRuns[5].california, null, "Missing data must not become zero");
// An adapter must inspect diagnostics, not equate a zero exit code with clean data.
const needsReview = (record) => record.report.unmatched.length > 0 || record.report.warnings.length > 0;
assert.deepEqual(mapRuns.map(needsReview), [false, false, false, true, true, true]);

const opened = await openPptx(await createBlankPptx());
const size = opened.deck.size;
const height = Math.round(size.cy * 0.92);
const width = Math.round(height * 1.6);
const offset = { x: Math.round((size.cx - width) / 2), y: Math.round((size.cy - height) / 2), cx: width, cy: height };
const baselinePng = readFileSync(resolve(output, "baseline.png"));
const notes = `Technical experiment, not a market validation. Input: pinned Map Design US Census example, commit ${sourceManifests[0].commit}. Input SHA-256 ${mapRuns[0].csvSha256}.`;
const createResult = runTxn(opened, { ops: [
  { op: "addPicture", target: { slide: 0 }, bytes: baselinePng.toString("base64"), ext: "png", offset },
  { op: "setNotes", target: { slide: 0 }, text: notes },
] });
assert.equal(createResult.applied, true, JSON.stringify(createResult.failures));
const baselineDeck = await savePptx(opened);
writeFileSync(resolve(output, "baseline.pptx"), baselineDeck);
const reopened = await openPptx(baselineDeck);
const picture = reopened.deck.slides[0].elements.find((element) => element.type === "picture");
assert.ok(picture);
const savedOffset = { ...picture.transform.offset };
const baselineNotes = getSlideNotes(reopened.archive, reopened.deck.slides[0].path);
assert.ok(baselineNotes.includes(mapRuns[0].csvSha256));

async function inspectDeck(bytes, expectedPng) {
  const archive = await JSZip.loadAsync(bytes);
  const media = Object.keys(archive.files).filter((path) => /^ppt\/media\/.*\.png$/.test(path));
  const hashes = await Promise.all(media.map(async (path) => ({ path, sha256: hash(await archive.file(path).async("nodebuffer")) })));
  assert.ok(hashes.some((entry) => entry.sha256 === hash(expectedPng)), "PPTX must embed the exact generated PNG");
  const model = await openPptx(bytes);
  assert.equal(model.deck.slides.length, 1);
  assert.equal(model.deck.slides[0].elements.filter((entry) => entry.type === "picture").length, 1);
  const picture = model.deck.slides[0].elements.find((entry) => entry.type === "picture");
  assert.deepEqual(picture.transform.offset, savedOffset);
  assert.equal(hash(await archive.file(picture.mediaRef).async("nodebuffer")), hash(expectedPng), "The displayed picture must reference the expected PNG, not an unused media entry");
  return { slides: 1, pictures: 1, media: hashes, sha256: hash(bytes), offset: savedOffset };
}
const baselineInspection = await inspectDeck(baselineDeck, baselinePng);
const updatedPng = readFileSync(resolve(output, "updated.png"));
const replacements = [];
let current = reopened;
for (let iteration = 1; iteration <= 2; iteration++) {
  const target = current.deck.slides[0].elements.find((element) => element.type === "picture");
  const result = runTxn(current, { ops: [
    { op: "replacePicture", target: { slide: 0, el: target.id }, bytes: updatedPng.toString("base64"), ext: "png" },
    { op: "setNotes", target: { slide: 0 }, text: `${notes}\nSynthetic update: California=10.00%; updated input SHA-256 ${mapRuns[2].csvSha256}. Not current Census data.` },
  ] });
  assert.equal(result.applied, true, JSON.stringify(result.failures));
  const bytes = await savePptx(current);
  writeFileSync(resolve(output, `updated-${iteration}.pptx`), bytes);
  replacements.push(await inspectDeck(bytes, updatedPng));
  current = await openPptx(bytes);
  assert.ok(getSlideNotes(current.archive, current.deck.slides[0].path).includes(mapRuns[2].csvSha256));
}
const result = { executedAt: new Date().toISOString(), node: process.version, platform: process.platform, source: sourceManifests.map(({ repository, commit }) => ({ repository, commit })), inputOrigin: "Map Design repository example attributed to US Census, not independently revalidated against Census; mutations are synthetic diagnostics", mapRuns, pptx: { baseline: baselineInspection, replacements }, checks: { matchingAndValues: true, sameInputSvgStable: true, missingNotZero: true, diagnosticsRequiredDespiteExitZero: true, exactPngEmbedded: true, repeatedReplacementPreservesGeometryAndCount: true, notesTrackInputHash: true }, limitations: ["GenOffice engine and op layer were run; packaged CLI and desktop application were not tested", "No PowerPoint/LibreOffice rendering or cross-renderer fidelity test", "No human task timing, customer interview, trial, or payment evidence"] };
writeFileSync(resolve(output, "result.json"), JSON.stringify(result, null, 2));
writeFileSync(resolve(data, "latest-map-pptx.json"), JSON.stringify({ directory: relative(root, output).replaceAll("\\", "/") }, null, 2));
console.log(JSON.stringify({ directory: output, checks: result.checks, mapRuns: mapRuns.map(({ name, elapsedMs, regions, california, report }) => ({ name, elapsedMs, regions, california, warnings: report.warnings, unmatched: report.unmatched })), pptx: { baseline: baselineInspection.sha256, updated: replacements.map((entry) => entry.sha256) }, limitations: result.limitations }, null, 2));
