import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type DemandRun, type ResearchNoteView } from "./api";
import { currentGroupNotes, demandRunLabel, type DemandGroup } from "./demand-lineage";
import { researchDecisionLabel } from "./ResearchNotebook";

export const demandStatusLabels = { running: "研究中", succeeded: "已完成", partial: "部分完成", failed: "失败", interrupted: "已中断" };
const date = (value: string) => new Date(value).toLocaleString("zh-CN");

function DecisionLink({ note, runId }: { note: ResearchNoteView; runId: string }) {
  return <div className="demand-linked-decision" data-linked-note-id={note.id}>
    <p><b>{researchDecisionLabel[note.decision]}</b> · {note.author === "assistant" ? "代理研究 · 待人工复核" : "用户判断"} · {date(note.createdAt)}</p>
    <h4>{note.title}</h4>{note.originDemandId !== runId && <><p>{note.conclusion}</p><p><b>下一步：</b>{note.nextAction}</p></>}
    {note.evidenceStates.some(state => state !== "same") && <p className="form-error">引用来源发生变化或暂不可用，请复核原判断中的引文。</p>}
    <Link to={`/research?run=${encodeURIComponent(note.originDemandId!)}#demand-decisions`}>{note.originDemandId === runId ? "查看本次判断与引文" : "查看关联任务的判断与引文"}</Link>
  </div>;
}

export function DemandLineage({ run, group, canRecord, historyError }: { run: DemandRun; group: DemandGroup; canRecord: boolean; historyError: boolean }) {
  const notes = useQuery({ queryKey: ["research-notes"], queryFn: api.researchNotes, enabled: canRecord });
  const current = currentGroupNotes(group, notes.data ?? []), latest = group.runs.at(-1)!;
  return <section className="demand-lineage" aria-label="关联研究与最新判断">
    <h3>关联研究与最新判断</h3>
    <p className="context-note">按明确的续研或同需求重试关联，仅覆盖已加载的最近记录。判断保留所属任务与引文，当前页面仍是所选任务的历史报告。</p>
    {historyError && <p role="alert">研究记录读取失败，关联任务可能未显示。请在研究记录中重试读取。</p>}
    {group.incomplete && <p role="status">部分前序任务不在已加载记录中，以下关联可能不完整；可通过原任务链接继续查看。</p>}
    {latest.id !== run.id && <p>最近关联任务：<Link to={`/research?run=${encodeURIComponent(latest.id)}`}>{demandRunLabel(latest)} · {demandStatusLabels[latest.status]} · {date(latest.startedAt)}</Link>。任务时间较新不代表结论更可靠。</p>}
    {canRecord && <>
      {notes.isPending && <p role="status">正在读取关联判断…</p>}
      {notes.isError && <p role="alert">关联判断读取失败，不能据此视为没有判断。<button type="button" className="button-secondary" onClick={() => { void notes.refetch(); }}>重试读取关联判断</button></p>}
      {notes.isSuccess && (current[0] ? <><p><b>最近保存的未被修订判断</b> · {current[0].originDemandId === run.id ? "来自本次任务" : "来自关联任务"}；保存时间不代表已验收。</p><DecisionLink note={current[0]} runId={run.id} />{current.length > 1 && <details><summary>其他未被修订判断（{current.length - 1}）</summary>{current.slice(1).map(note => <DecisionLink key={note.id} note={note} runId={run.id} />)}</details>}</> : <p>已加载的关联任务尚无未被修订判断。</p>)}
    </>}
    <details className="demand-lineage-tasks"><summary>查看关联任务（{group.runs.length}）</summary><ol>{group.runs.map(item => <li key={item.id}><Link aria-current={run.id === item.id ? "page" : undefined} to={`/research?run=${encodeURIComponent(item.id)}`}>{demandRunLabel(item)} · {demandStatusLabels[item.status]} · {date(item.startedAt)} · {item.id.slice(0, 8)}</Link>{run.id === item.id ? "（当前）" : ""}</li>)}</ol></details>
  </section>;
}
