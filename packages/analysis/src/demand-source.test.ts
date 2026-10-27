import { expect, it, vi } from "vitest";
import { materializeSourceReference, researchDemandSources, type DemandInventory, type PreviouslyReadSourceRanges } from "./demand-source.js";
import type { DemandSnapshot } from "./demand.js";
import type { CompletionTransport } from "./transport.js";
import { EvidenceOnlyTransport } from "./rules.js";

const quote = "state.memory.push(event);", commitSha = "a".repeat(40), sha = "b".repeat(40);
function parent(): DemandSnapshot {
  return { version: "demand-research-v1", question: "Build autonomous agents sharing persistent memories.", provider: "codex", model: "fixture", status: "succeeded", stage: "finished",
    plan: { summary: "Shared agent memories", capabilities: [{ id: "memory", description: "Agents use and save memories", required: true, origin: "user" }], constraints: [], assumptions: [], questions: [], queries: [{ query: "agent memory", reason: "Find agent memory implementations" }] },
    searches: [], selections: [], collections: [], projects: [{ id: "1", fullName: "sample/world", url: "https://github.com/sample/world", license: "MIT", language: "TypeScript", observedAt: "2026-10-20T00:00:00Z" }],
    sources: [{ id: "1:readme:0", projectId: "1", field: "readme", url: "https://github.com/sample/world", observedAt: "2026-10-20T00:00:00Z", content: "Agents use and save memories in a shared world.", path: null, sha: null, commitSha: null, notice: "Unpinned README" }],
    evaluations: [], reviews: null, recommendedPathId: null, outcome: "insufficient_evidence", warnings: [], calls: [], error: null };
}
const input = { projectIds: ["1"], capabilityIds: ["memory"] };
const finding = (projectId = "1") => ({ projectId, capabilityId: "memory", conclusion: "Memory writes exist but the decision and persistence loop remains unproven.", chain: ["definition", "write", "decision", "action", "persistence"].map(step => ({ step, status: step === "write" ? "located" : "not_read", note: "Only the actual memory write has been read.", evidence: step === "write" ? [{ sourceId: `${projectId}:code:1`, line: 1, fragment: "start" }] : [] })) });
const assessment = () => ({ findings: [finding()], evaluation: { paths: [], gapQueries: [], conclusion: "Source evidence is insufficient to recommend a path." }, review: { reviews: [], recommendedPathId: null, conclusion: "Need to verify actual decision reads and save/restore." } });
const findingOutput = (result = assessment()) => ({ findings: result.findings });
const synthesisOutput = (result = assessment()) => ({ evaluation: result.evaluation, review: result.review });
const response = (data: unknown) => ({ content: JSON.stringify(data), promptTokens: 100, completionTokens: 50, finishReason: "stop" });
function setup() {
  const snapshots: DemandSnapshot[] = [];
  const complete = vi.fn<CompletionTransport["complete"]>().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent.ts", reason: "Inspect actual memory writes and reads" }] })).mockResolvedValueOnce(response(findingOutput())).mockResolvedValueOnce(response(synthesisOutput()));
  const inventory = vi.fn(async (): Promise<DemandInventory> => ({ fullName: "sample/world", commitSha, observedAt: "2026-10-23T00:00:00Z", files: [{ path: "src/agent.ts", sha, size: quote.length }], complete: true, warnings: [] }));
  const read = vi.fn(async (_inventory: DemandInventory, path: string, _maxChars: number, startLine = 1) => ({ path, sha, commitSha, url: `https://github.com/sample/world/blob/${commitSha}/${path}#L${startLine}-L${startLine}`, observedAt: "2026-10-23T00:00:00Z", content: quote, startLine, endLine: startLine, totalLines: startLine, truncated: false }));
  const dependencies = { transport: { provider: "codex" as const, model: "fixture", complete }, inventory, read, previouslyRead: [] as PreviouslyReadSourceRanges[], checkpoint: async (snapshot: DemandSnapshot) => { snapshots.push(snapshot); } };
  return { dependencies, snapshots, complete, inventory, read };
}

it("resumes failed synthesis with evidence-only output through the real validation boundary", async () => {
  const original = parent(), { dependencies, complete, inventory, read } = setup();
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent.ts", reason: "Inspect memory implementation" }] }))
    .mockResolvedValueOnce(response(findingOutput())).mockRejectedValueOnce(new Error("Synthesis unavailable"));
  const failed = await researchDemandSources("parent-id", original, input, dependencies);
  expect(failed.calls.at(-1)).toMatchObject({ stage: "source_synthesis", status: "failed" });
  const before = structuredClone(failed);
  inventory.mockClear(); read.mockClear();
  const resumed = await researchDemandSources("parent-id", original, input, { ...dependencies, transport: new EvidenceOnlyTransport(), reuse: { runId: "failed-synthesis", snapshot: failed } });
  expect(resumed).toMatchObject({ stage: "finished", status: "partial", outcome: "insufficient_evidence", recommendedPathId: null, evaluations: [{ paths: [], gapQueries: [] }], reviews: { reviews: [], recommendedPathId: null } });
  expect(resumed.calls).toMatchObject([{ stage: "source_synthesis", model: "rules/evidence-only", status: "succeeded" }]);
  expect(resumed.sources).toEqual(failed.sources);
  expect(resumed.sourceStudy?.findings).toEqual(failed.sourceStudy?.findings);
  expect(failed).toEqual(before);
  expect(inventory).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});

it("continues without search, preserves immutable parent material, records exact code lines and only new model usage", async () => {
  const original = parent(), before = structuredClone(original), { dependencies, complete, snapshots } = setup();
  original.projects.push({ ...original.projects[0]!, id: "unselected", fullName: "sample/unselected" });
  original.sources.push({ ...original.sources[0]!, id: "unselected:readme", projectId: "unselected", content: "Unrelated project material must not enter the focused analysis." });
  Object.assign(before, structuredClone(original));
  const result = await researchDemandSources("parent-id", original, input, dependencies);
  expect(result).toMatchObject({ status: "succeeded", outcome: "insufficient_evidence", recommendedPathId: null, sourceStudy: { parentId: "parent-id", input, charsRead: quote.length, findings: [expect.objectContaining({ projectId: "1" })] } });
  expect(original).toEqual(before);
  expect(result.sources[0]).toEqual(before.sources[0]);
  expect(result.sources.at(-1)).toMatchObject({ field: "code", content: quote, startLine: 1, endLine: 1, sha, commitSha });
  expect(result.sourceStudy?.findings[0]?.chain[1]?.evidence[0]).toEqual({ sourceId: "1:code:1", startLine: 1, endLine: 1, quote });
  expect(result.searches).toEqual([]);
  expect(complete).toHaveBeenCalledTimes(3);
  const modelSources = (complete.mock.calls[1]![1] as { sources: Array<{ field: string; content?: string; numberedLines?: string }> }).sources;
  expect(modelSources.find(source => source.field === "code")).toMatchObject({ numberedLines: `1: ${quote}` });
  expect(modelSources.find(source => source.field === "code")?.content).toBeUndefined();
  expect(modelSources).toHaveLength(1);
  expect((complete.mock.calls[0]![1] as { selectedCapabilities: unknown }).selectedCapabilities).toEqual(original.plan!.capabilities);
  expect((complete.mock.calls[1]![1] as { selectedCapabilities: unknown }).selectedCapabilities).toEqual(original.plan!.capabilities);
  const synthesisInput = complete.mock.calls[2]![1] as { findings: unknown[]; sources?: unknown[] };
  expect(synthesisInput.findings).toHaveLength(1); expect(synthesisInput.sources).toBeUndefined();
  expect(result.calls).toEqual([expect.objectContaining({ stage: "source_selection", promptTokens: 100 }), expect.objectContaining({ stage: "source_assessment", completionTokens: 50 }), expect.objectContaining({ stage: "source_synthesis", completionTokens: 50 })]);
  expect(snapshots.some(item => item.sources.some(source => source.field === "code") && item.stage === "collecting")).toBe(true);
});

it.each(["wrong_line", "wrong_source", "missing_chain"])("rejects invalid source assessment (%s) and keeps acquired evidence", async mode => {
  const { dependencies, complete } = setup(), output = assessment();
  const step = output.findings[0]!.chain[1]!;
  if (mode === "wrong_line") step.evidence[0]!.line = 2;
  if (mode === "wrong_source") step.evidence[0]!.sourceId = "another:code:1";
  if (mode === "missing_chain") output.findings[0]!.chain[0]!.step = "write";
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent.ts", reason: "Read the agent source" }] })).mockResolvedValueOnce(response(findingOutput(output))).mockResolvedValueOnce(response(synthesisOutput()));
  const result = await researchDemandSources("parent-id", parent(), input, dependencies);
  expect(result.status).toBe("failed");
  expect(result.error).toMatch(/核验失败|引文必须来自单一行/);
  expect(result.sources).toHaveLength(2);
  expect(result.recommendedPathId).toBeNull();
});

it("refuses hallucinated paths before reading any file", async () => {
  const { dependencies, complete, read } = setup();
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "guessed/memory.ts", reason: "This path was never returned by GitHub" }] }));
  const result = await researchDemandSources("parent-id", parent(), input, dependencies);
  expect(result.status).toBe("failed"); expect(read).not.toHaveBeenCalled(); expect(complete).toHaveBeenCalledOnce();
  expect(result.sourceStudy?.inventories[0]?.inventory?.commitSha).toBe(commitSha);
});

it("bounds model-visible paths, prioritizes the selected capability, and preserves the audited shortlist", async () => {
  const { dependencies, complete, inventory } = setup();
  const files = [
    ...Array.from({ length: 240 }, (_, index) => ({ path: `docs/guide-${index}.md`, sha, size: 100 })),
    { path: "src/agent/plan.ts", sha, size: 100 },
    { path: "src/agent/scheduler.ts", sha, size: 100 },
    { path: "src/tests/plan.test.ts", sha, size: 100 },
  ];
  inventory.mockResolvedValue({ fullName: "sample/world", commitSha, observedAt: "2026-10-23T00:00:00Z", files, complete: true, warnings: [] });
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent/plan.ts", reason: "Inspect goal-driven planning" }] })).mockResolvedValueOnce(response(findingOutput())).mockResolvedValueOnce(response(synthesisOutput()));
  const result = await researchDemandSources("parent-id", parent(), input, dependencies);
  const request = complete.mock.calls[0]![1] as { inventories: Array<{ sourcePathCount: number; files: Array<{ path: string }> }> };
  const candidates = result.sourceStudy!.selectionCandidates!;
  expect(request.inventories[0]!.sourcePathCount).toBe(files.length);
  expect(request.inventories[0]!.files).toHaveLength(160);
  expect(request.inventories[0]!.files.slice(0, 2).map(file => file.path)).toEqual(["src/agent/plan.ts", "src/agent/scheduler.ts"]);
  expect(candidates).toHaveLength(160);
  expect(candidates.map(file => file.path)).toEqual(request.inventories[0]!.files.map(file => file.path));
  expect(result.warnings.some(item => item.includes("未列出的路径仍属未知"))).toBe(true);
  expect(result.status).toBe("succeeded");
});

it("rejects a model-selected path outside the persisted shortlist", async () => {
  const { dependencies, complete, inventory, read } = setup();
  inventory.mockImplementation(async () => ({ fullName: "sample/world", commitSha, observedAt: "2026-10-23T00:00:00Z", files: [
    { path: "src/agent.ts", sha, size: 20 },
    ...Array.from({ length: 160 }, (_, index) => ({ path: `src/agent/core-${index}.ts`, sha, size: 20 })),
    { path: "docs/hidden-from-model.md", sha, size: 20 },
  ], complete: true, warnings: [] }));
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "docs/hidden-from-model.md", reason: "Invented beyond the bounded shortlist" }] }));
  const result = await researchDemandSources("parent-id", parent(), input, dependencies);
  expect(result.status).toBe("failed");
  expect(result.error).toContain("未知路径");
  expect(result.sourceStudy?.selectionCandidates).toHaveLength(160);
  expect(result.sourceStudy?.selectionCandidates?.some(file => file.path === "docs/hidden-from-model.md")).toBe(false);
  expect(read).not.toHaveBeenCalled();
});

it("excludes successfully read files from earlier studies of the same pinned commit", async () => {
  const { dependencies, complete, read } = setup();
  dependencies.previouslyRead = [{ projectId: "1", commitSha, ranges: [{ path: "src/agent.ts", startLine: 1, endLine: 1, complete: true }] }];
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent.ts", reason: "Repeat a prior read" }] }));
  const result = await researchDemandSources("parent-id", parent(), input, dependencies);
  const selectionInput = complete.mock.calls[0]![1] as { previouslyRead: string[] };
  expect(selectionInput.previouslyRead).toContain("1:src/agent.ts");
  expect(result.status).toBe("failed");
  expect(read).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledOnce();
});

it("allows a previously read path when the repository commit has changed", async () => {
  const { dependencies, complete, read } = setup();
  dependencies.previouslyRead = [{ projectId: "1", commitSha: "c".repeat(40), ranges: [{ path: "src/agent.ts", startLine: 1, endLine: 1, complete: true }] }];
  const result = await researchDemandSources("parent-id", parent(), input, dependencies);
  expect(result.status).toBe("succeeded");
  expect(read).toHaveBeenCalledOnce();
  expect((complete.mock.calls[0]![1] as { previouslyRead: string[] }).previouslyRead).toEqual([]);
});

it("reads the next uncovered line range of a truncated file and preserves absolute citation lines", async () => {
  const { dependencies, complete, read } = setup();
  dependencies.previouslyRead = [{ projectId: "1", commitSha, ranges: [{ path: "src/agent.ts", startLine: 1, endLine: 3, complete: false }] }];
  read.mockImplementation(async (_inventory, path, _maxChars, startLine = 1) => ({ path, sha, commitSha, url: `https://github.com/sample/world/blob/${commitSha}/${path}#L${startLine}-L4`, observedAt: "2026-10-23T00:00:00Z", content: "decision = act(state);", startLine, endLine: 4, totalLines: 4, truncated: false }));
  const result = await researchDemandSources("parent-id", parent(), input, dependencies);
  expect((complete.mock.calls[0]![1] as { previouslyRead: string[]; partialRanges: Array<{ projectId: string; ranges: unknown[] }> }).previouslyRead).toEqual([]);
  expect((complete.mock.calls[0]![1] as { partialRanges: Array<{ projectId: string; ranges: unknown[] }> }).partialRanges[0]?.ranges).toHaveLength(1);
  expect(read).toHaveBeenCalledWith(expect.anything(), "src/agent.ts", 12000, 4);
  expect(result.sources.at(-1)).toMatchObject({ startLine: 4, endLine: 4, truncated: false });
});

it("shows bounded exact fragments for long lines while validating citations against raw source", async () => {
  const { dependencies, complete, read } = setup(), suffix = "_suffix_evidence_token", longLine = `prefix_${"x".repeat(1400)}${suffix}`;
  read.mockImplementation(async (_inventory, path) => ({ path, sha, commitSha, url: "https://github.com/sample/world", observedAt: "2026-10-23T00:00:00Z", content: longLine, startLine: 1, endLine: 1, totalLines: 1, truncated: false }));
  const output = assessment(); output.findings[0]!.chain[1]!.evidence[0]!.fragment = "end";
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent.ts", reason: "Inspect long-line implementation" }] })).mockResolvedValueOnce(response(findingOutput(output))).mockResolvedValueOnce(response(synthesisOutput()));
  const result = await researchDemandSources("parent-id", parent(), input, dependencies);
  expect(result.status).toBe("succeeded");
  const request = complete.mock.calls[1]![1] as { sources: Array<{ field: string; numberedLines?: string }> };
  const lines = request.sources.find(source => source.field === "code")?.numberedLines;
  expect(lines).toContain("prefix_"); expect(lines).toContain(suffix); expect(lines).toContain("omitted 829 chars");
  expect(result.sourceStudy?.findings[0]?.chain[1]?.evidence[0]?.quote).toBe(longLine.slice(-300));
});

it("retains acquired text and per-call usage on a failed second model stage", async () => {
  const { dependencies, complete } = setup();
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent.ts", reason: "Read the memory write implementation" }] })).mockRejectedValueOnce(new Error("Model timeout"));
  const result = await researchDemandSources("parent-id", parent(), input, dependencies);
  expect(result).toMatchObject({ status: "failed", error: "Model timeout", calls: [expect.objectContaining({ status: "succeeded", promptTokens: 100 }), expect.objectContaining({ status: "failed" })] });
  expect(result.sources.at(-1)?.content).toBe(quote);
});

it("resumes a failed assessment with pinned text, one new call, no acquisition and immutable failed history", async () => {
  const { dependencies, complete, inventory, read } = setup(), original = parent();
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent.ts", reason: "Read the memory implementation" }] })).mockRejectedValueOnce(new Error("Model timeout"));
  const saved = await researchDemandSources("parent-id", original, input, dependencies);
  saved.sources.at(-1)!.startLine = 20; saved.sources.at(-1)!.endLine = 20; saved.sources.at(-1)!.totalLines = 20;
  const before = structuredClone(saved);
  const resumedAssessment = assessment(); resumedAssessment.findings[0]!.chain[1]!.evidence[0]!.line = 20;
  complete.mockReset().mockResolvedValueOnce(response(findingOutput(resumedAssessment))).mockResolvedValueOnce(response(synthesisOutput())); inventory.mockClear(); read.mockClear();
  const result = await researchDemandSources("parent-id", original, input, { ...dependencies, reuse: { runId: "failed-run", snapshot: saved } });
  expect(result).toMatchObject({ status: "succeeded", sourceStudy: { resumedFrom: "failed-run", charsRead: quote.length, findings: [expect.objectContaining({ projectId: "1" })] }, calls: [expect.objectContaining({ stage: "source_assessment", status: "succeeded", promptTokens: 100 }), expect.objectContaining({ stage: "source_synthesis", status: "succeeded" })] });
  expect(result.sources).toEqual(saved.sources); expect(saved).toEqual(before);
  expect(complete).toHaveBeenCalledTimes(2); expect(inventory).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});

it("resumes a source citation validation failure without reacquiring or mutating the rejected snapshot", async () => {
  const { dependencies, complete, inventory, read } = setup(), original = parent();
  const rejected = assessment(); rejected.findings[0]!.chain[1]!.evidence[0]!.line = 2;
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent.ts", reason: "Read the decision path" }] })).mockResolvedValueOnce(response(findingOutput(rejected))).mockResolvedValueOnce(response(synthesisOutput()));
  const failed = await researchDemandSources("parent-id", original, input, dependencies);
  expect(failed).toMatchObject({ status: "failed", error: expect.stringContaining("源码补证核验失败：源码引用来源或行号无效（1:code:1:2") });
  expect(failed.calls.at(-1)).toMatchObject({ stage: "source_assessment", status: "succeeded" });
  const before = structuredClone(failed), retriedAssessment = assessment(); retriedAssessment.findings[0]!.chain[1]!.evidence[0]!.line = 1;
  complete.mockReset().mockResolvedValueOnce(response(findingOutput(retriedAssessment))).mockResolvedValueOnce(response(synthesisOutput())); inventory.mockClear(); read.mockClear();
  const resumed = await researchDemandSources("parent-id", original, input, { ...dependencies, reuse: { runId: "citation-failure", snapshot: failed } });
  expect(resumed).toMatchObject({ status: "succeeded", sourceStudy: { resumedFrom: "citation-failure", findings: [expect.objectContaining({ projectId: "1" })] }, calls: [expect.objectContaining({ stage: "source_assessment", status: "succeeded" }), expect.objectContaining({ stage: "source_synthesis", status: "succeeded" })] });
  expect(resumed.calls).toHaveLength(2);
  expect(failed).toEqual(before);
  expect(complete).toHaveBeenCalledTimes(2); expect(inventory).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});

it("resumes failed synthesis from persisted verified findings without repeating source analysis", async () => {
  const { dependencies, complete, inventory, read } = setup(), original = parent();
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent.ts", reason: "Read the memory implementation" }] }))
    .mockResolvedValueOnce(response(findingOutput())).mockRejectedValueOnce(new Error("Synthesis timeout"));
  const failed = await researchDemandSources("parent-id", original, input, dependencies);
  expect(failed.status).toBe("failed");
  expect(failed.calls).toMatchObject([expect.objectContaining({ stage: "source_selection", status: "succeeded" }), expect.objectContaining({ stage: "source_assessment", status: "succeeded" }), expect.objectContaining({ stage: "source_synthesis", status: "failed" })]);
  expect(failed.sourceStudy?.findings).toEqual([expect.objectContaining({ projectId: "1" })]);
  const before = structuredClone(failed);
  complete.mockReset().mockResolvedValueOnce(response(synthesisOutput())); inventory.mockClear(); read.mockClear();
  const resumed = await researchDemandSources("parent-id", original, input, { ...dependencies, reuse: { runId: "failed-synthesis", snapshot: failed } });
  expect(resumed).toMatchObject({ status: "succeeded", sourceStudy: { resumedFrom: "failed-synthesis", findings: [expect.objectContaining({ projectId: "1" })] }, calls: [expect.objectContaining({ stage: "source_synthesis", status: "succeeded" })] });
  expect(resumed.sourceStudy?.findings).toEqual(before.sourceStudy?.findings);
  expect(complete).toHaveBeenCalledOnce(); expect(inventory).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});

it.each(["scope", "commit", "lines", "chars", "stage"])("refuses an unsafe assessment resume before model or network IO (%s)", async mode => {
  const { dependencies, complete, inventory, read } = setup(), original = parent();
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent.ts", reason: "Read the memory implementation" }] })).mockRejectedValueOnce(new Error("Model timeout"));
  const saved = await researchDemandSources("parent-id", original, input, dependencies);
  if (mode === "scope") saved.sourceStudy!.input.capabilityIds = ["other"];
  if (mode === "commit") saved.sources.at(-1)!.commitSha = "c".repeat(40);
  if (mode === "lines") saved.sources.at(-1)!.endLine = 2;
  if (mode === "chars") saved.sourceStudy!.charsRead++;
  if (mode === "stage") saved.calls.at(-1)!.stage = "source_selection";
  complete.mockClear(); inventory.mockClear(); read.mockClear();
  await expect(researchDemandSources("parent-id", original, input, { ...dependencies, reuse: { runId: "failed-run", snapshot: saved } })).rejects.toThrow();
  expect(complete).not.toHaveBeenCalled(); expect(inventory).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});

it("cannot recursively continue or use unrelated capabilities", async () => {
  const { dependencies, inventory, complete } = setup(), original = parent();
  await expect(researchDemandSources("parent-id", original, { ...input, capabilityIds: ["made-up"] }, dependencies)).rejects.toThrow("原研究");
  original.sourceStudy = { parentId: "another-parent", input, inventories: [], files: [], findings: [], charsRead: 0 };
  await expect(researchDemandSources("parent-id", original, input, dependencies)).rejects.toThrow("不自动递归");
  expect(inventory).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
});

it("interleaves alternatives, stops at the shared text budget and does not request skipped files", async () => {
  const { dependencies, complete, inventory, read } = setup(), original = parent();
  original.projects.push({ ...original.projects[0]!, id: "2", fullName: "sample/alternative" });
  inventory.mockImplementation(async () => ({ fullName: inventory.mock.calls.length === 1 ? "sample/world" : "sample/alternative", commitSha, observedAt: "2026-10-23T00:00:00Z", complete: true, warnings: [], files: Array.from({ length: 6 }, (_, index) => ({ path: `source${index}.ts`, sha, size: 12000 })) }));
  const output = assessment();
  output.findings = [finding("1"), finding("2")];
  for (const item of output.findings) for (const step of item.chain) { step.status = "not_read"; step.evidence = []; }
  complete.mockReset().mockResolvedValueOnce(response({ files: ["1", "2"].flatMap(projectId => Array.from({ length: 6 }, (_, index) => ({ projectId, path: `source${index}.ts`, reason: "Read bounded implementation evidence" }))) }))
    .mockResolvedValueOnce(response({ findings: [output.findings[0]] })).mockResolvedValueOnce(response({ findings: [output.findings[1]] })).mockResolvedValueOnce(response(synthesisOutput(output)));
  read.mockImplementation(async (_inventory, path) => ({ path, sha, commitSha, url: "https://github.com/sample/world", observedAt: "2026-10-23T00:00:00Z", content: "x".repeat(12000), startLine: 1, endLine: 1, totalLines: 1, truncated: false }));
  const result = await researchDemandSources("parent-id", original, { ...input, projectIds: ["1", "2"] }, dependencies);
  expect(result.status).toBe("partial");
  expect(result.sourceStudy?.charsRead).toBe(48000); expect(read).toHaveBeenCalledTimes(4);
  expect(read.mock.calls.map(([inv]) => inv.fullName)).toEqual(["sample/world", "sample/alternative", "sample/world", "sample/alternative"]);
  expect(result.sourceStudy?.files.filter(item => item.status === "failed")).toHaveLength(8);
});

it("resumes only unfinished two-file assessment batches and keeps earlier verified batches", async () => {
  const { dependencies, complete, inventory, read } = setup(), original = parent();
  inventory.mockResolvedValue({ fullName: "sample/world", commitSha, observedAt: "2026-10-23T00:00:00Z", complete: true, warnings: [], files: [
    { path: "src/first.ts", sha, size: 20 }, { path: "src/second.ts", sha, size: 20 }, { path: "src/third.ts", sha, size: 20 },
  ] });
  complete.mockReset().mockResolvedValueOnce(response({ files: ["first", "second", "third"].map(name => ({ projectId: "1", path: `src/${name}.ts`, reason: "Read the event processing implementation" })) }))
    .mockResolvedValueOnce(response(findingOutput())).mockRejectedValueOnce(new Error("Second batch timeout"));
  const failed = await researchDemandSources("parent-id", original, input, dependencies);
  expect(failed.status).toBe("failed");
  expect(failed.sourceStudy?.assessmentBatches).toHaveLength(1);
  const priorBatch = structuredClone(failed.sourceStudy!.assessmentBatches![0]);
  const lastFinding = finding(); lastFinding.chain[1]!.evidence[0]!.sourceId = "1:code:3";
  complete.mockReset().mockResolvedValueOnce(response({ findings: [lastFinding] })).mockResolvedValueOnce(response(synthesisOutput()));
  inventory.mockClear(); read.mockClear();
  const resumed = await researchDemandSources("parent-id", original, input, { ...dependencies, reuse: { runId: "partial-batches", snapshot: failed } });
  expect(resumed.status).toBe("succeeded");
  expect(resumed.sourceStudy?.assessmentBatches).toHaveLength(2);
  expect(resumed.sourceStudy?.assessmentBatches?.[0]).toEqual(priorBatch);
  const retriedSources = (complete.mock.calls[0]![1] as { sources: Array<{ path: string }> }).sources;
  expect(retriedSources.map(source => source.path)).toEqual(["src/third.ts"]);
  expect(complete).toHaveBeenCalledTimes(2); expect(inventory).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});

it("materializes the Concordia persistence lines separately instead of joining adjacent dictionary entries", () => {
  const source = { ...parent().sources[0]!, id: "721643027:code:2", field: "code" as const, startLine: 401, endLine: 405,
    content: "    return {\n        'locations': self._locations,\n        'entity_locations': self._entity_locations,\n        'latest_action_spec': action_spec_dict,\n    }" };
  expect(materializeSourceReference({ sourceId: source.id, line: 402, fragment: "start" }, [source]))
    .toEqual({ sourceId: source.id, startLine: 402, endLine: 402, quote: "        'locations': self._locations," });
  expect(materializeSourceReference({ sourceId: source.id, line: 403, fragment: "start" }, [source]).quote).toBe("        'entity_locations': self._entity_locations,");
});

it.each(["shape", "citation", "scope", "duplicate", "missing_batch", "merged_findings"])("rejects corrupt persisted evidence before resuming synthesis (%s)", async mode => {
  const { dependencies, complete, inventory, read } = setup(), original = parent();
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent.ts", reason: "Read the memory implementation" }] }))
    .mockResolvedValueOnce(response(findingOutput())).mockRejectedValueOnce(new Error("Synthesis timeout"));
  const failed = await researchDemandSources("parent-id", original, input, dependencies);
  const batch = failed.sourceStudy!.assessmentBatches![0]!;
  if (mode === "shape") batch.findings[0]!.chain.pop();
  if (mode === "citation") batch.findings[0]!.chain[1]!.evidence[0]!.quote = "invented memory write";
  if (mode === "scope") batch.sourceIds = ["foreign:code:1"];
  if (mode === "duplicate") failed.sourceStudy!.assessmentBatches!.push(structuredClone(batch));
  if (mode === "missing_batch") failed.sourceStudy!.assessmentBatches = [];
  if (mode === "merged_findings") failed.sourceStudy!.findings[0]!.conclusion = "Changed conclusion detached from the saved batch.";
  complete.mockClear(); inventory.mockClear(); read.mockClear();
  await expect(researchDemandSources("parent-id", original, input, { ...dependencies, reuse: { runId: "corrupt-synthesis", snapshot: failed } })).rejects.toThrow();
  expect(complete).not.toHaveBeenCalled(); expect(inventory).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});

it("rejects a reference to a collected file outside the current assessment batch", async () => {
  const { dependencies, complete, inventory } = setup();
  inventory.mockResolvedValue({ fullName: "sample/world", commitSha, observedAt: "2026-10-23T00:00:00Z", complete: true, warnings: [],
    files: ["first", "second", "third"].map(name => ({ path: `src/${name}.ts`, sha, size: quote.length })) });
  const output = findingOutput(); output.findings[0]!.chain[1]!.evidence[0]!.sourceId = "1:code:3";
  complete.mockReset().mockResolvedValueOnce(response({ files: ["first", "second", "third"].map(name => ({ projectId: "1", path: `src/${name}.ts`, reason: "Inspect the memory implementation" })) }))
    .mockResolvedValueOnce(response(output));
  const result = await researchDemandSources("parent-id", parent(), input, dependencies);
  expect(result.error).toContain("源码引用来源或行号无效");
  expect(result.sourceStudy!.assessmentBatches).toEqual([]); expect(complete).toHaveBeenCalledTimes(2);
});

it.each(["unverified_source_line", "readme"])("rejects synthesis citations outside verified capability findings (%s)", async mode => {
  const { dependencies, complete, read } = setup();
  const otherQuote = "state.memory.delete(event);";
  read.mockImplementation(async (_inventory, path) => ({ path, sha, commitSha, url: "https://github.com/sample/world", observedAt: "2026-10-23T00:00:00Z",
    content: `${quote}\n${otherQuote}`, startLine: 1, endLine: 2, totalLines: 2, truncated: false }));
  const citation = mode === "readme" ? { sourceId: "1:readme:0", quote: parent().sources[0]!.content } : { sourceId: "1:code:1", quote: otherQuote };
  const synthesis = { evaluation: { paths: [{ id: "adapt-memory", title: "Adapt a single memory implementation", kind: "adapt", projectIds: ["1"],
    coverage: [{ capabilityId: "memory", status: "partial", reason: "Memory persistence needs further verification.", evidence: [citation] }], constraintsFit: "unknown", constraintReason: "Runtime compatibility remains untested.",
    roles: [{ projectId: "1", responsibility: "Provide agent memory storage", input: "Agent memory events", output: "Stored memories for decisions" }],
    integration: "Connect memory writes to actual agent decisions.", remainingWork: [], risks: ["Decision loop remains untested."],
    experiment: { input: "One saved memory event", steps: ["Restart and inspect the next decision."], pass: "Saved memory changes the decision.", fail: "Memory is missing after restart." } }], gapQueries: [], conclusion: "Need a behavioral experiment before adoption." },
    review: { reviews: [{ pathId: "adapt-memory", verdict: "reject", reason: "Insufficient behavioral evidence", risks: ["Persistence remains unknown."], checks: { capabilitiesGrounded: false, constraintsRespected: true, singleProjectCompared: true, integrationHonest: true, experimentFalsifiable: true } }], recommendedPathId: null, conclusion: "Do not recommend adoption yet." } };
  complete.mockReset().mockResolvedValueOnce(response({ files: [{ projectId: "1", path: "src/agent.ts", reason: "Read memory implementation" }] }))
    .mockResolvedValueOnce(response(findingOutput())).mockResolvedValueOnce(response(synthesis));
  const result = await researchDemandSources("parent-id", parent(), input, dependencies);
  expect(result.error).toContain("综合引用必须来自对应能力已核验的源码发现"); expect(result.recommendedPathId).toBeNull();
});
