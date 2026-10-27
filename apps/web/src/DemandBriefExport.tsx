import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type DemandRun } from "./api";
import type { DemandGroup } from "./demand-lineage";
import { renderDemandBrief } from "./demand-brief";

export function DemandBriefExport({ run, group, canRecord, historyAvailable }: { run: DemandRun; group: DemandGroup; canRecord: boolean; historyAvailable: boolean }) {
  const notes = useQuery({ queryKey: ["research-notes"], queryFn: api.researchNotes, enabled: canRecord });
  const experiments = useQuery({ queryKey: ["technical-experiments"], queryFn: api.experiments, retry: false });
  const [error, setError] = useState<string | null>(null);
  const ready = historyAvailable && (!canRecord || notes.isSuccess) && experiments.isSuccess;
  const download = () => {
    if (!ready) return;
    try {
      const html = renderDemandBrief({ run, group, notes: notes.data ?? [], notesSupported: canRecord, experiments: experiments.data!.records, archiveWarnings: experiments.data!.warnings, exportedAt: new Date().toISOString(), applicationOrigin: window.location.origin });
      const objectUrl = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = `implementation-brief-${run.id}.html`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); setError(null);
    } catch { setError("简报生成失败，原始材料仍可分别导出。请重试。"); }
  };
  return <div className="demand-brief-export">
    <button className="button-secondary" type="button" disabled={!ready || notes.isFetching || experiments.isFetching} onClick={download}>导出离线交接简报</button>
    <p className="context-note">HTML 包含当前研究、已加载关联判断、引文、实测及边界；可离线阅读并用浏览器打印为 PDF。原文全文与实测产物另取，不会自动更新。</p>
    {!historyAvailable && <p role="status">研究记录尚未成功读取，暂不能生成关联简报。</p>}
    {canRecord && notes.isError && <p role="alert">判断读取失败，暂不能导出完整简报。<button type="button" onClick={() => { void notes.refetch(); }}>重试读取判断</button></p>}
    {experiments.isError && <p role="alert">实测读取失败，暂不能导出完整简报。<button type="button" onClick={() => { void experiments.refetch(); }}>重试读取实测</button></p>}
    {experiments.data?.warnings.length ? <p className="form-error">实测归档有缺损提示，简报会保留这些提示及当前可读取的记录。</p> : null}
    {error && <p role="alert">{error}</p>}
  </div>;
}
