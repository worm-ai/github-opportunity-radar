import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = require(createRequire(require.resolve("tsx")).resolve("esbuild"));
const packages = resolve(root, ".data/experiments/genoffice/packages");
const alias = Object.fromEntries(["pptx-engine", "zip-gate", "agent-core"].map((name) => [`@genoffice/${name}`, resolve(packages, name, "src/index.ts")]));
alias["@genoffice/agent-core/redact-range"] = resolve(packages, "agent-core/src/redact-range.ts");
for (const part of ["identity", "table-grid", "background-promote"]) alias[`@genoffice/pptx-engine/${part}`] = resolve(packages, `pptx-engine/src/${part}.ts`);
alias["@genoffice/docx-engine/math"] = resolve(packages, "docx-engine/src/math.ts");
const engine = resolve(packages, "pptx-engine/src/index.ts").replaceAll("\\", "/");
const ops = resolve(packages, "pptx-ops/src/ops/index.ts").replaceAll("\\", "/");
await build({
  stdin: { contents: `export * from ${JSON.stringify(engine)}; export { runTxn } from ${JSON.stringify(ops)};`, resolveDir: root, loader: "ts" },
  outfile: resolve(root, ".data/experiments/genoffice-bridge.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node24", alias,
  external: ["jszip", "fast-xml-parser"], loader: { ".md": "text" }, logLevel: "warning",
});
console.log("GenOffice engine and operation bridge built from verified source");
