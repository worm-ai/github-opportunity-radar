import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ state: "connected", options: null as { namespace: string } | null, handlers: new Map<string, (input: { executionKey: string }) => Promise<unknown>>(), trigger: vi.fn(), shutdown: vi.fn() }));
vi.mock("iii-sdk", () => ({ registerWorker: (_url: string, options: { namespace: string }) => { mock.options = options; return ({
  registerFunction: (id: string, handler: (input: { executionKey: string }) => Promise<unknown>) => mock.handlers.set(id, handler),
  getConnectionState: () => mock.state, trigger: mock.trigger, shutdown: mock.shutdown,
}); } }));
import { createRuntimeAdapter, IiiSdkRuntimeAdapter } from "./index.js";

beforeEach(() => {
  mock.state = "connected";
  mock.handlers.clear();
  mock.trigger.mockReset().mockImplementation(async ({ function_id, payload }) => mock.handlers.get(function_id)!(payload));
});

describe("runtime selection and failures", () => {
  it("requires explicit local mode and counts successful calls", async () => {
    const runtime = createRuntimeAdapter();
    expect(runtime.mode).toBe("local");
    expect(await runtime.run(async () => 42)).toBe(42);
    expect(runtime.completedExecutions).toBe(1);
  });

  it.each(["analyze-opportunities", "collect-evidence"] as const)("routes %s through the Engine exactly once", async (task) => {
    const runtime = new IiiSdkRuntimeAdapter("ws://127.0.0.1:49134");
    const handler = vi.fn(async () => "done");
    expect(await runtime.run(handler, task)).toBe("done");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mock.trigger.mock.calls.map(([request]) => request.function_id)).toEqual(["opportunity-radar::ping", `opportunity-radar::${task}`]);
    const request = mock.trigger.mock.calls[1]![0];
    await expect(mock.handlers.get(request.function_id)!(request.payload)).rejects.toThrow("no longer available");
  });

  it("never falls back silently when the configured Engine is unavailable", async () => {
    mock.state = "failed";
    const runtime = createRuntimeAdapter("ws://127.0.0.1:49134");
    const handler = vi.fn(async () => "must not run");
    expect(runtime.mode).toBe("iii");
    await expect(runtime.run(handler)).rejects.toThrow("unavailable");
    expect(handler).not.toHaveBeenCalled();
  });

  it("preserves callback error identity when the Engine transports a generic failure", async () => {
    const runtime = new IiiSdkRuntimeAdapter("ws://127.0.0.1:49134");
    const upstream = Object.assign(new Error("quota exhausted"), { code: "rate_limited", retryAt: "2026-10-20T13:00:00.000Z" });
    mock.trigger.mockImplementation(async ({ function_id, payload }) => {
      try { return await mock.handlers.get(function_id)!(payload); }
      catch { throw new Error("SDK invocation failed"); }
    });
    await expect(runtime.run(async () => { throw upstream; }, "collect-evidence")).rejects.toBe(upstream);
    expect(runtime.completedExecutions).toBe(0);
    const handler = vi.fn(async () => "recovered");
    expect(await runtime.run(handler, "collect-evidence")).toBe("recovered");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("isolates integration workers from the live application namespace", async () => {
    const runtime = createRuntimeAdapter("ws://127.0.0.1:49134", "radar-test-isolated");
    expect(mock.options?.namespace).toBe("radar-test-isolated");
    await runtime.run(async () => "isolated", "analyze-opportunities");
    expect(mock.trigger.mock.calls.map(([request]) => request.function_id)).toEqual(["radar-test-isolated::ping", "radar-test-isolated::analyze-opportunities"]);
    expect(mock.handlers.has("opportunity-radar::scan")).toBe(false);
  });

  it("does not convert invalid Engine configuration into local execution", () => {
    expect(() => createRuntimeAdapter("https://localhost:49134")).toThrow("ws://");
  });
});
