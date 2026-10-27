import type { DemandRun, DemandSummary, ResearchNoteView } from "./api";

export type LineageRun = Pick<DemandRun, "id" | "question" | "retryOf" | "continuationOf" | "status" | "startedAt">;
export type DemandGroup = { id: string; runs: LineageRun[]; incomplete: boolean };
const byTime = (a: LineageRun, b: LineageRun) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id);

// The history API is bounded. Derive only explicit relationships in the loaded window;
// never infer a shared task from equal question text or a missing ancestor's ID.
export function groupDemandRuns(history: LineageRun[], selected?: DemandRun): DemandGroup[] {
  const runs = new Map(history.map(run => [run.id, run]));
  if (selected) runs.set(selected.id, selected);
  const neighbors = new Map([...runs.keys()].map(id => [id, new Set<string>()]));
  for (const run of runs.values()) {
    for (const parentId of [run.continuationOf, run.retryOf]) {
      const parent = parentId ? runs.get(parentId) : undefined;
      // An edited retry is a related version, not the same requirement.
      if (parent && parent.question === run.question) {
        neighbors.get(run.id)!.add(parent.id);
        neighbors.get(parent.id)!.add(run.id);
      }
    }
  }
  const visited = new Set<string>(), groups: DemandGroup[] = [];
  for (const run of runs.values()) {
    if (visited.has(run.id)) continue;
    const pending = [run.id], members: LineageRun[] = [];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id); members.push(runs.get(id)!);
      pending.push(...neighbors.get(id)!);
    }
    members.sort(byTime);
    groups.push({ id: members[0]!.id, runs: members, incomplete: members.some(item => [item.continuationOf, item.retryOf].some(id => id && !runs.has(id))) });
  }
  return groups.sort((a, b) => byTime(b.runs.at(-1)!, a.runs.at(-1)!));
}

export function currentGroupNotes(group: DemandGroup, notes: ResearchNoteView[]): ResearchNoteView[] {
  const ids = new Set(group.runs.map(run => run.id));
  return notes.filter(note => note.originDemandId && ids.has(note.originDemandId) && !note.supersededBy)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export const demandRunLabel = (run: LineageRun | DemandSummary) => run.continuationOf ? run.retryOf ? "源码恢复" : "源码续研" : run.retryOf ? "评估恢复 / 重新研究" : "需求研究";
export const demandGroupEntry = (group: DemandGroup) => group.runs.find(run => !run.continuationOf && ["succeeded", "partial"].includes(run.status)) ?? group.runs.find(run => ["succeeded", "partial"].includes(run.status)) ?? group.runs[0]!;
