import assert from "node:assert/strict";
import { IiiSdkRuntimeAdapter } from "../packages/runtime/dist/index.js";

process.env.III_NAMESPACE = `radar-smoke-${process.pid}`;
const runtime = new IiiSdkRuntimeAdapter(process.env.III_URL || "ws://127.0.0.1:49134");
try {
  await runtime.ready();
  let calls = 0;
  const result = await runtime.run(async () => {
    calls += 1;
    const reviewed = await runtime.run(async () => ({ accepted: 2 }), "analyze-opportunities");
    return { runId: "engine-smoke", reviewed };
  });
  assert.deepEqual(result, { runId: "engine-smoke", reviewed: { accepted: 2 } });
  assert.equal(calls, 1);
  assert.equal(runtime.mode, "iii");
  assert.equal(runtime.completedExecutions, 2);
  console.log(JSON.stringify({ engineState: runtime.engineState, completedExecutions: runtime.completedExecutions, nestedInvocation: "passed" }));
} finally {
  await runtime.close();
}
