import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const latest = JSON.parse(readFileSync(resolve(root, ".data/experiments/latest-map-pptx.json"), "utf8"));
const directory = resolve(root, latest.directory);
const rendering = JSON.parse(readFileSync(resolve(directory, "powerpoint-result.json"), "utf8").replace(/^\uFEFF/, ""));
const core = JSON.parse(readFileSync(resolve(directory, "result.json"), "utf8"));
assert.equal(rendering.records.length, 3);
for (const record of rendering.records) {
  const bounds = core.pptx.baseline.offset;
  for (const [pointName, emuName] of [["left", "x"], ["top", "y"], ["width", "cx"], ["height", "cy"]]) {
    assert.ok(Math.abs(record.imageBoundsPoints[pointName] - bounds[emuName] / 12700) < 0.01);
  }
}
const urls = rendering.records.map((record) => `data:image/png;base64,${readFileSync(resolve(directory, record.output)).toString("base64")}`);
const browser = await chromium.launch({ channel: "msedge", headless: true });
let pixels;
try {
  const page = await browser.newPage();
  pixels = await page.evaluate(async (sources) => {
    const images = await Promise.all(sources.map(async (src) => {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
    }));
    const [baseline, updated, repeated] = images;
    let changed = 0; let repeatedChanges = 0;
    for (let index = 0; index < baseline.pixels.length; index += 4) {
      if ([0, 1, 2].some((channel) => baseline.pixels[index + channel] !== updated.pixels[index + channel])) changed++;
      if ([0, 1, 2].some((channel) => updated.pixels[index + channel] !== repeated.pixels[index + channel])) repeatedChanges++;
    }
    const sample = (image, x, y) => Array.from(image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
    return { sizes: images.map(({ width, height }) => [width, height]), changedPixels: changed, repeatedChangedPixels: repeatedChanges, californiaSample: { at: [444, 480], baseline: sample(baseline, 444, 480), updated: sample(updated, 444, 480) } };
  }, urls);
} finally { await browser.close(); }
assert.ok(pixels.sizes.every(([width, height]) => width === 1600 && height === 900));
assert.ok(pixels.changedPixels > 0);
assert.equal(pixels.repeatedChangedPixels, 0, "The two identical updates must render the same in this PowerPoint version");
assert.notDeepEqual(pixels.californiaSample.baseline, pixels.californiaSample.updated);
const result = { ...rendering, verifiedAt: new Date().toISOString(), pixels, artifacts: rendering.records.map((record) => ({ file: record.output, sha256: createHash("sha256").update(readFileSync(resolve(directory, record.output))).digest("hex") })), limitations: ["Rendering checked only in the locally installed PowerPoint version and Edge, not all Office versions", "Same-renderer repeat comparison does not establish cross-renderer pixel identity", "No end-user time saving or market demand established"] };
writeFileSync(resolve(directory, "powerpoint-verification.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
