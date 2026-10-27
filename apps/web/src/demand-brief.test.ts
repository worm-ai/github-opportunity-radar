import { describe, expect, it } from "vitest";
import type { DemandRun, ResearchNoteView } from "./api";
import { renderDemandBrief, type DemandBriefInput } from "./demand-brief";
import { groupDemandRuns } from "./demand-lineage";

const run: DemandRun = { id: "run", requestId: "request", question: '中文<script>globalThis.injected = true</script><img src=x onerror=alert(1)>', retryOf: null, status: "failed", startedAt: "2026-10-23", updatedAt: "2026-10-23", finishedAt: "2026-10-23", error: "timeout <script>bad()</script>", snapshot: null };
const note = { id: "note", originDemandId: "run", title: "服务反证", author: "assistant", projectNames: ["a/b"], decision: "watch", conclusion: "保存未通过", nextAction: "先复核", createdAt: "2026-10-23", supersededBy: null, evidenceStates: ["changed"], evidence: [{ quote: '</pre><script>bad()</script>', label: "exact", url: "javascript:alert(1)", observedAt: "2026-10-23", notice: "only local" }] } as ResearchNoteView;
const input = (): DemandBriefInput => ({ run, group: groupDemandRuns([run])[0]!, notes: [note], notesSupported: true, experiments: [], archiveWarnings: ["missing artifact"], exportedAt: "2026-10-23", applicationOrigin: "http://127.0.0.1:4318" });
describe("offline implementation brief", () => {
  it("renders hostile text literally and blocks executable or credential-bearing links", () => {
    const html = renderDemandBrief(input());
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script|<img|javascript:|onerror=alert\(1\)>/);
    expect(html).toContain("链接不可用");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('<link');
    expect(renderDemandBrief({ ...input(), notes: [{ ...note, evidence: [{ ...note.evidence[0]!, url: "https://user:secret@example.com/a" }] }] })).not.toContain('user:secret');
  });
  it("preserves failure, unknown evidence, exact saved quotes and archive limitations without inventing a recommendation", () => {
    const html = renderDemandBrief(input());
    for (const text of ["失败", "没有可按完整复核条件列为推荐", "尚无候选路径", "代理研究 · 待人工复核", "保存未通过", "先复核", "来源发生变化", "only local", "missing artifact", "正文未全量嵌入", "离线阅读"]) expect(html).toContain(text);
    expect(html).toContain('&lt;/pre&gt;&lt;script&gt;bad()&lt;/script&gt;');
  });
  it("includes the same bounded action handoff as the live result", () => {
    const snapshot = { version: "demand-research-v5", question: "Build a local tool with saved state.", provider: "codex", model: "codex/test", stage: "finished", status: "partial", plan: { summary: "Local tool", capabilities: [{ id: "state", description: "Saved state", required: true, origin: "user" }], constraints: [], assumptions: [], questions: [], queries: [{ query: "saved state", reason: "Find implementations" }] }, searches: [], selections: [], collections: [], projects: [], sources: [], evaluations: [], reviews: null, recommendedPathId: null, outcome: "insufficient_evidence", warnings: [], error: null, calls: [] } as const;
    const html = renderDemandBrief({ ...input(), run: { ...run, question: snapshot.question, status: "partial", snapshot: structuredClone(snapshot) } as unknown as DemandRun });
    expect(html).toContain("当前行动摘要");
    expect(html).toContain("已有材料没有形成通过基本证据核验的候选路径");
    expect(html).toContain("查看检索边界和失败原因");
  });
  it("never pulls a decision from an independent identical question or superseded note", () => {
    const data = input(), before = JSON.stringify(data);
    const html = renderDemandBrief({ ...data, notes: [...data.notes, { ...note, id: "foreign", originDemandId: "other", title: "FOREIGN_TITLE" }, { ...note, id: "old", title: "OLD_TITLE", supersededBy: "note" }] });
    expect(html).not.toContain("FOREIGN_TITLE"); expect(html).not.toContain("OLD_TITLE");
    expect(JSON.stringify(data)).toBe(before);
  });
  it("prints the full source address so attribution survives readers that ignore PDF annotations", () => {
    const href = "https://example.com/fixed-commit/source.txt";
    const html = renderDemandBrief({ ...input(), notes: [{ ...note, evidence: [{ ...note.evidence[0]!, url: href }] }] });
    expect(html).toContain(`href="${href}"`);
    expect(html).toContain(`<span class="link-url"> · ${href}</span>`);
  });
  it("keeps task-level value measurements in the offline handoff without upgrading them to a general claim", () => {
    const measured = { ...note, valueMeasurement: { taskDescription: "核对同一批候选", baselineMethod: "逐个阅读原文", assistedMethod: "查看行动摘要后核对", comparable: true, bothCompleted: true, timing: "unmeasured" as const, tasksCompared: 1, baselineMinutes: null, assistedMinutes: null, falseKeeps: null, missedCandidates: null } };
    const html = renderDemandBrief({ ...input(), notes: [measured] });
    expect(html).toContain("本次任务对照"); expect(html).toContain("基线分钟：未记录"); expect(html).toContain("不代表普遍收益");
  });
  it("distinguishes an unsupported notes feature from no decisions and warns on partial lineage", () => {
    const html = renderDemandBrief({ ...input(), notesSupported: false, group: { ...input().group, incomplete: true } });
    expect(html).toContain("当前服务未声明判断记录功能");
    expect(html).toContain("部分前序任务未加载");
    expect(html).not.toContain("服务反证");
  });
});
