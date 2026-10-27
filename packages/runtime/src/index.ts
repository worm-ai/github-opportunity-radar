import { randomUUID } from "node:crypto";
import { registerWorker, type IIIClient } from "iii-sdk";

export type ExecutionMode = "local" | "iii";
export type RuntimeTask = "scan" | "analyze-opportunities" | "collect-evidence";

export interface RuntimeAdapter {
  readonly mode: ExecutionMode;
  readonly engineState: string;
  readonly completedExecutions: number;
  ready(timeoutMs?: number): Promise<void>;
  run<T>(handler: () => Promise<T>, task?: RuntimeTask): Promise<T>;
  close(): Promise<void>;
}

export class InProcessRuntimeAdapter implements RuntimeAdapter {
  readonly mode = "local" as const;
  readonly engineState = "not_configured";
  completedExecutions = 0;

  async ready() {}

  async run<T>(handler: () => Promise<T>) {
    const result = await handler();
    this.completedExecutions += 1;
    return result;
  }

  async close() {}
}

export class IiiSdkRuntimeAdapter implements RuntimeAdapter {
  private readonly worker: IIIClient;
  private readonly executions = new Map<string, () => Promise<unknown>>();
  completedExecutions = 0;

  constructor(url: string, private readonly namespace = process.env.III_NAMESPACE || "opportunity-radar") {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace)) throw new Error("Invalid iii function namespace");
    this.worker = registerWorker(url, {
      namespace: this.namespace,
      workerName: "github-opportunity-radar",
      workerDescription: "Collect GitHub repositories and update the local opportunity radar.",
      enableMetricsReporting: false,
      invocationTimeoutMs: 600_000,
      otel: { enabled: false },
    });
    this.worker.registerFunction(`${this.namespace}::ping`, async () => ({ ok: true }));
    for (const task of ["scan", "analyze-opportunities", "collect-evidence"] as const) {
      this.worker.registerFunction(`${this.namespace}::${task}`, async ({ executionKey }: { executionKey: string }) => {
        const execute = this.executions.get(executionKey);
        if (!execute) throw new Error("iii invocation is no longer available");
        // Consume once: a repeated delivery must never repeat collection or a paid model call.
        this.executions.delete(executionKey);
        return execute();
      }, { description: task === "scan" ? "Collect GitHub evidence as W2A signals." : task === "collect-evidence" ? "Collect bounded repository documentation as W2A evidence." : "Generate and review evidence-grounded opportunity hypotheses." });
    }
  }

  get mode(): ExecutionMode {
    return "iii";
  }

  get engineState() {
    return this.worker.getConnectionState();
  }

  async ready(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.worker.getConnectionState() !== "connected") {
      if (this.worker.getConnectionState() === "failed" || Date.now() >= deadline) {
        throw new Error(`iii Engine is unavailable (${this.engineState}); start the engine and retry`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // A successful round trip verifies function registration as well as the WebSocket.
    await this.worker.trigger({ function_id: `${this.namespace}::ping`, payload: {}, timeoutMs: Math.max(1, deadline - Date.now()) });
  }

  async run<T>(handler: () => Promise<T>, task: RuntimeTask = "scan"): Promise<T> {
    await this.ready();
    const executionKey = randomUUID();
    // The callback runs here, but iii transports its failure as a generic SDK error.
    // Retain its original type and fields for domain HTTP/status/retry handling.
    let handlerFailure: { cause: unknown } | undefined;
    this.executions.set(executionKey, async () => {
      try { return await handler(); }
      catch (cause) { handlerFailure = { cause }; throw cause; }
    });
    try {
      const result = await this.worker.trigger<{ executionKey: string }, T>({
        function_id: `${this.namespace}::${task}`,
        payload: { executionKey },
        // Each model stage has a 90-second core deadline. Reserve time for bounded
        // session interruption/deletion across selection, proposal, and review.
        timeoutMs: task === "scan" ? 900_000 : task === "collect-evidence" ? 90_000 : 720_000,
      });
      this.completedExecutions += 1;
      return result;
    } catch (cause) {
      throw handlerFailure ? handlerFailure.cause : cause;
    } finally {
      this.executions.delete(executionKey);
    }
  }

  close() {
    return this.worker.shutdown();
  }
}

export function createRuntimeAdapter(iiiUrl?: string, namespace?: string): RuntimeAdapter {
  if (!iiiUrl) return new InProcessRuntimeAdapter();
  const url = new URL(iiiUrl);
  if (!["ws:", "wss:"].includes(url.protocol)) throw new Error("III_URL must use ws:// or wss://");
  return new IiiSdkRuntimeAdapter(iiiUrl, namespace);
}
