import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { collectedResearchIssues, researchSources, researchSourceKey, type ResearchSource, type ResearchNoteView, type ResearchNote } from "@radar/contracts";
import type { RadarStore } from "@radar/storage";
import { reportText, sourceLink } from "./reports.js";
import { demandNoteSources } from "./demand-note-sources.js";
import { measurementValue, trialTimeSummary } from "@radar/contracts/validation";

const projectId = z.string().min(1).max(64), positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
// Keep this schema local: the server uses its own Zod major version, while the
// shared contract package is also consumed by the browser.
const valueMeasurementSchema = z.object({
  taskDescription: z.string().trim().min(10).max(500), baselineMethod: z.string().trim().min(2).max(300), assistedMethod: z.string().trim().min(2).max(300),
  comparable: z.boolean(), bothCompleted: z.boolean(), timing: z.enum(["measured", "estimated", "unmeasured"]), tasksCompared: z.number().int().min(1).max(1000),
  baselineMinutes: z.number().finite().min(0).max(100000).nullable(), assistedMinutes: z.number().finite().min(0).max(100000).nullable(),
  falseKeeps: z.number().int().min(0).max(100000).nullable(), missedCandidates: z.number().int().min(0).max(100000).nullable(),
}).strict().superRefine((value, context) => {
  if (value.timing === "unmeasured" && (value.baselineMinutes !== null || value.assistedMinutes !== null)) context.addIssue({ code: "custom", path: ["timing"], message: "填写耗时后请选择实际计时或估计；未记录的耗时请留空。" });
});
const refSchema = z.discriminatedUnion("kind", [
  z.object({ projectId, kind: z.literal("description") }).strict(), z.object({ projectId, kind: z.literal("readme") }).strict(),
  z.object({ projectId, kind: z.literal("issue"), issueNumber: positive }).strict(),
  z.object({ projectId, kind: z.literal("comment"), issueNumber: positive, commentId: positive }).strict(),
  z.object({ projectId, kind: z.literal("documentation"), documentPath: z.string().min(1).max(240) }).strict(),
  z.object({ projectId, kind: z.literal("pull_request"), issueNumber: positive, pullRequestNumber: positive }).strict(),
  z.object({ projectId, kind: z.literal("demand_source"), runId: z.string().uuid(), sourceId: z.string().min(1).max(200) }).strict(),
  z.object({ projectId, kind: z.literal("experiment"), experimentId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/) }).strict(),
]);
export const researchNoteSchema = z.object({
  requestId: z.string().uuid(), author: z.enum(["user", "assistant"]), title: z.string().trim().min(4).max(160), question: z.string().trim().min(12).max(4000),
  projectIds: z.array(projectId).min(1).max(3).refine((ids) => new Set(ids).size === ids.length),
  originIssue: z.object({ projectId, issueNumber: positive }).strict().optional(),
  originDemandId: z.string().uuid().optional(),
  decision: z.enum(["continue", "watch", "stop"]), conclusion: z.string().trim().min(15).max(2400), nextAction: z.string().trim().min(10).max(1200),
  valueMeasurement: valueMeasurementSchema.optional(),
  evidence: z.array(z.object({ ref: refSchema, quote: z.string().trim().min(16).max(2000) }).strict()).min(1).max(6),
  supersedesId: z.string().uuid().optional(),
}).strict();
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
export const researchSourceFingerprint = (source: ResearchSource) => createHash("sha256").update(JSON.stringify([source.key, source.text, source.url, source.notice, source.revision])).digest("hex");

export function researchNoteView(store: RadarStore, note: ResearchNote & { supersededBy: string | null }, experimentDirectory?: string, sourceSnapshot?: ResearchSource[]): ResearchNoteView {
  const sources = sourceSnapshot ?? (note.originDemandId ? demandNoteSources(store, note.originDemandId, experimentDirectory)?.sources ?? [] : researchSources(note.projectIds.flatMap((id) => store.getProject(id) ?? [])));
  const current = new Map(sources.map((source) => [source.key, source]));
  return { ...note, evidenceStates: note.evidence.map((evidence) => {
    const source = current.get(researchSourceKey(evidence.ref));
    return !source ? "unavailable" : researchSourceFingerprint(source) === evidence.fingerprint ? "same" : "changed";
  }) };
}

export function relatedResearchNotes(store: RadarStore, projectIds: string[], experimentDirectory?: string) {
  return store.listResearchNotesForProjects(projectIds).map((note) => {
    const sharedProjectIds = note.projectIds.filter((projectId) => projectIds.includes(projectId));
    return { ...researchNoteView(store, note, experimentDirectory), sharedProjectIds, relation: sharedProjectIds.length === note.projectIds.length && sharedProjectIds.length === projectIds.length ? "exact" as const : "partial" as const };
  });
}

export function researchNoteReport(note: ResearchNoteView) {
  const status = { continue: "继续研究", watch: "等待变化", stop: "停止这条方向" }[note.decision];
  const lines = ["# 研究判断", "", `## ${reportText(note.title)}`, "", `- 阶段判断：${status}`, `- 记录者：${note.author === "assistant" ? "代理研究，待人工复核" : "用户判断"}`, `- 保存时间：${reportText(note.createdAt)}`, `- 项目：${reportText(note.projectNames.join(" + "))}`, `- 编号：${note.id}`, "", "这是研究记录，不是模型机会、技术实测或市场验证。", "", "### 研究问题", "", reportText(note.question), "", "### 当前结论", "", reportText(note.conclusion), "", "### 下一步与重新审视条件", "", reportText(note.nextAction), "", "### 保存时的原文", ""];
  if (note.originIssue) lines.push(`- 问题起点：项目 ${reportText(note.originIssue.projectId)} #${note.originIssue.issueNumber}`, "");
  if (note.originDemandId) lines.push(`- 原需求研究：${note.originDemandId}（本地 /research?run=${note.originDemandId}）`, "");
  if (note.valueMeasurement) {
    const measurement = note.valueMeasurement;
    lines.push("### 本次任务对照（仅本次使用记录）", "", `- 任务：${reportText(measurement.taskDescription)}`, `- 基线方法：${reportText(measurement.baselineMethod)}`, `- 使用后方法：${reportText(measurement.assistedMethod)}`, `- 条件可比：${measurement.comparable ? "是" : "否"}；前后均完成：${measurement.bothCompleted ? "是" : "否"}；计时：${measurement.timing}；任务数：${measurement.tasksCompared}`, `- 基线分钟：${measurementValue(measurement.baselineMinutes)}；使用后分钟：${measurementValue(measurement.assistedMinutes)}；误留候选：${measurementValue(measurement.falseKeeps)}；漏选候选：${measurementValue(measurement.missedCandidates)}`, `- 解释：${trialTimeSummary(measurement)}`, "- 这组数据只描述本次任务，不能推出普遍省时、正确率或市场需求。", "");
  }
  note.evidence.forEach((evidence, index) => {
    lines.push(`#### ${reportText(evidence.label)}`, "", ...evidence.quote.split(/\r?\n/).map((line) => `    ${line}`), "",
      `- 来源：${evidence.ref.kind === "experiment" ? `[本地实测归档](/experiments#experiment-${evidence.ref.experimentId})` : sourceLink(evidence.url)}`, `- 采集时间：${reportText(evidence.observedAt)}`, `- 边界：${reportText(evidence.notice)}`,
      `- 与当前已采集资料比较：${{ same: "内容一致，未核对远端最新状态", changed: "来源内容或状态已变，请复核判断", unavailable: "来源当前不可用，原快照保留" }[note.evidenceStates[index]!]}`, "");
  });
  if (note.supersedesId) lines.push(`- 修订自：${note.supersedesId}`, "");
  if (note.supersededBy) lines.push(`- 后续判断：${note.supersededBy}`, "");
  return lines.join("\n");
}

export function registerResearchNoteRoutes(app: FastifyInstance, store: RadarStore, experimentDirectory?: string) {
  const view = (note: ResearchNote & { supersededBy: string | null }, sourceSnapshot?: ResearchSource[]) => researchNoteView(store, note, experimentDirectory, sourceSnapshot);
  app.get<{ Params: { id: string } }>("/demands/:id/note-sources", async (request, reply) => {
    const sources = demandNoteSources(store, request.params.id, experimentDirectory);
    return sources ?? reply.code(409).send({ error: { code: "demand_materials_unavailable", message: "研究尚在执行或没有可引用的历史材料" } });
  });
  app.get<{ Params: { id: string } }>("/demands/:id/research-notes", async (request, reply) => {
    const materials = demandNoteSources(store, request.params.id, experimentDirectory);
    if (!materials) return reply.code(409).send({ error: { code: "demand_materials_unavailable", message: "研究尚在执行或没有可引用的历史材料" } });
    return store.listResearchNotes().filter((note) => note.originDemandId === request.params.id).map((note) => view(note, materials.sources));
  });
  app.get("/research-notes", async () => {
    // A demand's archived experiment catalog is immutable for this request;
    // build it once instead of re-reading and hashing every artifact per note.
    const demandSources = new Map<string, ResearchSource[]>();
    return store.listResearchNotes().map((note) => {
      if (!note.originDemandId) return view(note);
      if (!demandSources.has(note.originDemandId)) demandSources.set(note.originDemandId, demandNoteSources(store, note.originDemandId, experimentDirectory)?.sources ?? []);
      return view(note, demandSources.get(note.originDemandId));
    });
  });
  app.get<{ Params: { id: string } }>("/research-notes/:id", async (request, reply) => {
    const note = store.getResearchNote(request.params.id);
    return note ? view(note) : reply.code(404).send({ error: { code: "research_note_not_found", message: "研究判断不存在", requestId: request.id } });
  });
  app.get<{ Params: { id: string } }>("/research-notes/:id/report.md", async (request, reply) => {
    const note = store.getResearchNote(request.params.id);
    if (!note) return reply.code(404).send({ error: { code: "research_note_not_found", message: "研究判断不存在", requestId: request.id } });
    return reply.header("content-disposition", 'attachment; filename="research-decision.md"').type("text/markdown; charset=utf-8").send(researchNoteReport(view(note)));
  });
  app.post("/research-notes", async (request, reply) => {
    const error = (status: number, code: string, message: string) => reply.code(status).send({ error: { code, message, requestId: request.id } });
    const parsed = researchNoteSchema.safeParse(request.body);
    if (!parsed.success) return error(400, "invalid_research_note", "请填写研究问题、判断、下一步，并选择 1～3 个项目与 1～6 条至少 16 字符的原文引用");
    const input = parsed.data, requestJson = JSON.stringify(input);
    try {
      // Retries return the saved snapshot even if the live project evidence has since changed.
      const existing = store.researchNoteForRequest(input.requestId, requestJson);
      if (existing) return view(existing);
      const demand = input.originDemandId ? demandNoteSources(store, input.originDemandId, experimentDirectory) : null;
      if (input.originDemandId && !demand) return error(409, "demand_materials_unavailable", "请等待原研究停止执行并保留材料后再记录判断");
      if (input.originDemandId && input.originIssue) return error(400, "conflicting_research_origin", "需求研究与 Issue 研究起点不能混用");
      if (input.supersedesId && store.getResearchNote(input.supersedesId)?.originDemandId !== input.originDemandId) return error(409, "research_origin_conflict", "修订必须保留原需求研究的关联，请另建新判断");
      const projects = input.projectIds.flatMap((id) => demand ? demand.projects.find(project => project.id === id) ?? [] : store.getProject(id) ?? []);
      if (projects.length !== input.projectIds.length) return error(400, "unknown_research_project", "请选择已采集的项目");
      const origin = input.originIssue;
      if (origin && !input.projectIds.some(id => id === origin.projectId && collectedResearchIssues(store.getProject(id)!).some(issue => issue.number === origin.issueNumber))) return error(400, "unknown_research_origin", "问题起点不属于选定项目的有效采集材料");
      const available = demand ? demand.sources.filter(source => input.projectIds.includes(source.ref.projectId)) : researchSources(input.projectIds.flatMap(id => store.getProject(id) ?? []));
      const sources = new Map(available.map((source) => [source.key, source]));
      const evidence: ResearchNote["evidence"] = [];
      for (const item of input.evidence) {
        const source = sources.get(researchSourceKey(item.ref));
        if (!source || item.quote.includes("[... omitted README text ...]") || !normalize(source.text).includes(normalize(item.quote))) return error(422, "research_quote_unavailable", "引用不在当前有效原文中，请重新核对来源；读取失败或过时评论不能作为新引用");
        if (evidence.some((prior) => researchSourceKey(prior.ref) === source.key && normalize(prior.quote) === normalize(item.quote))) return error(400, "duplicate_research_quote", "请移除重复引用");
        evidence.push({ ref: source.ref, label: source.label, quote: item.quote, url: source.url, observedAt: source.observedAt, notice: source.notice, fingerprint: researchSourceFingerprint(source) });
      }
      const note: ResearchNote = { id: randomUUID(), createdAt: new Date().toISOString(), author: input.author, title: input.title, question: input.question, projectIds: input.projectIds, projectNames: projects.map((project) => project.fullName), ...(origin ? { originIssue: origin } : {}), ...(input.originDemandId ? { originDemandId: input.originDemandId } : {}), decision: input.decision, conclusion: input.conclusion, nextAction: input.nextAction, ...(input.valueMeasurement ? { valueMeasurement: input.valueMeasurement } : {}), evidence, supersedesId: input.supersedesId ?? null };
      return reply.code(201).send(view(store.saveResearchNote(note, input.requestId, requestJson)));
    } catch (cause) {
      if (cause instanceof Error && ["research_request_conflict", "research_revision_conflict"].includes(cause.message)) return error(409, cause.message, "这条判断已保存或被更新，请刷新后重试；历史原文仍保留");
      throw cause;
    }
  });
}
