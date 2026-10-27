import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createExperimentRunManager, registerExperimentRunRoutes } from "./experiment-runs.js";

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "radar-experiment-run-"));
  const dataDirectory = resolve(root, "data");
  const stateDirectory = resolve(dataDirectory, "technical-experiment-runs");
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(resolve(stateDirectory, "run-0123456789abcdef0123456789abcdef.json"), JSON.stringify({
    id: "run-0123456789abcdef0123456789abcdef", experimentId: "agent-world-adaptation-2026-10-23", status: "running",
    startedAt: "2026-10-26T00:00:00.000Z", finishedAt: null, command: ["node", "fixed.mjs"], logFile: "run-0123456789abcdef0123456789abcdef.log", outputTail: "partial", error: null,
  }));
  return { root, dataDirectory };
}

describe("controlled experiment runs", () => {
  it("recovers a run left behind by a service restart as failed", () => {
    const { root, dataDirectory } = fixture();
    const manager = createExperimentRunManager({ workspaceRoot: root, archiveRoot: resolve(root, "archive"), dataDirectory });
    expect(manager.list()[0]).toMatchObject({ status: "failed", error: expect.stringContaining("服务重启") });
  });

  it("rejects unknown experiments instead of accepting arbitrary commands", async () => {
    const { root, dataDirectory } = fixture();
    const app = Fastify();
    registerExperimentRunRoutes(app, createExperimentRunManager({ workspaceRoot: root, archiveRoot: resolve(root, "archive"), dataDirectory }));
    const response = await app.inject({ method: "POST", url: "/experiments/unknown/runs", payload: {} });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("experiment_not_runnable");
  });

  it("exposes only allowlisted experiments as runnable", () => {
    const { root, dataDirectory } = fixture();
    const manager = createExperimentRunManager({ workspaceRoot: root, archiveRoot: resolve(root, "archive"), dataDirectory });
    expect(manager.runnableIds()).toEqual(expect.arrayContaining(["agent-world-adaptation-2026-10-23", "agent-world-continuous-crash-2026-10-27-v4"]));
    expect(manager.runnableIds()).not.toContain("unknown");
  });
});
