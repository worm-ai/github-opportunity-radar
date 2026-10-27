import type { ResearchSource } from "@radar/contracts";
import { researchSourceKey } from "@radar/contracts";
import type { RadarStore } from "@radar/storage";
import { listExperiments } from "./experiments.js";

function githubRepository(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port) return null;
    const name = url.pathname.split("/").slice(1, 3).join("/");
    return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(name) ? name.toLowerCase() : null;
  } catch { return null; }
}

/** Snapshot material and manually archived experiments stay distinct from model conclusions. */
export function demandNoteSources(store: RadarStore, runId: string, experimentDirectory?: string) {
  const run = store.getDemandRun(runId);
  if (!run?.snapshot || run.status === "running") return null;
  const snapshot = run.snapshot;
  const sources: ResearchSource[] = [];
  for (const source of snapshot.sources) {
    const project = snapshot.projects.find(project => project.id === source.projectId);
    if (!project || !source.content.trim()) continue;
    const ref = { projectId: project.id, kind: "demand_source" as const, runId, sourceId: source.id };
    sources.push({ ref, key: researchSourceKey(ref), label: `${project.fullName} · 本次研究 ${source.path ?? source.field}`, text: source.content, url: source.url, observedAt: source.observedAt,
      notice: `研究 ${runId} 的历史材料；${source.notice}；提交 ${source.commitSha ?? "未知"}；本次研究未执行项目。`, revision: JSON.stringify(source) });
  }
  const archive = experimentDirectory ? listExperiments(experimentDirectory) : { records: [], warnings: [] };
  for (const record of archive.records) {
    // Match both GitHub name and URL, never a numeric project ID alone.
    const projects = snapshot.projects.filter(project => record.sources.some(source => source.repository.toLowerCase() === project.fullName.toLowerCase() && githubRepository(project.url) === source.repository.toLowerCase()));
    for (const project of projects) {
      const ref = { projectId: project.id, kind: "experiment" as const, experimentId: record.id };
      const text = [`验证问题：${record.question}`, `实测结论：${record.conclusion}`, ...record.checks.map(check => `${check.label}（${check.outcome}）：${check.observation}`), ...record.limitations.map(limit => `验证边界：${limit}`), `建议下一步：${record.nextAction}`].join("\n");
      sources.push({ ref, key: researchSourceKey(ref), label: `${project.fullName} · 人工实测 ${record.title}`, text, url: `/experiments#experiment-${record.id}`, observedAt: record.executedAt,
        notice: `人工实测；涉及 ${record.sources.map(source => `${source.repository}@${source.commit}${source.modification ? `（本地改造版：${source.modification.description}；改造产物 ${source.modification.artifact}；SHA-256 ${source.modification.sha256}；该提交仅为上游基线）` : ""}`).join("、")}；环境：${record.environment}；输入来源：${record.inputOrigin}；验证边界：${record.limitations.join("；")}；仅按仓库关联，版本及需求适用性须核对，不证明完整需求通过。`, revision: JSON.stringify(record) });
    }
  }
  return { projects: snapshot.projects, sources, warnings: archive.warnings };
}
