import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { CodexTransport, findCodexBinary, configuredCodexModel } from "../packages/analysis/dist/index.js";

const startedAt = new Date().toISOString();
let result;
try {
  const binary = findCodexBinary(process.env.CODEX_BIN);
  const model = configuredCodexModel(process.env.CODEX_MODEL);
  assert.ok(binary && model, "Codex CLI/model not found; configure CODEX_BIN and CODEX_MODEL");
  const completion = await new CodexTransport({ binary, model }).complete("Return JSON only with ok true.", { check: "isolated CLI integration" }, { type: "object", properties: { ok: { const: true } }, required: ["ok"], additionalProperties: false });
  assert.deepEqual(JSON.parse(completion.content), { ok: true });
  result = { startedAt, finishedAt: new Date().toISOString(), status: "succeeded", ...completion };
} catch (error) {
  result = { startedAt, finishedAt: new Date().toISOString(), status: "failed", error: error.message };
  process.exitCode = 1;
}
mkdirSync(".data/codex-integration", { recursive: true });
writeFileSync(".data/codex-integration/real-probe.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
