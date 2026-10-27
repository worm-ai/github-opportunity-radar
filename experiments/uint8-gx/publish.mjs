import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { experimentSchema } from "../../apps/server/dist/experiments.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const run = resolve(root, ".data/experiments/uint8-gx");
const id = "gx-uint8-ordering-20261022";
const result = JSON.parse(readFileSync(resolve(run, "result.json"), "utf8"));
const source = {
  issue: "https://github.com/fivetran/great_expectations/issues/12331",
  issueQuote: "ExpectColumnValuesToBeIncreasing(column=\"value\", strictly=True) passes a pandas uint8 column containing [3, 2, 1] with success=True and unexpected_count=0.",
  packages: { great_expectations: "1.24.0", pandas: "2.2.3", numpy: "2.1.0" },
  sourceCommits: {
    "fivetran/great_expectations": { branch: "develop", commit: "bcde7b56218fa84fd7d888f75141733038e68ce1" },
    "dagster-io/dagster": { branch: "master", commit: "d6a9059fa8c10f4b7bf47239ac3b01cf374b7c49" },
  },
  note: "The source commits identify the observed repositories; the executable rule is the fixed PyPI package version above. No upstream source was modified.",
};
const findings = `# Great Expectations uint8 ordering guard\n\n` +
  `The fixed environment reproduced the public Issue #12331 behavior. Great Expectations ${result.environment.great_expectations} returned success=true and unexpected_count=0 for uint8 [3, 2, 1] under strictly=true. The same rule correctly rejected int64 [3, 2, 1].\n\n` +
  `The independent comparator checked each adjacent pair with direct ordering. It rejected both decreasing samples (two failing pairs) and accepted uint8 [1, 2, 3]. This establishes a narrow technical guard, not a product requirement.\n\n` +
  `Decision: stop before implementing an adapter or Dagster asset chain. First refresh the upstream issue/patch state and obtain evidence from a real data engineering workflow about frequency, operational cost, and whether a one-line local assertion is sufficient. Keep the opportunity market status unvalidated.\n`;
const reproduction = {
  command: "& .data/experiments/actual-ecommerce-noter/python/python.exe -X utf8 experiments/uint8-gx/run.py",
  script: "experiments/uint8-gx/run.py",
  dependencyDirectory: ".data/technical-experiments/uint8-gx/site-packages",
  fixedVersions: result.environment,
  cases: result.cases.map(({ id: caseId, values, dtype }) => ({ id: caseId, values, dtype })),
  modelCalls: 0,
  apiWrites: 0,
};
writeFileSync(resolve(run, "source.json"), JSON.stringify(source, null, 2));
writeFileSync(resolve(run, "findings.md"), findings);
writeFileSync(resolve(run, "reproduction.json"), JSON.stringify(reproduction, null, 2));
const files = [
  ["result.json", "Raw fixed-version rule and comparator results"],
  ["source.json", "Issue quote, package pins and observed repository commits"],
  ["reproduction.json", "Reproduction command, fixed inputs and execution boundaries"],
  ["findings.md", "Technical conclusion and stop decision"],
];
const sha256 = (name) => createHash("sha256").update(readFileSync(resolve(run, name))).digest("hex");
const artifacts = files.map(([name, label]) => ({ name, label, sha256: sha256(name) }));
const record = experimentSchema.parse({
  id,
  title: "Great Expectations uint8 ordering guard: narrow reproduction",
  question: "Does the fixed Great Expectations rule misclassify a decreasing uint8 column, and can direct adjacent ordering isolate it without rejecting controls?",
  conclusion: "The fixed Great Expectations 1.24.0, pandas 2.2.3 and numpy 2.1.0 environment reproduced the reported false positive: uint8 [3, 2, 1] passed strictly=true with zero unexpected values. Direct adjacent ordering rejected both decreasing controls and accepted uint8 [1, 2, 3]. This supports a narrow technical guard only; it does not establish a separate product, Dagster necessity, recurring user pain or paid demand.",
  executedAt: result.executedAt,
  environment: "Windows 10 x64; Python 3.12.10; Great Expectations 1.24.0; pandas 2.2.3; numpy 2.1.0; isolated packages; no upstream source changes.",
  inputOrigin: "Public Great Expectations Issue #12331 quote plus three fixed synthetic pandas Series: uint8 [3,2,1], uint8 [1,2,3], and int64 [3,2,1]. No user documents, customer data or external messages.",
  projectIds: ["103071520", "131619646"],
  sources: [
    { repository: "fivetran/great_expectations", commit: "bcde7b56218fa84fd7d888f75141733038e68ce1" },
    { repository: "dagster-io/dagster", commit: "d6a9059fa8c10f4b7bf47239ac3b01cf374b7c49" },
  ],
  checks: [
    { label: "Reported uint8 false positive", observation: "Great Expectations returned success=true and unexpected_count=0 for uint8 [3,2,1] with strictly=true.", outcome: "supported" },
    { label: "Independent comparator blocks decreasing uint8", observation: "Direct adjacent ordering rejected both decreasing pairs and returned success=false with unexpected_count=2.", outcome: "supported" },
    { label: "Increasing uint8 control remains allowed", observation: "Direct adjacent ordering accepted uint8 [1,2,3] with zero failing pairs.", outcome: "supported" },
    { label: "Signed control remains correctly rejected", observation: "Great Expectations and direct adjacent ordering both rejected int64 [3,2,1].", outcome: "supported" },
    { label: "Separate product need", observation: "No workflow frequency, operational cost, independent users or willingness-to-pay evidence was collected.", outcome: "inconclusive" },
  ],
  limitations: [
    "Only three tiny Series were tested; this does not cover nulls, equal values, other unsigned dtypes, extension arrays or distributed backends.",
    "The comparator is a diagnostic guard, not a packaged adapter and was not deployed into Dagster.",
    "The public Issue is one report; its open state and observed repository commits do not prove the defect remains in every release.",
    "No real user workflow, frequency, time cost, replacement comparison or payment evidence was collected.",
    "The fixed PyPI package was executed; upstream source commits were recorded for provenance but not built or modified.",
  ],
  nextAction: "Do not implement the proposed adapter or Dagster chain yet. Refresh Issue #12331 and release history for an upstream fix, then seek authorized evidence from a real data engineering workflow; if a local assertion is sufficient or no recurring pain is demonstrated, stop the combination direction.",
  artifacts,
});
const target = resolve(root, process.env.DATA_DIR || ".data", "technical-experiments", id);
mkdirSync(target, { recursive: true });
const serialized = JSON.stringify(record, null, 2);
const recordPath = resolve(target, "record.json");
if (existsSync(recordPath)) assert.equal(readFileSync(recordPath, "utf8"), serialized, "Archive is immutable");
for (const [name] of files) copyFileSync(resolve(run, name), resolve(target, name));
writeFileSync(resolve(target, "record.json.tmp"), serialized);
renameSync(resolve(target, "record.json.tmp"), recordPath);
console.log(JSON.stringify({ id, artifacts: artifacts.length, modelCalls: 0, apiWrites: 0 }));
