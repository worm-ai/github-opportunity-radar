import { describe, expect, it, vi } from "vitest";
import { EvidenceFallbackTransport, EvidenceOnlyTransport } from "./rules.js";
import type { CompletionTransport } from "./transport.js";
import { z } from "zod";
import { demandPlanSchema, evaluationSchema, researchDemand, reviewSchema } from "./demand.js";

const input = { candidates: [{ fullName: "sample/world" }] };
const selectionSchema = { properties: { selected: {}, skipped: {} } };
const synthesisSchema = z.object({ evaluation: evaluationSchema, review: reviewSchema }).strict();

describe("evidence-only degradation", () => {
  it("returns a conservative empty evaluation without inventing a path", async () => {
    const transport = new EvidenceOnlyTransport();
    const result = await transport.complete("", {}, { properties: { paths: {}, gapQueries: {} } });
    expect(JSON.parse(result.content)).toMatchObject({ paths: [], gapQueries: [] });
  });

  it("returns the nested source-synthesis contract without inventing paths", async () => {
    const transport = new EvidenceOnlyTransport();
    const result = await transport.complete("", {}, z.toJSONSchema(synthesisSchema));
    expect(synthesisSchema.parse(JSON.parse(result.content))).toEqual({
      evaluation: expect.objectContaining({ paths: [], gapQueries: [], conclusion: expect.any(String) }),
      review: { reviews: [], recommendedPathId: null, conclusion: expect.any(String) },
    });
  });

  it.each([
    '我想找一个 Markdown 笔记应用，支持全文检索和离线使用。',
    '比较 SQLite 数据同步实现，要求断网可写并处理冲突。',
    'Find an offline tool using "static site generator" for documentation.',
    '核查 https://github.com/example/notebook 的笔记导出能力。',
  ])("keeps the actual requirement without substituting the simulation case: %s", async question => {
    const result = await new EvidenceOnlyTransport().complete("", { question }, z.toJSONSchema(demandPlanSchema));
    const plan = demandPlanSchema.parse(JSON.parse(result.content));
    expect(plan.capabilities.map(item => item.description).join("")).toContain(question);
    expect(plan.queries.every(item => question.includes(item.query))).toBe(true);
    expect(JSON.stringify(plan)).not.toMatch(/multi-agent|agent persistence|generative agents|三个独立角色|玩家介入/);
    expect(plan.constraints).toEqual([]);
  });

  it("fails before searching when unavailable models cannot interpret an unmarked requirement", async () => {
    const search = vi.fn(), collect = vi.fn();
    const primary: CompletionTransport = { provider: "opencode", model: "opencode/test", complete: vi.fn().mockRejectedValue(new Error("OpenCode 模型调用失败（HTTP 400）")) };
    const result = await researchDemand("我想找一个支持离线编辑和全文搜索的个人笔记应用", {
      transport: new EvidenceFallbackTransport(primary), search, collect, checkpoint: vi.fn(),
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("模型不可用");
    expect(result.plan).toBeNull();
    expect(search).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
  });

  it("records degraded acquisition as partial even if the primary provider identity is retained", async () => {
    const primary: CompletionTransport = { provider: "opencode", model: "opencode/test", complete: vi.fn().mockRejectedValue(new Error("OpenCode 模型调用失败（HTTP 400）")) };
    const search = vi.fn(async () => ({ items: [{ fullName: "sample/notes", description: "Offline notes", url: "https://github.com/sample/notes", license: "MIT", stars: 1, language: "TypeScript", archived: false, fork: false }], total: 1, incomplete: false, observedAt: "2026-10-26T00:00:00Z" }));
    const collect = vi.fn(async () => ({ id: "1", fullName: "sample/notes", url: "https://github.com/sample/notes", description: "An offline Markdown notebook.", readmeExcerpt: "Offline Markdown editing.", license: "MIT", language: "TypeScript", stars: 1, forks: 0, openIssues: 0, createdAt: "2020-01-01", pushedAt: null, observedAt: "2026-10-26T00:00:00Z" }));
    const result = await researchDemand("我想找支持离线编辑的 Markdown 笔记应用", { transport: new EvidenceFallbackTransport(primary), search, collect, checkpoint: vi.fn() });
    expect(result).toMatchObject({ status: "partial", outcome: "insufficient_evidence", recommendedPathId: null });
    expect(result.projects).toHaveLength(1);
    expect(result.warnings.some(item => item.includes("降级模式"))).toBe(true);
    expect(search.mock.calls.map(call => call)).toHaveLength(1);
  });

  it("does not fabricate a domain or lose capability IDs when query refinement requires a model", async () => {
    const transport = new EvidenceOnlyTransport();
    for (const properties of [{ queries: {} }, { queries: {}, capabilityIds: {} }]) {
      await expect(transport.complete("", { question: "离线笔记应用", originalGapQueries: [{ query: "offline notes", capabilityIds: ["offline"] }] }, { properties })).rejects.toThrow("无法可靠扩宽或改写");
    }
  });

  it("falls back after a provider HTTP 400 while preserving non-provider errors", async () => {
    const primary: CompletionTransport = { provider: "opencode", model: "opencode/test", complete: vi.fn().mockRejectedValue(new Error("OpenCode 模型调用失败（HTTP 400）；请检查本机 OpenCode 的模型可用性。未调用 DeepSeek")) };
    const fallback = new EvidenceFallbackTransport(primary);
    const result = await fallback.complete("", input, selectionSchema);
    expect(JSON.parse(result.content).selected).toEqual([{ fullName: "sample/world", reason: expect.any(String) }]);
    expect(fallback.usedEvidenceFallback).toBe(true);
    const bad: CompletionTransport = { ...primary, complete: vi.fn().mockRejectedValue(new Error("OpenCode 输出不是有效 JSON")) };
    await expect(new EvidenceFallbackTransport(bad).complete("", input, selectionSchema)).rejects.toThrow("不是有效 JSON");
  });
});
