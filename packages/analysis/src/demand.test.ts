import { describe, expect, it, vi } from "vitest";
import { researchDemand, validateDemandEvaluationResume, validateDemandGapResume, validateDemandSelectionResume, type DemandSnapshot } from "./demand.js";
import type { AnalyzableProject } from "./index.js";
import type { CompletionTransport } from "./transport.js";

const question = "Build a shared world with agents that remember their actions.";
const quote = "Agents remember actions in a shared persistent world.";
const project: AnalyzableProject = { id: "1", fullName: "sample/world", description: quote, readmeExcerpt: "Run the documented local demo to inspect agent behavior.", license: "MIT", language: "Python", stars: 4, forks: 0, openIssues: 0, createdAt: "2020-01-01", pushedAt: "2026-10-20", observedAt: "2026-10-23T00:00:00Z", url: "https://github.com/sample/world" };
const preview = { fullName: project.fullName, description: quote, url: project.url, license: "MIT", stars: 4, language: "Python", archived: false, fork: false };
function plan() { return { summary: "Build a persistent shared agent world", capabilities: [{ id: "world", description: "Persistent shared world with agents", required: true, origin: "user" }], constraints: [], assumptions: ["Small local prototype for initial verification"], questions: [], queries: [{ query: "agent society simulation", reason: "Find complete runnable society simulations" }] }; }
function path() { return { id: "one", title: "Start with a single world implementation", kind: "adopt", projectIds: ["1"], coverage: [{ capabilityId: "world", status: "supported", reason: "Project description states persistent shared world", evidence: [{ sourceId: "1:description:0", quote }] }], constraintsFit: "compatible", constraintReason: "No explicit deployment constraints provided", roles: [{ projectId: "1", responsibility: "Maintains the agent world and its state", input: "Initial world and agent configuration", output: "World events and persistent state" }], integration: "No cross-project integration; actual runtime needs verification", remainingWork: ["Run documented example against the acceptance scenario"], risks: ["Project description is not runtime verification"], experiment: { input: "Three roles and a shared resource", steps: ["Run example and change one environment event"], pass: "World changes persist and agents react", fail: "Actions only produce chat without world changes" } }; }
function evaluation() { return { paths: [path()], gapQueries: [] as Array<{ query: string; reason: string; capabilityIds: string[] }>, conclusion: "Single project appears sufficient; verify the documented scenario" }; }
function review(ids = ["one"], recommendation: string | null = "one") { return { reviews: ids.map(pathId => ({ pathId, verdict: "keep", reason: "Evidence supports a bounded prototype, runtime remains unverified", risks: ["Runtime behavior and cost still need testing"], checks: { capabilitiesGrounded: true, constraintsRespected: true, singleProjectCompared: true, integrationHonest: true, experimentFalsifiable: true } })), recommendedPathId: recommendation, conclusion: "Verify one project first and avoid unnecessary integration" }; }
function setup(outputs: unknown[]) {
  const transport: CompletionTransport = { provider: "codex", model: "test-model", complete: vi.fn() };
  for (const output of outputs) vi.mocked(transport.complete).mockResolvedValueOnce({ content: JSON.stringify(output), finishReason: "stop", promptTokens: 10, completionTokens: 20 });
  const snapshots: DemandSnapshot[] = [];
  return { transport, snapshots, search: vi.fn().mockResolvedValue({ items: [preview], total: 1, incomplete: false, observedAt: project.observedAt }), collect: vi.fn().mockResolvedValue(project), checkpoint: (snapshot: DemandSnapshot) => { snapshots.push(snapshot); } };
}
const selection = { selected: [{ fullName: project.fullName, reason: "Closest complete application for the target" }], skipped: [] };

describe("requirement-driven implementation research", () => {
  it("resumes failed candidate selection from the exact saved plan and initial searches", async () => {
    const failed = setup([plan()]);
    failed.transport.complete = vi.fn().mockResolvedValueOnce({ content: JSON.stringify(plan()), finishReason: "stop" })
      .mockRejectedValueOnce(new Error("selection process exited"));
    const parent = await researchDemand(question, { ...failed, transport: failed.transport });
    expect(parent).toMatchObject({ status: "failed", stage: "failed", calls: [expect.objectContaining({ stage: "plan", status: "succeeded" }), expect.objectContaining({ stage: "selection", status: "failed" })] });
    validateDemandSelectionResume(parent);

    const resumed = setup([selection, { paths: [], gapQueries: [], conclusion: "Saved preview is not enough to recommend an implementation" }]);
    resumed.transport.complete = vi.fn()
      .mockResolvedValueOnce({ content: JSON.stringify(selection), finishReason: "stop" })
      .mockResolvedValueOnce({ content: JSON.stringify({ paths: [], gapQueries: [], conclusion: "Saved preview is not enough to recommend an implementation" }), finishReason: "stop" });
    const result = await researchDemand(question, { ...resumed, resumeSelection: { runId: "failed-selection", snapshot: parent } });
    expect(result).toMatchObject({ status: "partial", selectionResume: { fromRunId: "failed-selection" }, searches: parent.searches, selections: [{ round: 1 }], projects: [expect.objectContaining({ fullName: project.fullName })], calls: [expect.objectContaining({ stage: "selection", status: "succeeded" }), expect.objectContaining({ stage: "evaluation", status: "succeeded" })] });
    expect(result.warnings.join(" ")).toContain("初始搜索不重跑");
    expect(result.warnings.join(" ")).toContain("仍可能按缺口补充搜索");
    expect(resumed.search).not.toHaveBeenCalled();
    expect(resumed.transport.complete).toHaveBeenCalledTimes(2);
  });

  it("rejects selection recovery when the saved preview is incomplete or the failure happened elsewhere", async () => {
    const deps = setup([plan()]);
    deps.transport.complete = vi.fn().mockResolvedValueOnce({ content: JSON.stringify(plan()), finishReason: "stop" }).mockRejectedValueOnce(new Error("selection failed"));
    const saved = await researchDemand(question, deps);
    const missing = structuredClone(saved); missing.searches[0]!.status = "failed";
    expect(() => validateDemandSelectionResume(missing)).toThrow("筛选失败");
    const wrongStage = structuredClone(saved); wrongStage.calls.at(-1)!.stage = "plan";
    expect(() => validateDemandSelectionResume(wrongStage)).toThrow("筛选失败");
  });

  async function failedEvaluation() {
    const deps = setup([plan(), selection]);
    vi.mocked(deps.transport.complete).mockRejectedValueOnce(new Error("evaluation timed out"));
    return researchDemand(question, deps);
  }
  function compactAssessment() {
    return { projectId: "1", capabilities: [{ capabilityId: "world", status: "supported", reason: "资料明确描述共享状态，运行仍待核验", evidence: [{ sourceId: "1:description:0", quote }] }], conclusion: "文档支持候选，但尚未实际运行" };
  }
  it.each(["本机 Codex 调用超时", "本机 Codex 未完整结束，未保存新机会", "OpenCode 调用超时"])("preserves a bounded unreviewed candidate after %s", async error => {
    const saved = await failedEvaluation(), before = structuredClone(saved), deps = setup([]);
    vi.mocked(deps.transport.complete).mockRejectedValueOnce(new Error(error))
      .mockResolvedValueOnce({ content: JSON.stringify(compactAssessment()), finishReason: "stop" });
    const result = await researchDemand(question, { ...deps, reuse: { runId: "failed-run", snapshot: saved } });
    expect(result).toMatchObject({ status: "partial", stage: "finished", outcome: "insufficient_evidence", recommendedPathId: null, reviews: null,
      evaluations: [{ paths: [{ kind: "adapt", constraintsFit: "unknown", coverage: [{ status: "supported" }] }] }] });
    expect(result.calls.map(call => [call.stage, call.status])).toEqual([["evaluation", "failed"], ["evaluation_compact", "succeeded"]]);
    expect(deps.search).not.toHaveBeenCalled(); expect(deps.collect).not.toHaveBeenCalled(); expect(saved).toEqual(before);
    validateDemandEvaluationResume(result);
    const retry = setup([evaluation(), review()]);
    const recovered = await researchDemand(question, { ...retry, reuse: { runId: "compact-run", snapshot: result } });
    expect(recovered.recommendedPathId).toBe("one"); expect(retry.search).not.toHaveBeenCalled(); expect(retry.collect).not.toHaveBeenCalled();
  });
  it.each(["quote", "project", "duplicate", "unknown", "missing-evidence", "ambiguous", "omitted"])("rejects compact %s claims and retains a recoverable failure", async invalid => {
    const saved = await failedEvaluation(), output = compactAssessment(), deps = setup([]);
    if (invalid === "quote") output.capabilities[0]!.evidence[0]!.quote = "Invented evidence absent from every source.";
    if (invalid === "project") output.projectId = "2";
    if (invalid === "duplicate") output.capabilities.push(structuredClone(output.capabilities[0]!));
    if (invalid === "unknown") output.capabilities[0]!.capabilityId = "invented";
    if (invalid === "missing-evidence") output.capabilities[0]!.evidence = [];
    if (invalid === "ambiguous") { saved.sources[1]!.content += quote; output.capabilities[0]!.evidence[0]!.sourceId = "wrong"; }
    if (invalid === "omitted") { saved.sources[1]!.content = "a".repeat(1400) + quote; saved.sources[0]!.content = "No meaningful description available."; output.capabilities[0]!.evidence[0]!.sourceId = saved.sources[1]!.id; }
    vi.mocked(deps.transport.complete).mockRejectedValueOnce(new Error("本机 Codex 未完整结束，未保存新机会"))
      .mockResolvedValueOnce({ content: JSON.stringify(output), finishReason: "stop" });
    const result = await researchDemand(question, { ...deps, reuse: { runId: "failed-run", snapshot: saved } });
    expect(result).toMatchObject({ status: "failed", error: "本机 Codex 未完整结束，未保存新机会", evaluations: [], recommendedPathId: null, reviews: null });
    expect(result.calls.at(-1)).toMatchObject({ stage: "evaluation_compact", status: "failed" });
    expect(result.sources).toEqual(saved.sources); validateDemandEvaluationResume(result);
  });
  it("isolates compact project failures and caps assessment at two captured projects", async () => {
    const saved = await failedEvaluation(), deps = setup([]);
    for (const number of [2, 3]) {
      const id = String(number), fullName = `sample/world-${id}`;
      saved.projects.push({ ...saved.projects[0]!, id, fullName });
      saved.collections.push({ fullName, status: "succeeded", error: null });
      saved.sources.push({ ...saved.sources[0]!, id: `${id}:description:0`, projectId: id });
    }
    const output = compactAssessment(); output.projectId = "2"; output.capabilities[0]!.evidence[0]!.sourceId = "2:description:0";
    vi.mocked(deps.transport.complete).mockRejectedValueOnce(new Error("本机 Codex 调用超时"))
      .mockRejectedValueOnce(new Error("本机 Codex 调用超时"))
      .mockResolvedValueOnce({ content: JSON.stringify(output), finishReason: "stop" });
    const result = await researchDemand(question, { ...deps, reuse: { runId: "failed-run", snapshot: saved } });
    expect(result).toMatchObject({ status: "partial", reviews: null, evaluations: [{ paths: [{ projectIds: ["2"] }] }] });
    expect(deps.transport.complete).toHaveBeenCalledTimes(3);
    expect(result.warnings.join(" ")).toContain("sample/world 分项评估失败");
  });
  it("does not manufacture a path for an all-unknown compact assessment", async () => {
    const saved = await failedEvaluation(), deps = setup([]), output = compactAssessment();
    output.capabilities[0]!.status = "unknown"; output.capabilities[0]!.evidence = [];
    vi.mocked(deps.transport.complete).mockRejectedValueOnce(new Error("本机 Codex 调用超时"))
      .mockResolvedValueOnce({ content: JSON.stringify(output), finishReason: "stop" });
    const result = await researchDemand(question, { ...deps, reuse: { runId: "failed-run", snapshot: saved } });
    expect(result).toMatchObject({ status: "partial", reviews: null, evaluations: [{ paths: [] }] });
  });
  it("bounds excerpts, repairs unique exact citations, fills missing capabilities, and keeps experiments domain neutral", async () => {
    const saved = await failedEvaluation(), deps = setup([]), output = compactAssessment();
    saved.question = "Build an offline Markdown notes application with local file import.";
    saved.plan!.summary = "Build an offline Markdown notes application";
    saved.plan!.capabilities = [{ id: "world", description: "Read local Markdown files", required: true, origin: "user" }, { id: "import", description: "Import existing local files", required: true, origin: "user" }];
    saved.sources[1]!.content += "x".repeat(2000);
    output.capabilities[0]!.evidence[0]!.sourceId = "wrong";
    vi.mocked(deps.transport.complete).mockRejectedValueOnce(new Error("本机 Codex 调用超时"))
      .mockResolvedValueOnce({ content: JSON.stringify(output), finishReason: "stop" });
    const result = await researchDemand(saved.question, { ...deps, reuse: { runId: "failed-run", snapshot: saved } });
    const candidate = result.evaluations[0]!.paths[0]!;
    expect(candidate.coverage[0]!.evidence[0]!.sourceId).toBe("1:description:0");
    expect(candidate.coverage[1]).toMatchObject({ capabilityId: "import", status: "unknown", evidence: [] });
    expect(JSON.stringify(candidate.experiment)).not.toMatch(/三角色|玩家|tick|shared resource/u);
    expect(result.sources).toEqual(saved.sources);
    const sent = vi.mocked(deps.transport.complete).mock.calls[1]![1] as { sources: Array<{ content: string }> };
    expect(sent.sources[1]!.content.length).toBeLessThan(1250);
  });
  it("enters compact mode if the validation retry times out", async () => {
    const saved = await failedEvaluation(), deps = setup([]), invalid = evaluation();
    invalid.paths[0]!.coverage[0]!.evidence[0]!.quote = "Invented evidence absent from every source.";
    vi.mocked(deps.transport.complete).mockResolvedValueOnce({ content: JSON.stringify(invalid), finishReason: "stop" })
      .mockRejectedValueOnce(new Error("本机 Codex 未完整结束"))
      .mockResolvedValueOnce({ content: JSON.stringify(compactAssessment()), finishReason: "stop" });
    const result = await researchDemand(question, { ...deps, reuse: { runId: "failed-run", snapshot: saved } });
    expect(result).toMatchObject({ status: "partial", recommendedPathId: null, reviews: null });
    expect(result.calls.map(call => call.stage)).toEqual(["evaluation", "evaluation", "evaluation_compact"]);
  });
  it("falls back to bounded evidence assessment after a repeated invalid citation", async () => {
    const deps = setup([plan(), selection]);
    const invalid = evaluation();
    invalid.paths[0]!.coverage[0]!.evidence[0]!.quote = "Invented evidence absent from every source.";
    vi.mocked(deps.transport.complete).mockReset()
      .mockResolvedValueOnce({ content: JSON.stringify(plan()), finishReason: "stop" })
      .mockResolvedValueOnce({ content: JSON.stringify(selection), finishReason: "stop" })
      .mockResolvedValueOnce({ content: JSON.stringify(invalid), finishReason: "stop" })
      .mockResolvedValueOnce({ content: JSON.stringify(invalid), finishReason: "stop" })
      .mockResolvedValueOnce({ content: JSON.stringify(compactAssessment()), finishReason: "stop" });
    const result = await researchDemand(question, deps);
    expect(result).toMatchObject({ status: "partial", stage: "finished", outcome: "insufficient_evidence", recommendedPathId: null, reviews: null,
      evaluations: [{ paths: [{ kind: "adapt", constraintsFit: "unknown" }] }] });
    expect(result.calls.map(call => call.stage)).toEqual(["plan", "selection", "evaluation", "evaluation", "evaluation_compact"]);
    expect(result.warnings.join(" ")).toContain("完整模型评估");
  });
  it("retries local evaluation validation once and then reviews the corrected result", async () => {
    const invalid = structuredClone(evaluation());
    invalid.paths[0]!.coverage[0]!.evidence[0]!.quote = "too short";
    const deps = setup([plan(), selection, invalid, evaluation(), review()]);
    const result = await researchDemand(question, deps);
    expect(result).toMatchObject({ status: "succeeded", outcome: "adopt", recommendedPathId: "one" });
    expect(deps.transport.complete).toHaveBeenCalledTimes(5);
    expect(result.calls.map(call => call.stage)).toEqual(["plan", "selection", "evaluation", "evaluation", "review"]);
    expect(result.warnings.some(item => item.includes("重试一次"))).toBe(true);
  });
  it("rebinds an exact quote to its unique source within the path", async () => {
    const invalidAddress = structuredClone(evaluation());
    invalidAddress.paths[0]!.coverage[0]!.evidence[0]!.sourceId = "wrong-source-id";
    const deps = setup([plan(), selection, invalidAddress, review()]);
    const result = await researchDemand(question, deps);
    expect(result).toMatchObject({ status: "partial", outcome: "adopt", recommendedPathId: "one" });
    expect(result.evaluations[0]!.paths[0]!.coverage[0]!.evidence[0]!.sourceId).toBe("1:description:0");
    expect(result.warnings.some(item => item.includes("重新绑定") && item.includes("1"))).toBe(true);
  });

  it("fails after one local evaluation validation retry when the second output is still invalid", async () => {
    const invalid = structuredClone(evaluation());
    invalid.paths[0]!.coverage[0]!.evidence[0]!.quote = "too short";
    const deps = setup([plan(), selection, invalid, invalid]);
    const result = await researchDemand(question, deps);
    expect(result).toMatchObject({ status: "failed", stage: "failed", recommendedPathId: null });
    expect(deps.transport.complete).toHaveBeenCalledTimes(4);
    expect(result.calls.filter(call => call.stage === "evaluation")).toHaveLength(2);
  });
  it("recovers a validation failure without repeating search or collection", async () => {
    const invalid = structuredClone(evaluation());
    invalid.paths[0]!.coverage[0]!.evidence[0]!.quote = "An invented quote that is absent from every source.";
    const first = setup([plan(), selection, invalid, invalid]);
    const saved = await researchDemand(question, first);
    expect(saved.status).toBe("failed");
    validateDemandEvaluationResume(saved);
    const resumed = setup([evaluation(), review()]);
    const result = await researchDemand(question, { ...resumed, reuse: { runId: "validation-failed-run", snapshot: saved } });
    expect(result).toMatchObject({ status: "partial", outcome: "adopt", recommendedPathId: "one", evaluationResume: { fromRunId: "validation-failed-run" } });
    expect(resumed.search).not.toHaveBeenCalled();
    expect(resumed.collect).not.toHaveBeenCalled();
  });
  it("resumes evaluation and review from unchanged captured materials when no gap is found", async () => {
    const saved = await failedEvaluation(), before = structuredClone(saved);
    const deps = setup([evaluation(), review()]);
    const result = await researchDemand(question, { ...deps, reuse: { runId: "failed-run", snapshot: saved } });
    expect(result).toMatchObject({ status: "partial", outcome: "adopt", evaluationResume: { fromRunId: "failed-run", materialVersion: saved.version } });
    expect(result.sources).toEqual(saved.sources);
    expect(result.searches).toEqual(saved.searches);
    expect(result.collections).toEqual(saved.collections);
    expect(result.calls.map(call => call.stage)).toEqual(["evaluation", "review"]);
    expect(deps.search).not.toHaveBeenCalled(); expect(deps.collect).not.toHaveBeenCalled();
    expect(saved).toEqual(before);
  });
  it("replans the original question before recovering evidence-only acquisition and retains existing materials", async () => {
    const saved = await failedEvaluation();
    saved.status = "partial"; saved.stage = "finished"; saved.recommendedPathId = null; saved.reviews = null;
    saved.evaluations = [{ paths: [], gapQueries: [], conclusion: "Evidence-only mode did not evaluate the captured sources" }];
    saved.calls = [{ stage: "evaluation", model: "rules/evidence-only", promptTokens: null, completionTokens: null, status: "succeeded" }];
    saved.warnings.push("模型不可用，已进入证据优先降级模式");
    validateDemandEvaluationResume(saved);
    const before = structuredClone(saved);
    const refreshedPlan = { ...plan(), capabilities: [{ id: "persistent-world", description: "Persistent shared world state", required: true, origin: "user" as const }] };
    const deps = setup([refreshedPlan, { paths: [], gapQueries: [], conclusion: "Captured sources do not establish a usable implementation" }]);
    const result = await researchDemand(question, { ...deps, reuse: { runId: "fallback-run", snapshot: saved } });
    expect(result).toMatchObject({ status: "partial", stage: "finished", plan: { capabilities: [{ id: "persistent-world" }] }, evaluationResume: { fromRunId: "fallback-run", replanned: true }, evaluations: [{ conclusion: "Captured sources do not establish a usable implementation" }] });
    expect(result.sources).toEqual(saved.sources); expect(result.projects).toEqual(saved.projects); expect(result.searches).toEqual(saved.searches);
    expect(result.warnings.join(" " )).toContain("旧降级拆解、筛选理由和评估不作为新判断依据");
    expect(deps.transport.complete).toHaveBeenCalledTimes(2); expect(deps.search).not.toHaveBeenCalled(); expect(deps.collect).not.toHaveBeenCalled();
    expect(saved).toEqual(before);
  });
  it("continues a recovered evaluation gap through bounded search, collection, reevaluation, and review", async () => {
    const saved = await failedEvaluation();
    const gaps = { paths: [], gapQueries: [{ query: "world events", reason: "Need new evidence to resolve the missing behavior", capabilityIds: ["world"] }], conclusion: "Captured sources are still insufficient" };
    const next = { ...project, id: "2", fullName: "sample/new-world", url: "https://github.com/sample/new-world" };
    const deps = setup([gaps, { selected: [{ fullName: next.fullName, reason: "Search result addresses the recorded behavior gap" }], skipped: [] }, {
      paths: [{ ...path(), projectIds: ["2"], roles: [{ ...path().roles[0]!, projectId: "2" }], coverage: [{ ...path().coverage[0]!, evidence: [{ sourceId: "2:description:0", quote }] }] }], gapQueries: [], conclusion: "New evidence provides a candidate path",
    }, review()]);
    deps.search.mockResolvedValue({ items: [{ ...preview, fullName: next.fullName, url: next.url }], total: 1, incomplete: false, observedAt: next.observedAt });
    deps.collect.mockResolvedValue(next);
    const result = await researchDemand(question, { ...deps, reuse: { runId: "failed-run", snapshot: saved } });
    expect(result).toMatchObject({ stage: "finished", outcome: "adopt", evaluationResume: { fromRunId: "failed-run" }, reviews: { recommendedPathId: "one" }, evaluations: [{ paths: [] }, { paths: [expect.objectContaining({ projectIds: ["2"] })] }] });
    expect(deps.search).toHaveBeenCalledWith("world events");
    expect(deps.collect).toHaveBeenCalledWith(next.fullName);
    expect(deps.transport.complete).toHaveBeenCalledTimes(4);
    expect(result.searches.at(-1)).toMatchObject({ phase: "gap", status: "succeeded", total: 1 });
    expect(result.sources).toEqual(expect.arrayContaining(saved.sources));
    expect(saved.projects).toHaveLength(1);

    const noCandidates = setup([gaps]);
    noCandidates.search.mockResolvedValue({ items: [], total: 0, incomplete: false, observedAt: project.observedAt });
    const empty = await researchDemand(question, { ...noCandidates, reuse: { runId: "failed-run", snapshot: saved } });
    expect(empty).toMatchObject({ status: "partial", outcome: "insufficient_evidence", reviews: null });
    expect(empty.warnings.some(item => item.includes("不证明相关实现不存在"))).toBe(true);
    expect(noCandidates.collect).not.toHaveBeenCalled();

    const failed = setup([]); vi.mocked(failed.transport.complete).mockRejectedValueOnce(new Error("still timed out"));
    const retry = await researchDemand(question, { ...failed, reuse: { runId: "failed-run", snapshot: saved } });
    expect(retry).toMatchObject({ status: "failed", error: "still timed out", recommendedPathId: null, sources: saved.sources });
  });
  it("resumes a recorded gap by searching, collecting a new candidate, reevaluating, and reviewing", async () => {
    const initial = setup([plan(), selection, evaluation(), review()]);
    const saved = await researchDemand(question, initial);
    saved.status = "partial";
    saved.evaluations = [{ paths: [], gapQueries: [{ query: "agent events", reason: "Find evidence for the missing world behavior", capabilityIds: ["world"] }], conclusion: "No existing source establishes the required behavior" }];
    saved.reviews = null;
    saved.recommendedPathId = null;
    saved.calls = [{ stage: "evaluation", model: "test-model", promptTokens: 10, completionTokens: 20, status: "succeeded" }];
    validateDemandGapResume(saved);

    const newProject = { ...project, id: "2", fullName: "sample/new-world", url: "https://github.com/sample/new-world" };
    const deps = setup([
      { selected: [{ fullName: newProject.fullName, reason: "Search result addresses the recorded behavior gap" }], skipped: [] },
      { paths: [{ ...path(), projectIds: ["2"], roles: [{ ...path().roles[0]!, projectId: "2" }], coverage: [{ ...path().coverage[0]!, evidence: [{ sourceId: "2:description:0", quote }] }] }], gapQueries: [], conclusion: "New evidence provides a candidate path" },
      review(),
    ]);
    deps.search.mockResolvedValue({ items: [{ ...preview, fullName: newProject.fullName, url: newProject.url }], total: 1, incomplete: false, observedAt: newProject.observedAt });
    deps.collect.mockResolvedValue(newProject);
    const before = structuredClone(saved);
    const resumed = await researchDemand(question, { ...deps, resumeGaps: { runId: "partial-run", snapshot: saved } });

    expect(resumed).toMatchObject({ status: "partial", stage: "finished", gapResume: { fromRunId: "partial-run" }, evaluations: [{ paths: [] }, { paths: [expect.objectContaining({ projectIds: ["2"] })] }], reviews: { recommendedPathId: "one" } });
    expect(deps.search).toHaveBeenCalledWith("agent events");
    expect(deps.collect).toHaveBeenCalledWith(newProject.fullName);
    expect(deps.transport.complete).toHaveBeenCalledTimes(3);
    expect(saved).toEqual(before);
  });
  it("rejects gap resumes with no remaining search budget or a stale evaluation call", async () => {
    const deps = setup([plan(), selection, evaluation(), review()]);
    const saved = await researchDemand(question, deps);
    saved.status = "partial";
    saved.evaluations = [{ paths: [], gapQueries: [{ query: "agent events", reason: "Find evidence for the missing world behavior", capabilityIds: ["world"] }], conclusion: "No existing source establishes the required behavior" }];
    saved.calls = [{ stage: "evaluation", model: "test-model", promptTokens: 10, completionTokens: 20, status: "succeeded" }];
    const exhausted = structuredClone(saved);
    exhausted.searches = Array.from({ length: 6 }, (_, index) => ({ query: `world ${index}`, reason: "A completed bounded repository search", phase: "initial" as const, status: "succeeded" as const, observedAt: project.observedAt, total: 0, incomplete: false, items: [], error: null }));
    expect(() => validateDemandGapResume(exhausted)).toThrow();
    const stale = structuredClone(saved);
    stale.calls[0]!.status = "failed";
    expect(() => validateDemandGapResume(stale)).toThrow();
  });
  it.each(["quote", "review"])("retains evidence and rejects invalid %s on resumed evaluation", async invalid => {
    const saved = await failedEvaluation(), output = evaluation(), opposition = review();
    if (invalid === "quote") output.paths[0]!.coverage[0]!.evidence[0]!.quote = "An invented quote that is absent from every source.";
    else opposition.reviews[0]!.checks.capabilitiesGrounded = false;
    const deps = setup([output, opposition]);
    const result = await researchDemand(question, { ...deps, reuse: { runId: "failed-run", snapshot: saved } });
    expect(result).toMatchObject({ status: "failed", recommendedPathId: null, outcome: "insufficient_evidence", sources: saved.sources });
  });
  it.each(["running", "plan", "collection", "source", "duplicate", "oversize", "stage", "version", "changed"])("rejects incompatible recovery %s before calling any dependency", async invalid => {
    const saved = await failedEvaluation(), deps = setup([]);
    if (invalid === "running") saved.status = "running";
    if (invalid === "plan") saved.plan = null;
    if (invalid === "collection") saved.collections[0]!.status = "running";
    if (invalid === "source") saved.sources[0]!.projectId = "not-collected";
    if (invalid === "duplicate") saved.sources.push(saved.sources[0]!);
    if (invalid === "oversize") saved.sources[0]!.content = "x".repeat(10001);
    if (invalid === "stage") saved.calls.at(-1)!.stage = "review";
    if (invalid === "version") saved.version = "demand-source-v1";
    if (invalid !== "changed") expect(() => validateDemandEvaluationResume(saved)).toThrow();
    await expect(researchDemand(invalid === "changed" ? `${question} Changed goals.` : question, { ...deps, reuse: { runId: "failed-run", snapshot: saved } })).rejects.toThrow();
    expect(deps.transport.complete).not.toHaveBeenCalled(); expect(deps.snapshots).toEqual([]);
  });
  it("finishes with one project, keeps sources and stage snapshots and does not force combinations", async () => {
    const deps = setup([plan(), selection, evaluation(), review()]);
    const result = await researchDemand(question, deps);
    expect(result).toMatchObject({ status: "succeeded", stage: "finished", outcome: "adopt", recommendedPathId: "one" });
    expect(deps.search).toHaveBeenCalledTimes(1);
    expect(result.sources[0]).toMatchObject({ projectId: "1", content: quote, observedAt: project.observedAt });
    expect(result.calls.map(call => call.stage)).toEqual(["plan", "selection", "evaluation", "review"]);
    expect(deps.snapshots[0]?.plan).toBeNull();
    expect(deps.snapshots.some(snapshot => snapshot.collections[0]?.status === "running")).toBe(true);
  });
  it("retains actual search failure without inventing nonexistence or calling evaluation on no data", async () => {
    const deps = setup([plan()]);
    deps.search.mockRejectedValueOnce(new Error("rate limited until later"));
    const result = await researchDemand(question, deps);
    expect(result).toMatchObject({ status: "partial", outcome: "insufficient_evidence" });
    expect(result.searches[0]).toMatchObject({ status: "failed", error: "rate limited until later", incomplete: null });
    expect(deps.collect).not.toHaveBeenCalled();
    expect(deps.transport.complete).toHaveBeenCalledTimes(1);
  });
  it.each(["quote", "project", "coverage", "roles", "adopt", "combination", "gaps"])("rejects invalid %s before the review can endorse it", async invalid => {
    const output = evaluation();
    if (invalid === "quote") output.paths[0]!.coverage[0]!.evidence[0]!.quote = "This exact statement never appears in the source.";
    if (invalid === "project") output.paths[0]!.projectIds = ["not-collected"];
    if (invalid === "coverage") output.paths[0]!.coverage[0]!.capabilityId = "invented";
    if (invalid === "roles") output.paths[0]!.roles[0]!.projectId = "invented";
    if (invalid === "adopt") output.paths[0]!.coverage[0]!.status = "partial";
    if (invalid === "combination") output.paths[0]!.kind = "combine";
    if (invalid === "gaps") output.gapQueries.push({ query: "more worlds", reason: "Unnecessary search despite complete coverage", capabilityIds: ["world"] });
    const deps = setup([plan(), selection, output, review()]);
    const result = await researchDemand(question, deps);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("核验失败");
    expect(result.sources).not.toHaveLength(0);
    expect(result.recommendedPathId).toBeNull();
    expect(deps.transport.complete).toHaveBeenCalledTimes(4);
  });
  it("refuses invented candidates before GitHub collection", async () => {
    const deps = setup([plan(), { selected: [{ fullName: "madeup/repository", reason: "An invented project should never reach collection" }], skipped: [] }]);
    const result = await researchDemand(question, deps);
    expect(result.status).toBe("failed");
    expect(deps.collect).not.toHaveBeenCalled();
  });
  it("searches a remaining capability, collects new evidence and compares a combination with a single-project baseline", async () => {
    const requirement = plan(); requirement.capabilities.push({ id: "player", description: "Player interface to inspect and intervene", required: true, origin: "user" });
    const baseline = path(); baseline.kind = "adapt";
    baseline.coverage.push({ capabilityId: "player", status: "unknown", reason: "No player interface evidence in this snapshot", evidence: [] });
    const first = { paths: [baseline], gapQueries: [{ query: "agent world player interface", reason: "Need an interface for player intervention", capabilityIds: ["player"] }], conclusion: "World exists but player intervention remains unknown" };
    const player = { ...project, id: "2", fullName: "sample/player", description: "Player interface to inspect and intervene in simulated worlds." };
    const combined = { ...structuredClone(baseline), id: "both", title: "Connect world simulation to player interface", kind: "combine", projectIds: ["1", "2"] };
    combined.coverage[1] = { capabilityId: "player", status: "supported", reason: "Player project describes intervention capability", evidence: [{ sourceId: "2:description:0", quote: player.description }] };
    combined.roles.push({ projectId: "2", responsibility: "Player observation and intervention UI", input: "World state and event adapter", output: "Commands to the world; adapter not yet verified" });
    const deps = setup([requirement, selection, first, { selected: [{ fullName: player.fullName, reason: "Addresses the missing player interface" }], skipped: [] }, { paths: [baseline, combined], gapQueries: [], conclusion: "Compare adapter work with extending the original world project" }, review(["one", "both"], "both")]);
    deps.search.mockResolvedValueOnce({ items: [preview], total: 1, incomplete: false, observedAt: project.observedAt }).mockResolvedValueOnce({ items: [{ ...preview, fullName: player.fullName, url: "https://github.com/sample/player" }], total: 1, incomplete: false, observedAt: project.observedAt });
    deps.collect.mockResolvedValueOnce(project).mockResolvedValueOnce(player);
    const result = await researchDemand(question, deps);
    expect(result).toMatchObject({ status: "succeeded", outcome: "combine", recommendedPathId: "both" });
    expect(result.warnings).toContain("组合路径目前只是基于有限源码/文档证据的待验证假设；尚未完成依赖安装、启动、接口与共享状态衔接、运行及失败恢复实验");
    expect(result.searches.map(item => item.phase)).toEqual(["initial", "gap"]);
    expect(result.projects).toHaveLength(2);
    expect(result.evaluations).toHaveLength(2);
    expect(result.calls.some(call => call.stage === "gap_search_refinement")).toBe(false);
  });
  it("reformulates the observed long gap queries once, retains original intent and searches only the compact result", async () => {
    const initial = plan();
    initial.queries = ["html print", "react print", '"paged media"', "json html report"].map(query => ({ query, reason: "Compare bounded repository search results" }));
    const first = { paths: [], gapQueries: [
      { query: "react-to-print standalone offline HTML export inline styles", reason: "Investigate standalone export without a new service", capabilityIds: ["world"] },
      { query: "react-to-print Chinese long URL pre-wrap print overflow regression", reason: "Investigate printable content overflow behavior", capabilityIds: ["world"] },
    ], conclusion: "Existing materials do not establish all required behavior" };
    const short = ["offline html export", "print overflow"].map(query => ({ query, reason: "Find generic implementations without stacking acceptance details", capabilityIds: ["world"] }));
    const deps = setup([initial, selection, first, { queries: short }]);
    const result = await researchDemand(question, deps);
    expect(result).toMatchObject({ status: "succeeded", outcome: "insufficient_evidence" });
    expect(deps.search.mock.calls.map(([query]) => query)).toEqual([...initial.queries, ...short].map(item => item.query));
    expect(result.searches).toHaveLength(6);
    expect(result.evaluations[0]).toEqual(first);
    expect(result.searches.slice(4).map(item => item.query)).toEqual(short.map(item => item.query));
    expect(result.calls.map(call => call.stage)).toEqual(["plan", "selection", "evaluation", "gap_search_refinement"]);
    const payload = vi.mocked(deps.transport.complete).mock.calls[3]![1];
    expect(payload).toEqual({ question, capabilities: initial.capabilities, originalGapQueries: first.gapQueries, executedQueries: initial.queries.map(item => item.query) });
    expect(result.sources[0]?.content).toBe(quote);
  });
  it.each(["transport", "overlong", "scope", "omitted", "duplicate", "too_many", "repeated_query", "already_searched"])("skips invalid gap reformulation (%s) while preserving existing evidence", async invalid => {
    const initial = plan();
    initial.capabilities.push({ id: "player", description: "A player intervention interface", required: true, origin: "user" });
    const first = { paths: [], gapQueries: [{ query: "agent world player interface shared memory events adapter", reason: "Look for both missing capabilities in a bounded search", capabilityIds: ["world", "player"] }], conclusion: "Existing material is not enough for a recommendation" };
    const compact = { query: "simulation interface", reason: "Find a general implementation for further investigation", capabilityIds: ["world", "player"] };
    const output = { queries: [structuredClone(compact)] };
    if (invalid === "overlong") output.queries[0]!.query = "agent world player interface shared memory events adapter";
    if (invalid === "scope") output.queries[0]!.capabilityIds = ["world", "invented"];
    if (invalid === "omitted") output.queries[0]!.capabilityIds = ["world"];
    if (invalid === "duplicate") output.queries[0]!.capabilityIds = ["world", "player", "player"];
    if (invalid === "too_many") output.queries.push({ ...compact, query: "world memory" }, { ...compact, query: "world events" });
    if (invalid === "repeated_query") {
      first.gapQueries.push({ ...first.gapQueries[0]!, query: "player world actions and persistent shared state interface" });
      output.queries.push({ ...compact, query: "Simulation Interface" });
    }
    if (invalid === "already_searched") output.queries[0]!.query = "AGENT society simulation";
    const deps = setup([initial, selection, first, ...(invalid === "transport" ? [] : [output])]);
    if (invalid === "transport") vi.mocked(deps.transport.complete).mockRejectedValueOnce(new Error("model unavailable"));
    const result = await researchDemand(question, deps);
    expect(result).toMatchObject({ status: "partial", stage: "finished", outcome: "insufficient_evidence", recommendedPathId: null, error: null });
    expect(deps.search).toHaveBeenCalledTimes(1);
    expect(result.evaluations[0]).toEqual(first);
    expect(result.sources[0]?.content).toBe(quote);
    expect(result.warnings.some(item => item.includes("未执行这些查询，不能判断没有实现"))).toBe(true);
    expect(result.calls.filter(call => call.stage === "gap_search_refinement")).toHaveLength(1);
  });
  it("does not turn an empty gap search into evidence that an implementation is absent", async () => {
    const first = { paths: [], gapQueries: [{ query: "world events", reason: "Look for a missing implementation capability", capabilityIds: ["world"] }], conclusion: "More evidence is required to propose an implementation" };
    const deps = setup([plan(), selection, first]);
    deps.search.mockResolvedValueOnce({ items: [preview], total: 1, incomplete: false, observedAt: project.observedAt }).mockResolvedValueOnce({ items: [], total: 0, incomplete: false, observedAt: project.observedAt });
    const result = await researchDemand(question, deps);
    expect(result).toMatchObject({ status: "partial", outcome: "insufficient_evidence" });
    expect(result.searches[1]).toMatchObject({ status: "succeeded", phase: "gap", total: 0 });
    expect(result.warnings.some(item => item.includes("不证明相关实现不存在"))).toBe(true);
    expect(deps.collect).toHaveBeenCalledOnce();
  });
  it("does not request gap reformulation or a seventh search when the search budget is exhausted", async () => {
    const initial = plan();
    initial.queries = ["shared agent world", "world memory", "world events", "society simulation"].map(query => ({ query, reason: "Find complete implementations for the original requirement" }));
    const first = { paths: [], gapQueries: [{ query: "agent world player interface shared memory events adapter", reason: "Investigate remaining unknown capabilities", capabilityIds: ["world"] }], conclusion: "Insufficient evidence within the bounded repository search" };
    const deps = setup([initial, { queries: [{ query: "agent simulation", reason: "Try a broader search term" }, { query: "virtual society", reason: "Find a broader complete implementation" }] }, selection, first]);
    for (let i = 0; i < 4; i++) deps.search.mockResolvedValueOnce({ items: [], total: 0, incomplete: false, observedAt: project.observedAt });
    const result = await researchDemand(question, deps);
    expect(result.status).toBe("partial");
    expect(deps.search).toHaveBeenCalledTimes(6);
    expect(result.calls.some(call => call.stage === "gap_search_refinement")).toBe(false);
    expect(result.warnings).toContain("已达到本轮搜索预算，未执行缺口补搜");
    expect(result.sources[0]?.content).toBe(quote);
  });
  it("does not accept keep when a review hard check fails", async () => {
    const opposition = review(); opposition.reviews[0]!.checks.capabilitiesGrounded = false;
    const deps = setup([plan(), selection, evaluation(), opposition]);
    const result = await researchDemand(question, deps);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("硬检查");
    expect(result.recommendedPathId).toBeNull();
  });
  it("retains incomplete model usage and collected evidence on model failure", async () => {
    const deps = setup([plan(), selection]);
    vi.mocked(deps.transport.complete).mockResolvedValueOnce({ content: "{", finishReason: "length", promptTokens: 300 });
    const result = await researchDemand(question, deps);
    expect(result.status).toBe("failed");
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.calls.at(-1)).toMatchObject({ status: "failed", promptTokens: 300 });
  });
  it("rejects unreadable requests without starting a model or GitHub call", async () => {
    const deps = setup([]);
    await expect(researchDemand("????????????????", deps)).rejects.toThrow();
    expect(deps.transport.complete).not.toHaveBeenCalled();
    expect(deps.search).not.toHaveBeenCalled();
  });
  it("reserves collection capacity for gaps instead of deep-reading every initial match", async () => {
    const candidates = Array.from({ length: 5 }, (_, n) => ({ ...preview, fullName: `sample/world-${n}` }));
    const deps = setup([plan(), { selected: candidates.map(item => ({ fullName: item.fullName, reason: "A related world implementation" })), skipped: [] }]);
    deps.search.mockResolvedValue({ items: candidates, total: 5, incomplete: false, observedAt: project.observedAt });
    const result = await researchDemand(question, deps);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("超预算");
    expect(deps.collect).not.toHaveBeenCalled();
  });
  it("records omitted real candidates as skipped instead of making the model enumerate them", async () => {
    const candidates = [preview, { ...preview, fullName: "sample/world-2" }, { ...preview, fullName: "sample/world-3" }];
    const deps = setup([plan(), selection, evaluation(), review()]);
    deps.search.mockResolvedValue({ items: candidates, total: candidates.length, incomplete: false, observedAt: project.observedAt });
    const result = await researchDemand(question, deps);
    expect(result.status).toBe("succeeded");
    expect(result.selections[0]?.selection.selected.map(item => item.fullName)).toEqual([project.fullName]);
    expect(result.selections[0]?.selection.skipped.map(item => item.fullName)).toEqual(["sample/world-2", "sample/world-3"]);
    expect(deps.collect).toHaveBeenCalledTimes(1);
  });
  it("keeps selection when a skipped candidate has a too-short model reason", async () => {
    const skippedCandidate = { ...preview, fullName: "sample/world-2" };
    const deps = setup([plan(), { selected: selection.selected, skipped: [{ fullName: skippedCandidate.fullName, reason: "No" }] }, evaluation(), review()]);
    deps.search.mockResolvedValue({ items: [preview, skippedCandidate], total: 2, incomplete: false, observedAt: project.observedAt });
    const result = await researchDemand(question, deps);
    expect(result.status).toBe("succeeded");
    expect(result.selections[0]?.selection.skipped).toEqual([{ fullName: skippedCandidate.fullName, reason: "Not selected for this collection round." }]);
  });
  it("keeps evidence once while sending compact search provenance to evaluation", async () => {
    const deps = setup([plan(), selection, evaluation(), review()]);
    await researchDemand(question, deps);
    const payload = vi.mocked(deps.transport.complete).mock.calls[2]![1] as { sources: unknown[]; searches: Array<{ candidates: string[]; items?: unknown[] }> };
    expect(payload.sources).toHaveLength(2);
    expect(payload.searches[0]?.candidates).toEqual([project.fullName]);
    expect(payload.searches[0]?.items).toBeUndefined();
  });
  it("bounds long evidence excerpts sent to evaluation while retaining the full source", async () => {
    const deps = setup([plan(), selection, evaluation(), review()]);
    deps.collect.mockResolvedValueOnce({ ...project, readmeExcerpt: "x".repeat(10000) });
    const result = await researchDemand(question, deps);
    const payload = vi.mocked(deps.transport.complete).mock.calls[2]![1] as { sources: Array<{ content: string; truncated?: boolean }> };
    expect(result.sources.find(source => source.field === "readme")?.content).toHaveLength(10000);
    expect(payload.sources.find(source => source.truncated)?.content).toHaveLength(2400);
    expect(payload.sources.find(source => source.truncated)?.content).toContain("[excerpt omitted; the saved source remains longer]");
  });
  it("broadens successful empty searches within the six-query budget without inventing candidates", async () => {
    const initial = plan();
    initial.queries = ["agent memory shared world", "autonomous virtual society", "social interaction simulation", "NPC world events"].map(query => ({ query, reason: "Find related complete implementations" }));
    const deps = setup([initial, { queries: [{ query: '"generative agents"', reason: "Broaden overly restrictive AND terms" }, { query: "social simulation", reason: "Search broader application terminology" }] }, selection, evaluation(), review()]);
    for (let i = 0; i < 4; i++) deps.search.mockResolvedValueOnce({ items: [], total: 0, incomplete: false, observedAt: project.observedAt });
    const result = await researchDemand(question, deps);
    expect(result.status).toBe("succeeded");
    expect(result.searches).toHaveLength(6);
    expect(result.calls.map(call => call.stage)).toEqual(["plan", "search_refinement", "selection", "evaluation", "review"]);
    expect(deps.collect).toHaveBeenCalledOnce();
  });
});



