import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { researchSourceKey, type ResearchNoteInput } from "@radar/contracts/research";
import { api, type DemandRun } from "./api";
import { hasResearchEncodingGap, ResearchNoteContent, ResearchNoteForm, ResearchReadableText, researchDecisionLabel, type ResearchNoteDraft } from "./ResearchNotebook";

function githubRepository(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port) return null;
    const name = url.pathname.split("/").slice(1, 3).join("/").toLowerCase();
    return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(name) ? name : null;
  } catch { return null; }
}

export function DemandDecisions({ run }: { run: DemandRun }) {
  const [params, setParams] = useSearchParams();
  const notes = useQuery({ queryKey: ["demand-research-notes", run.id], queryFn: () => api.demandResearchNotes(run.id), retry: false });
  const experiments = useQuery({ queryKey: ["technical-experiments"], queryFn: api.experiments, retry: false });
  const location = useLocation();
  useEffect(() => {
    if (location.hash !== "#demand-decisions" || notes.isPending) return;
    const frame = requestAnimationFrame(() => document.getElementById("demand-decisions")?.scrollIntoView());
    return () => cancelAnimationFrame(frame);
  }, [run.id, location.hash, notes.isPending]);
  const materials = useQuery({ queryKey: ["demand-note-sources", run.id], queryFn: () => api.demandNoteSources(run.id), retry: false });
  const [selected, setSelected] = useState<string[]>([]);
  const [history, setHistory] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const related = (notes.data ?? []).filter(note => note.originDemandId === run.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const activeRelated = related.filter(note => !note.supersededBy);
  const displayedRelated = history || showAll ? related : activeRelated.slice(0, 3);
  const editing = related.find(note => note.id === params.get("note"));
  const measurementRequested = params.get("measure") === "1";
  const requestedExperimentId = params.get("experiment");
  const experiment = experiments.data?.records.find(item => item.id === requestedExperimentId);
  const matchedProjectIds = experiment && run.snapshot ? run.snapshot.projects.filter(project => {
    const repository = githubRepository(project.url);
    return Boolean(repository && experiment.sources.some(source => source.repository.toLowerCase() === repository && source.repository.toLowerCase() === project.fullName.toLowerCase()));
  }).map(project => project.id) : [];
  const completeExperimentMatch = Boolean(experiment && matchedProjectIds.length > 0 && run.snapshot && experiment.sources.every(source => run.snapshot!.projects.some(project => githubRepository(project.url) === source.repository.toLowerCase() && project.fullName.toLowerCase() === source.repository.toLowerCase())));
  const experimentSources = materials.data?.sources.filter(source => source.ref.kind === "experiment" && source.ref.experimentId === experiment?.id && matchedProjectIds.includes(source.ref.projectId)) ?? [];
  const draft: ResearchNoteDraft | undefined = completeExperimentMatch && experiment && experimentSources.length > 0 ? {
    title: `实测判断：${experiment.title}`,
    question: `受控实测问题：${experiment.question}`,
    decision: "watch",
    author: "assistant",
    conclusion: `实测结论：${experiment.conclusion}`,
    nextAction: `实测后续：${experiment.nextAction}`,
    evidence: experimentSources.map(source => ({ ref: source.ref, quote: source.text.includes(experiment.conclusion.trim()) ? experiment.conclusion.trim() : source.text.trim().slice(0, 2000) })),
  } : undefined;
  useEffect(() => {
    if (!editing && draft) setSelected(matchedProjectIds);
  }, [draft?.title, editing?.id, matchedProjectIds.join(",")]);
  const selectedIds = editing?.projectIds ?? selected;
  const projects = run.snapshot?.projects.filter(project => selectedIds.includes(project.id)).map(project => ({ ...project, description: null, readmeExcerpt: null })) ?? [];
  const edit = (id?: string) => { const next = new URLSearchParams(params); if (id) next.set("note", id); else next.delete("note"); setParams(next); };
  return <section id="demand-decisions" className="demand-decisions" aria-label="本次选型判断">
    <h3>留下本次决定与验收条件</h3>
    <p className="context-note">选择要继续、等待或停止的候选，写下理由与下一步。记录会保留这次研究及准确引文，不调用模型，也不改写模型结论。单项目可以单独记录。</p>
    {notes.isError && <p role="alert">判断记录读取失败：{notes.error.message}<button type="button" className="button-secondary" onClick={() => { void notes.refetch(); }}>重试读取判断</button></p>}
    {notes.isPending && <p role="status">正在读取判断记录…</p>}
    {notes.isSuccess && <>
      {measurementRequested && !editing && <p className="context-note" role="status">已打开本次任务对照。请在同一任务和计时边界下填写人工基线与使用后结果；如果尚未计时，保留“未记录”，不要猜填。</p>}
      {related.length > 0 && <div className="demand-decision-filters"><label><input type="checkbox" checked={history} onChange={event => { setHistory(event.target.checked); if (event.target.checked) setShowAll(true); }} />包含历史判断</label>{activeRelated.length > 3 && !history && <button type="button" className="button-secondary" onClick={() => setShowAll(value => !value)}>{showAll ? "只看最近三条" : `查看其余 ${activeRelated.length - 3} 条当前判断`}</button>}</div>}
      {displayedRelated.map(note => <article className="research-note" data-note-id={note.id} key={note.id}>
        <p><b>{researchDecisionLabel[note.decision]}</b> · {note.author === "assistant" ? "代理研究 · 待人工复核" : "用户判断"} · {new Date(note.createdAt).toLocaleString("zh-CN")}{note.supersededBy ? " · 已有后续判断" : ""}</p>
        <h4>{hasResearchEncodingGap(note.title) ? "历史判断（原标题不可恢复）" : note.title}</h4>{hasResearchEncodingGap(note.title) && <div><ResearchReadableText value={note.title} label="判断标题" /></div>}<p>{note.projectNames.join(" + ")}</p>
        {note.evidenceStates.some(state => state !== "same") && <p className="form-error">引用来源发生变化或暂不可用，请复核；保存时的引文仍保留。</p>}
        <ResearchNoteContent note={note} />
        <div className="demand-actions">{!note.supersededBy && <button type="button" className="button-secondary" onClick={() => edit(note.id)}>修订此判断</button>}{!note.supersededBy && !note.valueMeasurement && <a className="button-secondary" href={`?run=${encodeURIComponent(run.id)}&note=${encodeURIComponent(note.id)}&measure=1#demand-decisions`}>补充本次任务对照</a>}<a href={`/api/v1/research-notes/${note.id}/report.md`} download>导出判断</a></div>
      </article>)}
      {!related.length && <p>本次研究尚未留下判断；“证据不足，先验证一个缺口”也可以记录。</p>}
      {params.has("note") && !editing && <p role="alert">此判断不属于本次研究或已不在当前列表中，请核对原记录。</p>}
      {editing && <p>正在修订「{editing.title}」，原记录与引文保留。<button type="button" className="button-secondary" onClick={() => edit()}>改为新建判断</button></p>}
      {!editing && <fieldset><legend>本次判断涉及的候选（1～3 个）</legend>{run.snapshot?.projects.map(project => <label className="demand-decision-project" key={project.id}><input type="checkbox" checked={selected.includes(project.id)} disabled={!selected.includes(project.id) && selected.length >= 3} onChange={event => setSelected(previous => event.target.checked ? [...previous, project.id] : previous.filter(id => id !== project.id))} />{project.fullName}</label>)}</fieldset>}
      {materials.isPending && <p role="status">正在核对可引用材料…</p>}
      {materials.isError && <p role="alert">材料读取失败，暂不能保存新判断：{materials.error.message}<button type="button" className="button-secondary" onClick={() => { void materials.refetch(); }}>重试读取材料</button></p>}
      {materials.data?.warnings.map(warning => <p className="form-error" key={warning}>{warning}</p>)}
      {draft && <p className="context-note" role="status">已从成功的受控实测生成可编辑草稿；当前只读取实测归档，修改并保存前不会写入判断。</p>}
      {materials.data && projects.length > 0 && (!params.has("note") || editing) && <ResearchNoteForm key={`${editing?.id ?? requestedExperimentId ?? "new"}:${measurementRequested ? "measure" : "decision"}`} projects={projects} question={run.question} originDemandId={run.id} availableSources={materials.data.sources} startWithMeasurement={measurementRequested} {...(editing ? { initial: editing } : draft ? { draft } : {})} />}
    </>}
  </section>;
}
