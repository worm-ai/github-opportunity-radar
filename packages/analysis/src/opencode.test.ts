import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OPENCODE_MODEL, OpenCodeTransport, type OpenCodeRunner } from "./opencode.js";

const free = (id: string, input = 0) => ({ id, providerID: "opencode", enabled: true, status: "active", cost: [{ input, output: 0, cache: { read: 0, write: 0 } }] });
function harness(options: { catalog?: unknown[]; output?: (model: string, sessionId: string) => string; confirmPermissions?: boolean; timeout?: boolean | ((model: string) => boolean); receipt?: Record<string, any> } = {}) {
  let sequence = 0;
  const sessions = new Map<string, string>();
  const payloads: any[] = [];
  const runs: string[] = [];
  const directories = new Set<string>();
  const success = (id: string) => [
    { type: "text", sessionID: id, part: { text: '```json\n{"candidates":[]}\n```' } },
    { type: "step_finish", sessionID: id, part: { reason: "stop", tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 1 } } } },
  ].map(x => JSON.stringify(x)).join("\n");
  const runner = vi.fn<OpenCodeRunner>(async (_binary, args, { cwd }) => {
    directories.add(cwd);
    if (args[0] === "api" && args[2] === "/api/model") return { stdout: JSON.stringify({ data: options.catalog ?? [free("glm-5.3-flash-free")] }), code: 0 };
    if (args[0] === "api" && args[1] === "GET" && args[2]?.includes("/message/")) return { stdout: JSON.stringify({ data: options.receipt }), code: 0 };
    if (args[0] === "api" && args[1] === "POST" && args[2] === "/api/session") {
      const body = JSON.parse(args[4]!); payloads.push(body);
      const id = `ses_test${++sequence}`; sessions.set(id, `opencode/${body.model.id}`);
      return { stdout: JSON.stringify({ data: { id, permissions: options.confirmPermissions === false ? [] : body.permissions } }), code: 0 };
    }
    if (args[0] === "run") {
      const id = args[args.indexOf("--session") + 1]!, model = args[args.indexOf("-m") + 1]!.split("#")[0]!;
      expect(sessions.get(id)).toBe(model);
      const attachment = JSON.parse(await readFile(args[args.indexOf("--file") + 1]!, "utf8"));
      expect(attachment.instructions).toContain("outputSchema");
      expect(attachment.taskData).toEqual({ source: "untrusted $(whoami) `shell` material" });
      runs.push(model);
      if (options.timeout === true || typeof options.timeout === "function" && options.timeout(model)) throw new Error("OpenCode 调用超时；已停止等待，不会切换到 DeepSeek");
      return { stdout: options.output ? options.output(model, id) : success(id), code: 0 };
    }
    return { stdout: "", code: 0 };
  });
  return { runner, payloads, runs, directories };
}
const quota = (id: string) => JSON.stringify({ type: "error", sessionID: id, error: { status: 429, type: "provider.quota", message: "secret-vendor-body" } });
const task = { source: "untrusted $(whoami) `shell` material" };

describe("OpenCode zero-priced analysis transport", () => {
  it("prefers GLM, allows reading only its input, attaches bounded data without shell interpolation, accounts usage and removes its temporary directory", async () => {
    const h = harness();
    const result = await new OpenCodeTransport({ binary: "fake-opencode.exe", runner: h.runner }).complete("instructions", task, {});
    expect(result).toEqual({ content: '{"candidates":[]}', model: DEFAULT_OPENCODE_MODEL, finishReason: "stop", promptTokens: 14, completionTokens: 7 });
    const inputPath = h.runner.mock.calls.find(([, args]) => args[0] === "run")![1];
    expect(h.payloads[0].permissions).toEqual([{ action: "*", resource: "*", effect: "deny" }, { action: "read", resource: inputPath[inputPath.indexOf("--file") + 1]!.replaceAll("\\", "/"), effect: "allow" }]);
    expect(h.runs).toEqual([DEFAULT_OPENCODE_MODEL]);
    expect([...h.directories].every(dir => !existsSync(dir))).toBe(true);
    expect(h.runner.mock.calls.some(([, args]) => args[1] === "DELETE")).toBe(true);
  });
  it("falls back only to verified free models and cools down a limited GLM", async () => {
    const h = harness({ catalog: [free("paid-model-free", 1), free("glm-5.3-flash-free"), free("minimax-free")], output: (model, id) => model === DEFAULT_OPENCODE_MODEL ? quota(id) : [
      { type: "text", sessionID: id, part: { text: '{"candidates":[]}' } }, { type: "step_finish", sessionID: id, part: { reason: "stop" } },
    ].map(x => JSON.stringify(x)).join("\n") });
    const transport = new OpenCodeTransport({ binary: "fake", runner: h.runner });
    const result = await transport.complete("system", task, {});
    expect(result.model).toBe("opencode/minimax-free");
    expect(result.promptTokens).toBeUndefined();
    await transport.complete("system", task, {});
    expect(h.runs).toEqual([DEFAULT_OPENCODE_MODEL, "opencode/minimax-free", "opencode/minimax-free"]);
    expect(h.runner.mock.calls.some(([, args]) => args[2]?.endsWith("/interrupt"))).toBe(true);
  });
  it("retries a timed-out MiniMax next stage instead of cooling it for ten minutes", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("minimax-m3.1-flash-free"), free("longcat-2.5-preview-free")], timeout: model => model.includes("minimax"), output: (model, id) => model === DEFAULT_OPENCODE_MODEL ? quota(id) : [
      { type: "text", sessionID: id, part: { text: '{"candidates":[]}' } }, { type: "step_finish", sessionID: id, part: { reason: "stop" } },
    ].map(value => JSON.stringify(value)).join("\n") });
    const transport = new OpenCodeTransport({ binary: "fake", runner: h.runner });
    await transport.complete("system", task, {});
    await transport.complete("system", task, {});
    expect(h.runs).toEqual([DEFAULT_OPENCODE_MODEL, "opencode/minimax-m3.1-flash-free", "opencode/longcat-2.5-preview-free", "opencode/minimax-m3.1-flash-free", "opencode/longcat-2.5-preview-free"]);
  });
  it("retries a rate-limited GLM after its short cooldown expires", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("minimax-free")], output: (model, id) => quota(id) });
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    try {
      const transport = new OpenCodeTransport({ binary: "fake", runner: h.runner });
      await expect(transport.complete("system", task, {})).rejects.toThrow("最多 6 个");
      clock.mockReturnValue(30_001);
      await expect(transport.complete("system", task, {})).rejects.toThrow("最多 6 个");
      expect(h.runs).toEqual([DEFAULT_OPENCODE_MODEL, "opencode/minimax-free", DEFAULT_OPENCODE_MODEL, "opencode/minimax-free"]);
    } finally { clock.mockRestore(); }
  });
  it("uses low reasoning only when the verified free catalog declares that variant", async () => {
    const h = harness({ catalog: [{ ...free("glm-5.3-flash-free"), variants: [{ id: "low" }, { id: "max" }] }] });
    const result = await new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {});
    expect(result.model).toBe(DEFAULT_OPENCODE_MODEL);
    expect(h.payloads[0].model.variant).toBe("low");
    const args = h.runner.mock.calls.find(([, args]) => args[0] === "run")![1];
    expect(args[args.indexOf("-m") + 1]).toBe(`${DEFAULT_OPENCODE_MODEL}#low`);
  });
  it("limits a stage to six models, omits vendor bodies, and never falls back to a paid API", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("second-free"), free("third-free"), free("fourth-free"), free("fifth-free"), free("sixth-free"), free("seventh-free")], output: (_model, id) => quota(id) });
    await expect(new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {})).rejects.toThrow("最多 6 个");
    expect(h.runs).toHaveLength(6);
    expect(h.runs.every(model => model.startsWith("opencode/"))).toBe(true);
    expect(h.runner.mock.calls.filter(([, args]) => args[1] === "DELETE")).toHaveLength(6);
  });
  it("reaches another verified free model when GLM, MiniMax and Nemotron are unavailable", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("minimax-m3.1-flash-free"), free("nemotron-3.5-super-vl-free"), free("big-pickle")], output: (model, id) => model === "opencode/big-pickle" ? [
      { type: "text", sessionID: id, part: { text: '{"candidates":[]}' } }, { type: "step_finish", sessionID: id, part: { reason: "stop" } },
    ].map(x => JSON.stringify(x)).join("\n") : quota(id) });
    const result = await new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {});
    expect(result.model).toBe("opencode/big-pickle");
    expect(h.runs).toEqual([DEFAULT_OPENCODE_MODEL, "opencode/minimax-m3.1-flash-free", "opencode/nemotron-3.5-super-vl-free", "opencode/big-pickle"]);
  });
  it("prefers MiniMax after GLM without starving the first inference as the catalog grows", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("minimax-m3.1-flash-free"), free("nemotron-3.5-super-vl-free"), free("longcat-2.5-preview-free"), free("fourth-free"), free("fifth-free"), free("sixth-free")], output: (model, id) => model === DEFAULT_OPENCODE_MODEL ? quota(id) : [
      { type: "text", sessionID: id, part: { text: '{"candidates":[]}' } }, { type: "step_finish", sessionID: id, part: { reason: "stop" } },
    ].map(x => JSON.stringify(x)).join("\n") });
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    try {
      const result = await new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {});
      expect(result.model).toBe("opencode/minimax-m3.1-flash-free");
      expect(h.runs).toEqual([DEFAULT_OPENCODE_MODEL, "opencode/minimax-m3.1-flash-free"]);
      expect(h.runner.mock.calls.filter(([, args]) => args[0] === "run").every(([, , options]) => options.timeoutMs === 70_000)).toBe(true);
    } finally { clock.mockRestore(); }
  });
  it("tries MiniMax before Lightning when both have a verified zero price", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("minimax-m3.1-flash-free"), free("nemotron-3.5-lightning-free"), free("longcat-2.5-preview-free")], output: (model, id) => model === DEFAULT_OPENCODE_MODEL ? quota(id) : [
      { type: "text", sessionID: id, part: { text: '{"candidates":[]}' } }, { type: "step_finish", sessionID: id, part: { reason: "stop" } },
    ].map(x => JSON.stringify(x)).join("\n") });
    const result = await new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {});
    expect(result.model).toBe("opencode/minimax-m3.1-flash-free");
    expect(h.runs).toEqual([DEFAULT_OPENCODE_MODEL, "opencode/minimax-m3.1-flash-free"]);
  });
  it("switches a forbidden GLM to another free model but stops on invalid shared credentials", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("minimax-m3.1-flash-free")], output: (model, id) => JSON.stringify({ type: "error", sessionID: id, error: { status: model === DEFAULT_OPENCODE_MODEL ? 403 : 401, type: "provider.auth" } }) });
    await expect(new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {})).rejects.toThrow("模型调用失败");
    expect(h.runs).toEqual([DEFAULT_OPENCODE_MODEL, "opencode/minimax-m3.1-flash-free"]);
  });
  it.each([408, 410, 425, 500, 502, 503, 504])("falls back on transient provider status %i without exposing its body", async status => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("minimax-free")], output: (model, id) => model === DEFAULT_OPENCODE_MODEL
      ? JSON.stringify({ type: "error", sessionID: id, error: { status, type: "provider.error", message: "secret-vendor-body" } })
      : [
        { type: "text", sessionID: id, part: { text: '{"candidates":[]}' } },
        { type: "step_finish", sessionID: id, part: { reason: "stop" } },
      ].map(event => JSON.stringify(event)).join("\n") });
    const result = await new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {});
    expect(result.model).toBe("opencode/minimax-free");
    expect(h.runs).toEqual([DEFAULT_OPENCODE_MODEL, "opencode/minimax-free"]);
  });
  it.each([400, 401, 413, 422])("does not fall back on non-transient provider status %i", async status => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("minimax-free")], output: (_model, id) =>
      JSON.stringify({ type: "error", sessionID: id, error: { status, type: "provider.error", message: "secret-vendor-body" } }) });
    await expect(new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {}))
      .rejects.toThrow(`HTTP ${status}`);
    expect(h.runs).toEqual([DEFAULT_OPENCODE_MODEL]);
  });
  it("refuses unknown prices and nonzero cache prices even when a name says free", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free", 1), { ...free("cache-free"), cost: [{ input: 0, output: 0, cache: { read: 1 } }] }, { ...free("unknown-free"), cost: [] }] });
    await expect(new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {})).rejects.toThrow("零价格");
    expect(h.runs).toEqual([]);
  });
  it("requires the CLI to confirm disabled tools before any inference", async () => {
    const h = harness({ confirmPermissions: false });
    await expect(new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {})).rejects.toThrow("未确认只读输入文件");
    expect(h.runs).toEqual([]);
  });
  it.each([
    [{ type: "text", part: { text: '{"candidates":[]}' } }],
    [{ type: "text", part: { text: '{"candidates":[]}' } }, { type: "step_finish", part: { reason: "length" } }],
    [{ type: "tool_use", part: {} }],
    [{ type: "text", sessionID: "ses_other", part: { text: "{}" } }],
  ])("rejects unfinished, truncated, tool-using or mixed-session output", async (...events) => {
    const h = harness({ output: () => events.map(x => JSON.stringify(x)).join("\n") });
    await expect(new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {})).rejects.toThrow();
    expect(h.runs).toHaveLength(1); // Output failures do not trigger model shopping.
  });
  it("interrupts a timed-out GLM session and continues with a free fallback", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("minimax-m3.1-flash-free")], timeout: (model) => model === DEFAULT_OPENCODE_MODEL });
    const result = await new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {});
    expect(result.model).toBe("opencode/minimax-m3.1-flash-free");
    expect(h.runs).toEqual([DEFAULT_OPENCODE_MODEL, "opencode/minimax-m3.1-flash-free"]);
    expect(h.runner.mock.calls.some(([, args]) => args[2]?.endsWith("/interrupt"))).toBe(true);
    expect([...h.directories].every(dir => !existsSync(dir))).toBe(true);
  });
  it("reports a timeout only after every eligible free fallback has failed", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free")], timeout: true });
    await expect(new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {})).rejects.toThrow("调用超时");
    expect(h.runner.mock.calls.some(([, args]) => args[2]?.endsWith("/interrupt"))).toBe(true);
  });
  it("deducts failed-session cleanup from the time available to a fallback model", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("minimax-m3.1-flash-free")], timeout: model => model === DEFAULT_OPENCODE_MODEL });
    let elapsed = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => elapsed);
    const runner: OpenCodeRunner = async (binary, args, options) => {
      if (args[0] === "run" || args[1] === "DELETE" || args[2]?.endsWith("/interrupt")) elapsed += options.timeoutMs;
      return h.runner(binary, args, options);
    };
    try {
      const result = await new OpenCodeTransport({ binary: "fake", runner }).complete("system", task, {});
      expect(result.model).toBe("opencode/minimax-m3.1-flash-free");
      const inference = h.runner.mock.calls.filter(([, args]) => args[0] === "run");
      expect(inference[0]![2].timeoutMs).toBe(75_000);
      // The first timeout and its 10-second cleanup leave only five seconds.
      expect(inference[1]![2].timeoutMs).toBe(5_000);
      expect(elapsed).toBe(95_000); // Successful-session deletion has its own limit.
    } finally { clock.mockRestore(); }
    expect([...h.directories].every(dir => !existsSync(dir))).toBe(true);
  });
  it("cleans up after the core deadline without starting another model", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("minimax-m3.1-flash-free")], timeout: true });
    let elapsed = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => elapsed);
    const runner: OpenCodeRunner = async (binary, args, options) => {
      if (args[0] === "run") elapsed = 1_000;
      return h.runner(binary, args, options);
    };
    try {
      await expect(new OpenCodeTransport({ binary: "fake", runner, timeoutMs: 1_000 }).complete("system", task, {})).rejects.toThrow("调用超时");
      expect(h.runs).toEqual([DEFAULT_OPENCODE_MODEL]);
      const cleanup = h.runner.mock.calls.filter(([, args]) => args[1] === "DELETE" || args[2]?.endsWith("/interrupt"));
      expect(cleanup).toHaveLength(2);
      expect(cleanup.every(([, , options]) => options.timeoutMs === 5_000)).toBe(true);
    } finally { clock.mockRestore(); }
    expect([...h.directories].every(dir => !existsSync(dir))).toBe(true);
  });
  it("gives the next fallback a usable inference budget when the reserved time is nearly consumed", async () => {
    const h = harness({ catalog: [free("glm-5.3-flash-free"), free("longcat-2.5-preview-free"), free("minimax-m3.1-flash-free"), free("nemotron-3.5-super-vl-free"), free("fourth-free"), free("fifth-free")], timeout: model => model === DEFAULT_OPENCODE_MODEL });
    let elapsed = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => elapsed);
    const runner: OpenCodeRunner = async (binary, args, options) => {
      if (args[0] === "run" && h.runs.length === 0) elapsed += options.timeoutMs;
      if (args[1] === "DELETE" || args[2]?.endsWith("/interrupt")) elapsed += options.timeoutMs;
      return h.runner(binary, args, options);
    };
    try {
      const result = await new OpenCodeTransport({ binary: "fake", runner }).complete("system", task, {});
      expect(result.model).toBe("opencode/minimax-m3.1-flash-free");
      const inference = h.runner.mock.calls.filter(([, args]) => args[0] === "run");
      expect(inference[0]![2].timeoutMs).toBe(70_000);
      expect(inference[1]![2].timeoutMs).toBe(5_000);
    } finally { clock.mockRestore(); }
    expect([...h.directories].every(dir => !existsSync(dir))).toBe(true);
  });
  const receipt = { id: "msg_test", type: "assistant", model: { providerID: "opencode", id: "glm-5.3-flash-free" }, time: { completed: 1 }, finish: "stop", content: [{ type: "text", text: '{"candidates":[]}' }], tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 1 } } };
  const v2Output = (model: string, sessionID: string) => JSON.stringify({ type: "text", sessionID, part: { messageID: "msg_test", text: '{"candidates":[]}' } });
  it("confirms CLI 2.x completion and usage with its exact persisted assistant message", async () => {
    const h = harness({ output: v2Output, receipt });
    const result = await new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {});
    expect(result).toMatchObject({ content: '{"candidates":[]}', promptTokens: 14, completionTokens: 7, model: DEFAULT_OPENCODE_MODEL });
    expect(h.runner.mock.calls.some(([, args]) => args[2]?.endsWith("/message/msg_test"))).toBe(true);
  });
  it.each([
    { time: {} }, { finish: "length" }, { model: { providerID: "opencode", id: "paid" } },
    { content: [{ type: "tool", name: "shell" }] }, { content: [{ type: "text", text: "different result" }] }, { id: "msg_other" },
  ])("refuses incomplete, mixed-model or mismatched CLI 2.x receipts: %j", async patch => {
    const h = harness({ output: v2Output, receipt: { ...receipt, ...patch } });
    await expect(new OpenCodeTransport({ binary: "fake", runner: h.runner }).complete("system", task, {})).rejects.toThrow("回执未确认");
    expect(h.runs).toHaveLength(1);
  });
});
