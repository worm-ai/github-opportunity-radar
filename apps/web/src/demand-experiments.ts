import type { DemandSnapshot, TechnicalExperiment } from "./api";

type EvidenceSnapshot = Pick<DemandSnapshot, "projects" | "sources">;
export type ExperimentMatch = {
  record: TechnicalExperiment;
  repositories: Array<{ repository: string; experimentCommit: string; researchCommits: string[]; version: "same" | "different" | "mixed" | "unknown" | "adapted"; modification?: NonNullable<TechnicalExperiment["sources"][number]["modification"]> }>;
  unmatchedRepositories: string[];
};

// Require a GitHub identity as well as the project name; IDs alone can be stale.
function repositoryName(value: string): string | null {
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value) ? value.toLowerCase() : null;
}
function urlRepository(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port) return null;
    return repositoryName(url.pathname.split("/").slice(1, 3).join("/"));
  } catch { return null; }
}
const fullCommit = (value: string | null): value is string => Boolean(value && /^[a-f0-9]{40}$/i.test(value));

export function matchDemandExperiments(snapshot: EvidenceSnapshot, records: TechnicalExperiment[]): ExperimentMatch[] {
  return records.flatMap(record => {
    const repositories: ExperimentMatch["repositories"] = [];
    const unmatchedRepositories: string[] = [];
    for (const source of record.sources) {
      const name = repositoryName(source.repository);
      const projects = name ? snapshot.projects.filter(project => repositoryName(project.fullName) === name && urlRepository(project.url) === name) : [];
      if (!projects.length) { unmatchedRepositories.push(source.repository); continue; }
      const ids = new Set(projects.map(project => project.id));
      const code = snapshot.sources.filter(item => ids.has(item.projectId) && item.field === "code");
      const attributable = code.filter(item => urlRepository(item.url) === name && fullCommit(item.commitSha));
      const commits = [...new Set(attributable.map(item => item.commitSha!.toLowerCase()))].sort();
      const hasUnknown = attributable.length !== code.length || !fullCommit(source.commit);
      const matches = commits.filter(commit => commit === source.commit.toLowerCase()).length;
      const version = source.modification ? "adapted" : !commits.length ? "unknown" : hasUnknown || (matches > 0 && matches < commits.length) ? "mixed" : matches === commits.length ? "same" : "different";
      repositories.push({ repository: source.repository, experimentCommit: source.commit, researchCommits: commits, version, ...(source.modification ? { modification: source.modification } : {}) });
    }
    return repositories.length ? [{ record, repositories, unmatchedRepositories }] : [];
  });
}

export const experimentVersionLabels = { same: "已读源码与实测提交相同", different: "已读源码与实测提交不同", mixed: "研究源码版本混杂或不全", unknown: "研究未固定可核对的源码提交", adapted: "本地改造版 · 上游提交仅为基线" };
export const experimentAnchor = (id: string) => `experiment-${id}`;
export const experimentHref = (id: string) => `/experiments#${encodeURIComponent(experimentAnchor(id))}`;
