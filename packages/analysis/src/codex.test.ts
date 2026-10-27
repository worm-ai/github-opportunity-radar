import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { CodexTransport, LocalCliTransport, type CodexRunner } from "./codex.js";
import { OpenCodeUnavailableError } from "./opencode.js";
import type { CompletionTransport } from "./transport.js";

const task = { source: "Untrusted $(whoami) `command` material" };
const stream = (patch: { tool?: boolean; finish?: boolean; message?: string; warning?: boolean } = {}) => [
  { type: "thread.started", thread_id: "one" },
  ...(patch.warning ? [{ type: "item.completed", item: { type: "error", message: "ignored configuration key" } }] : []),
  { type: "turn.started" },
  ...(patch.tool ? [{ type: "item.started", item: { type: "command_execution", command: "do something" } }] : []),
  { type: "item.completed", item: { type: "agent_message", text: patch.message ?? '{"ok":true}' } },
  ...(patch.finish === false ? [] : [{ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, reasoning_output_tokens: 5 } }]),
].map(value => JSON.stringify(value)).join("\n");

function harness(options: { stdout?: string; last?: string | null; code?: number } = {}) {
  const directories: string[] = [];
  const schemas: unknown[] = [];
  const runner = vi.fn<CodexRunner>(async (_bin, args, call) => {
    directories.push(call.cwd);
    expect(JSON.parse(call.stdin).taskData).toEqual(task);
    const schemaPath = args[args.indexOf("--output-schema") + 1]!;
    schemas.push(JSON.parse(await readFile(schemaPath, "utf8")));
    if (options.last !== null) await writeFile(args[args.indexOf("--output-last-message") + 1]!, options.last ?? '{"ok":true}');
    return { stdout: options.stdout ?? stream(), code: options.code ?? 0 };
  });
  return { runner, directories, schemas };
}

describe("Codex evidence-only transport", () => {
  it("pins the configured model, sends untrusted input through stdin, disables tools, checks both receipts and counts total usage once", async () => {
    const h = harness({ stdout: stream({ warning: true }) });
    const outputSchema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
    const completion = await new CodexTransport({ binary: "fake", model: "existing-model", runner: h.runner }).complete("instructions", task, outputSchema);
    expect(completion).toEqual({ content: '{"ok":true}', model: "codex/existing-model", finishReason: "stop", promptTokens: 100, completionTokens: 20 });
    const args = h.runner.mock.calls[0]![1];
    expect(args.slice(0, 3)).toEqual(["-a", "never", "exec"]);
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--output-schema");
    expect(h.schemas).toEqual([outputSchema]);
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args[args.indexOf("-m") + 1]).toBe("existing-model");
    expect(args).toContain("shell_tool"); expect(args).toContain("plugins"); expect(args).toContain("hooks"); expect(args).toContain("multi_agent");
    expect(args.at(-1)).toBe("-");
    expect(args.some(arg => arg.includes(task.source))).toBe(false);
    expect(h.directories.every(dir => !existsSync(dir))).toBe(true);
  });
  it.each([
    { stdout: stream({ tool: true }) }, { stdout: stream({ finish: false }) },
    { stdout: stream() + '\n{"type":"turn.completed"}' },
    { stdout: stream() + '\n{"type":"thread.started","thread_id":"two"}' },
    { stdout: 'not-json' }, { last: null }, { last: '{"ok":false}' }, { code: 1 },
    { stdout: stream({ message: '```json\n{"ok":true}\n```' }), last: '```json\n{"ok":true}\n```' },
    { stdout: stream({ message: '[]' }), last: '[]' },
    { stdout: '{"type":"error","message":"secret-vendor-body"}' },
  ])("rejects untrusted or incomplete output and cleans up: %j", async options => {
    const h = harness(options);
    await expect(new CodexTransport({ binary: "fake", model: "existing-model", runner: h.runner }).complete("instructions", task, {})).rejects.toThrow();
    expect(h.directories.every(dir => !existsSync(dir))).toBe(true);
  });
  it("includes bounded JSON parse diagnostics for an incomplete model message", async () => {
    const content = '{"ok":';
    const h = harness({ stdout: stream({ message: content }), last: content });
    await expect(new CodexTransport({ binary: "fake", model: "existing-model", runner: h.runner }).complete("instructions", task, {}))
      .rejects.toThrow("6 字符");
  });
  it("propagates timeouts without replacing them with successful results", async () => {
    const runner: CodexRunner = async () => { throw new Error("本机 Codex 调用超时"); };
    await expect(new CodexTransport({ binary: "fake", model: "existing-model", runner }).complete("instructions", task, {})).rejects.toThrow("调用超时");
  });
  it("does not expose malformed model content through JSON diagnostics", async () => {
    const content = "private-repository-material-not-json";
    const h = harness({ stdout: stream({ message: content }), last: content });
    const error = await new CodexTransport({ binary: "fake", model: "existing-model", runner: h.runner }).complete("instructions", task, {}).catch(error => error);
    expect(error.message).toContain(`${content.length} 字符`);
    expect(error.message).not.toContain(content);
  });
});

describe("local CLI availability fallback", () => {
  const transport = (provider: "opencode" | "codex", complete = vi.fn().mockResolvedValue({ content: "{}", model: `${provider}/test` })): CompletionTransport => ({ provider, model: `${provider}/test`, complete });
  it("exhausts free candidates before invoking the local Codex configuration", async () => {
    const primary = transport("opencode", vi.fn().mockRejectedValue(new OpenCodeUnavailableError("all unavailable")));
    const fallback = transport("codex");
    const local = new LocalCliTransport(primary, fallback);
    expect((await local.complete("instructions", task, {})).model).toBe("codex/test");
    expect(primary.complete).toHaveBeenCalledOnce(); expect(fallback.complete).toHaveBeenCalledOnce();
    expect(local.model).toContain("opencode/test -> codex/test");
  });
  it.each(["invalid JSON", "evidence failed", "tool denied", "receipt mismatch"])("never hides an integrity failure with a different model: %s", async message => {
    const fallback = transport("codex");
    await expect(new LocalCliTransport(transport("opencode", vi.fn().mockRejectedValue(new Error(message))), fallback).complete("instructions", task, {})).rejects.toThrow(message);
    expect(fallback.complete).not.toHaveBeenCalled();
  });
  it("keeps free success and supports Codex when OpenCode is absent", async () => {
    const fallback = transport("codex");
    expect((await new LocalCliTransport(transport("opencode"), fallback).complete("instructions", task, {})).model).toBe("opencode/test");
    expect(fallback.complete).not.toHaveBeenCalled();
    expect((await new LocalCliTransport(null, fallback).complete("instructions", task, {})).model).toBe("codex/test");
  });
});
