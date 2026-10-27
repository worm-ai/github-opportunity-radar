import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { OpenCodeTransport, findOpenCodeBinary } from "../packages/analysis/dist/index.js";

const startedAt = new Date().toISOString();
let result;
try {
  const binary = findOpenCodeBinary(process.env.OPENCODE_BIN);
  assert.ok(binary, "OpenCode CLI not found; set OPENCODE_BIN");
  const completion = await new OpenCodeTransport({ binary, timeoutMs: 60_000 }).complete(
    "Return JSON only with ok true.", { check: "isolated CLI integration" },
    { type: "object", properties: { ok: { const: true } }, required: ["ok"], additionalProperties: false },
  );
  assert.deepEqual(JSON.parse(completion.content), { ok: true });
  result = { startedAt, finishedAt: new Date().toISOString(), status: "succeeded", model: completion.model, finishReason: completion.finishReason, promptTokens: completion.promptTokens, completionTokens: completion.completionTokens, valid: true };
} catch (error) {
  result = { startedAt, finishedAt: new Date().toISOString(), status: "failed", error: error.message };
  process.exitCode = 1;
}
mkdirSync(".data/opencode-integration", { recursive: true });
writeFileSync(".data/opencode-integration/real-probe.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
