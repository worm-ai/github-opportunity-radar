import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import type { Project } from "./api";
import { IssueContextPanel } from "./IssueContextPanel";
import { collectedResearchIssues, issueBodyDescription, issueContextOutdated } from "@radar/contracts/issues";

export type ResearchIssue = { key: string; project: Project; issue: Project["issues"][number] };
export function researchIssues(projects: Project[]): ResearchIssue[] {
  return projects.flatMap((project) => collectedResearchIssues(project).map((issue) => ({ key: `${project.id}:${issue.number}`, project, issue })));
}

const date = (value: string) => new Date(value).toLocaleString("zh-CN");
function originObservedAt(origin: ResearchIssue) {
  const context = origin.project.issueContexts?.[String(origin.issue.number)];
  return context && !issueContextOutdated(context, origin.issue.updatedAt) ? context.observedAt : origin.project.issuesFetchedAt;
}
export function ResearchMaterials({ projects, origin, onDraft }: { projects: Project[]; origin: ResearchIssue | undefined; onDraft: () => void }) {
  if (!projects.length) return null;
  return <section className="research-materials" aria-label="组合研究材料">
    <h3>先核对材料与分工</h3>
    <p className="context-note">对照各组件的输入输出是否相接；同类能力可能是替代方案。接口尚未核实的地方保留为未知。</p>
    <div className="research-material-grid">{projects.map((project) => {
      const documents = project.documentation?.documents.filter((document) => !document.stale) ?? [];
      return <article key={project.id} className="research-material" data-project-id={project.id}>
        <Link to={`/projects/${project.id}`}><b>{project.fullName}</b> <ArrowUpRight size={13} /></Link>
        <p>{project.description ?? "没有项目描述，需进入档案核对 README 与用法。"}</p>
        <small>项目自述 · 许可证标识 {project.license ?? "未知"}</small>
        <p className="research-check">{project.discovery.kind === "resource_hint" ? "有资料迹象，先确认是否有独立组件。" : project.discovery.kind === "unclassified" ? "能力尚未识别，先排除 README 中的广告和依赖提及。" : project.discovery.clues[0]?.nextCheck}</p>
        <details><summary>已采集材料：{documents.length} 份可用补充文档 / {collectedResearchIssues(project).length} 条可用 Issue</summary>
          {documents.slice(0, 2).map((document) => <div className="research-document" key={document.path}><a href={document.url} target="_blank" rel="noreferrer">{document.path} ↗</a><pre>{document.excerpt.slice(0, 1200)}</pre><small>{document.commitSha ? `版本 ${document.ref ?? document.commitSha} · 固定提交 ${document.commitSha}` : "默认分支 · 可变 HEAD"} · 未做运行验证 · {date(document.observedAt)} · Blob {document.sha}</small></div>)}
          {!documents.length && <p className="context-note">尚未补充接口文档，可进入档案采集；缺文档不等于没有接口。</p>}
          <p className="context-note">Issue {project.issuesFetchedAt ? `采集于 ${date(project.issuesFetchedAt)}` : "尚未采集"}；样本不覆盖全部讨论。</p>
        </details>
      </article>;
    })}</div>
    {origin && <article className="research-origin" aria-label="选定的问题原文">
      <h3>问题起点 · {origin.project.fullName} #{origin.issue.number}</h3>
      <p className="research-origin-title">{origin.issue.title}</p>
      <pre>{origin.issue.bodyExcerpt || "此 Issue 无正文，仅有标题。"}</pre>
      <p className="context-note">{issueBodyDescription(origin.issue)}</p>
      <small>{origin.issue.authorLogin ? `@${origin.issue.authorLogin}` : "作者标识未采集"} · {origin.issue.authorAssociation ?? "作者关系未知"} · 更新 {date(origin.issue.updatedAt)} · 采集 {originObservedAt(origin) ? date(originObservedAt(origin)!) : "时间未知"}</small>
      <p className="context-note">这是单条公开讨论。OWNER / MEMBER / COLLABORATOR 表示与仓库有关联；其他标识也不能证明客户身份或付费意愿。正文是采集片段，解决状态需核对当前讨论。</p>
      <div className="research-origin-actions"><a className="text-link" href={origin.issue.url} target="_blank" rel="noreferrer">核对当前讨论 <ArrowUpRight size={13} /></a><button className="button-secondary" type="button" onClick={onDraft}>用此问题起草研究问题</button></div>
      <IssueContextPanel project={origin.project} number={origin.issue.number} />
    </article>}
  </section>;
}
