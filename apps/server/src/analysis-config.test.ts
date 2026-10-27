import { describe, expect, it } from "vitest";
import { analysisConfiguration } from "./analysis-config.js";

describe("analysis backend configuration", () => {
  it("defaults to free OpenCode then the existing local Codex config even when a paid DeepSeek key is present", () => {
    const config = analysisConfiguration({ OPENCODE_BIN: process.execPath, CODEX_BIN: process.execPath, CODEX_MODEL: "test-model", DEEPSEEK_API_KEY: "must-not-be-used" });
    expect(config.mode).toBe("local");
    expect(config.provider?.provider).toBe("local-cli");
    expect(config.codexFallback).toBe(true);
    expect(config.model).toBe("opencode/glm-5.3-flash-free -> codex/test-model");
  });
  it("keeps missing CLI explicit without selecting the available paid API", () => {
    const config = analysisConfiguration({ OPENCODE_BIN: "Z:/missing/opencode.exe", CODEX_BIN: "Z:/missing/codex.exe", DEEPSEEK_API_KEY: "must-not-be-used" });
    expect(config.state).toBe("needs_cli");
    expect(config.provider).toBeNull();
  });
  it("retains DeepSeek only through explicit configuration", () => {
    expect(analysisConfiguration({ ANALYSIS_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test-only" }).provider?.provider).toBe("deepseek");
    expect(analysisConfiguration({ ANALYSIS_PROVIDER: "deepseek" }).state).toBe("needs_api_key");
    expect(analysisConfiguration({ ANALYSIS_PROVIDER: "rules" }).provider).toBeNull();
  });
  it("supports explicit Codex and free-only OpenCode modes", () => {
    expect(analysisConfiguration({ ANALYSIS_PROVIDER: "codex", CODEX_BIN: process.execPath, CODEX_MODEL: "test-model" }).provider?.provider).toBe("codex");
    const free = analysisConfiguration({ ANALYSIS_PROVIDER: "opencode", OPENCODE_BIN: process.execPath });
    expect(free.provider?.provider).toBe("opencode"); expect(free.codexFallback).toBe(false);
  });
});
