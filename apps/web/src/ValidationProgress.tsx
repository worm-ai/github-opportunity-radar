import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Opportunity } from "./api";

export function ValidationProgress({ opportunity }: { opportunity: Opportunity }) {
  const progress = opportunity.validationProgress ?? [];
  const current = progress.filter((entry) => opportunity.validationSteps[entry.index] === entry.step);
  const previous = progress.filter((entry) => opportunity.validationSteps[entry.index] !== entry.step);
  return <section className="validation-progress" aria-label="验证执行进度">
    <p className="context-note">已完成 {current.filter((entry) => entry.status === "completed").length} / {opportunity.validationSteps.length} 步 · 跳过 {current.filter((entry) => entry.status === "skipped").length} 步。执行进度仅记录操作，真实用户访谈、试用或付费结果请另记为外部验证。</p>
    <ol className="validation-task-list">{opportunity.validationSteps.map((step, index) => {
      const saved = current.find((entry) => entry.index === index);
      return <ValidationStep key={`${opportunity.id}:${index}:${step}:${saved?.updatedAt ?? "pending"}`} opportunity={opportunity} index={index} step={step} saved={saved} />;
    })}</ol>
    {previous.length > 0 && <details><summary>原步骤已变化的执行记录 · {previous.length} 条</summary>{previous.map((entry) => <p key={`${entry.index}:${entry.step}`}>{entry.step} · {entry.status === "completed" ? "已完成" : "跳过"}：{entry.note}（{new Date(entry.updatedAt).toLocaleString("zh-CN")}）</p>)}</details>}
  </section>;
}

function ValidationStep({ opportunity, index, step, saved }: { opportunity: Opportunity; index: number; step: string; saved: NonNullable<Opportunity["validationProgress"]>[number] | undefined }) {
  const client = useQueryClient();
  const [status, setStatus] = useState<"pending" | "completed" | "skipped">(saved?.status ?? "pending");
  const [note, setNote] = useState(saved?.note ?? "");
  const save = useMutation({ mutationFn: () => api.updateValidationStep(opportunity.id, index, step, status, note), onSuccess: (item) => {
    client.setQueryData(["opportunity", opportunity.id], item);
    void client.invalidateQueries({ queryKey: ["opportunities"] });
  } });
  const changed = status !== (saved?.status ?? "pending") || note.trim() !== (saved?.note ?? "");
  return <li className={`validation-task task-${saved?.status ?? "pending"}`}>
    <p className="validation-task-title"><b>{index + 1}.</b> {step}</p>
    <form onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(); }}>
      <label>执行状态<select aria-label={`步骤 ${index + 1} 执行状态`} value={status} disabled={save.isPending} onChange={(event) => { setStatus(event.target.value as typeof status); save.reset(); }}><option value="pending">待执行</option><option value="completed">已完成</option><option value="skipped">跳过</option></select></label>
      <label>实际结果或跳过理由<textarea aria-label={`步骤 ${index + 1} 结果备注`} value={note} disabled={save.isPending} onChange={(event) => { setNote(event.target.value); save.reset(); }} maxLength={1200} rows={2} placeholder="做了什么、观察到什么，或为何跳过这一步" /></label>
      <button className="button-secondary" type="submit" disabled={save.isPending || !changed || status === "pending" && !saved || status !== "pending" && note.trim().length < 5}>{save.isPending ? "正在保存" : status === "pending" ? "重置为待执行" : "保存步骤结果"}</button>
      {status === "pending" && saved && <small>重置会清除此步骤的状态和备注。</small>}
      {saved && <small>已保存：{saved.status === "completed" ? "已完成" : "跳过"} · {new Date(saved.updatedAt).toLocaleString("zh-CN")}</small>}
      {save.isError && <p className="form-error" role="alert">{save.error.message}</p>}
    </form>
  </li>;
}
