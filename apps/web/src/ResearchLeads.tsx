import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type ResearchLead } from "./api";

const labels: Record<ResearchLead["status"], string> = {
  schema_failed: "提案格式有误", evidence_gap: "原文核验未通过", rejected: "反方否决", review_incomplete: "审查未完成",
};

function resumeUrl(resume: NonNullable<ResearchLead["resume"]>) {
  const params = new URLSearchParams();
  const origin = resume.originIssue;
  const ids = origin ? [origin.projectId, ...resume.projectIds.filter((id) => id !== origin.projectId)] : resume.projectIds;
  for (const id of ids) params.append("project", id);
  if (origin) params.set("issue", String(origin.issueNumber));
  params.set("question", resume.question);
  return `/opportunities?${params.toString()}#focused-research`;
}

export function ResearchLeads() {
  const result = useQuery({ queryKey: ["research-leads"], queryFn: api.researchLeads, refetchInterval: 5000 });
  const [showAll, setShowAll] = useState(false);
  if (result.isError) return <p className="form-error">研究线索读取失败：{result.error.message}</p>;
  const leads = result.data?.leads ?? [];
  if (!leads.length) return null;
  return <section className="research-leads" aria-label="待核查的研究线索">
    <div className="section-head"><div><h2>待核查的研究线索</h2><span>最近十次运行的候选快照，最多十二条</span></div>{leads.length > 3 && <button className="text-link" onClick={() => setShowAll(!showAll)}>{showAll ? "收起" : `查看全部 ${leads.length} 条`}</button>}</div>
    <p className="context-note">以下提案尚未进入机会列表。原文不足、反方否决和运行失败分别保留；允许补证，也允许停止。展开和带入材料不会调用模型。</p>
    {(showAll ? leads : leads.slice(0, 3)).map((lead) => <details className="research-lead" key={lead.id}>
      <summary><span className={`lead-status ${lead.status}`}>{labels[lead.status]}</span><b>{lead.title}</b></summary>
      <div className="decision-projects">{lead.projects.map((project) => <Link key={project.id} to={`/projects/${encodeURIComponent(project.id)}`}>{project.fullName}</Link>)}</div>
      <p className="lead-reason">{lead.reason}</p>
      {lead.gaps.length > 0 && <ul>{lead.gaps.map((gap, index) => <li key={`${gap.code}-${index}`}>{gap.message}</li>)}</ul>}
      <h3>下一步检查</h3><ul>{lead.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ul>
      {lead.proposedExperiment && <details><summary>原提案的实验建议（模型生成，未执行）</summary><p>{lead.proposedExperiment}</p></details>}
      <div className="lead-actions">{lead.resume && <Link className="button-secondary" to={resumeUrl(lead.resume)}>带入研究表单</Link>}<a className="text-link" href={`/api/v1/analysis/runs/${encodeURIComponent(lead.runId)}/report.md`} download>下载原始研究记录</a><small>运行 {lead.runId} · 候选 {lead.candidateIndex + 1}</small></div>
      {!lead.resume && <p className="context-note">项目引用、研究范围或原始问题文本不足以安全预填。请先核查原始提案与项目档案，再手动选择。</p>}
    </details>)}
  </section>;
}
