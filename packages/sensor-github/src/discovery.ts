import { createHash } from "node:crypto";

export type DiscoverySettings = {
  searchQuery: string; createdWithinDays: number; maxResults: number;
  discoveryMode?: "balanced" | "custom";
};
export type DiscoveryProgress = Record<string, { key: string; page: number; explorePage: number }>;
export type DiscoveryTrack = {
  id: string; label: string; query: string; sort: "stars" | "updated" | "created"; limit: number;
  page?: number; explorePage?: number; cursorKey?: string;
  found?: number; totalCount?: number; hasMore?: boolean; searchComplete?: boolean; incomplete?: boolean; error?: string;
};

// Alternate current leaders with deeper samples. GitHub Search is a changing ranking, not a snapshot.
export const maxDiscoveryPage = 20;

export function buildRepositorySearchQuery(query: string, createdWithinDays: number, now = new Date()) {
  if (/\bcreated:/i.test(query)) return query;
  const cutoff = new Date(now.getTime() - createdWithinDays * 86400000).toISOString().slice(0, 10);
  return `${query.trim()} created:>=${cutoff}`;
}

export function buildDiscoveryPlan(settings: DiscoverySettings, now = new Date(), progress: DiscoveryProgress = {}): DiscoveryTrack[] {
  const day = (days: number) => new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const balanced = settings.discoveryMode === "balanced";
  const custom = { id: "custom", label: "自定义关注", query: buildRepositorySearchQuery(settings.searchQuery, settings.createdWithinDays, now), sort: balanced ? "stars" as const : "created" as const };
  const specs: Omit<DiscoveryTrack, "limit">[] = balanced ? [
    { id: "rising", label: "新兴能力", query: `stars:>=30 archived:false fork:false created:>=${day(settings.createdWithinDays)}`, sort: "stars" },
    { id: "early", label: "早期项目", query: `stars:10..1000 archived:false fork:false created:>=${day(30)}`, sort: "updated" },
    { id: "automation", label: "自动化组件", query: `topic:automation stars:>=50 archived:false fork:false pushed:>=${day(30)}`, sort: "stars" },
    { id: "data", label: "数据基础设施", query: `topic:data-engineering stars:>=50 archived:false fork:false pushed:>=${day(30)}`, sort: "stars" },
    custom,
  ] : [custom];
  return specs.map((spec, index) => {
    const limit = Math.floor(settings.maxResults / specs.length) + Number(index < settings.maxResults % specs.length);
    // Include semantic settings, not the rolling date, so daily scans can continue exploring.
    const cursorKey = createHash("sha256").update(JSON.stringify({
      version: 1, mode: balanced ? "balanced" : "custom", id: spec.id, sort: spec.sort, limit,
      ...(spec.id === "custom" ? { query: settings.searchQuery.trim(), days: settings.createdWithinDays } : {}),
      ...(spec.id === "rising" ? { days: settings.createdWithinDays } : {}),
    })).digest("hex");
    const previous = progress[spec.id];
    const cap = Math.min(maxDiscoveryPage, Math.floor(1000 / Math.max(1, limit)));
    const valid = previous?.key === cursorKey && Number.isInteger(previous.page) && previous.page >= 1 && previous.page <= cap && Number.isInteger(previous.explorePage) && previous.explorePage >= 2 && previous.explorePage <= cap;
    return { ...spec, limit, cursorKey, page: valid ? previous.page : 1, explorePage: valid ? previous.explorePage : 2 };
  }).filter((track) => track.limit > 0);
}

export function advanceDiscoveryProgress(progress: DiscoveryProgress, tracks: DiscoveryTrack[]): DiscoveryProgress {
  const next = { ...progress };
  for (const track of tracks) {
    if (!track.cursorKey || !track.searchComplete || track.error) continue;
    const page = track.page ?? 1;
    const cap = Math.min(maxDiscoveryPage, Math.floor(1000 / track.limit));
    next[track.id] = page === 1
      ? { key: track.cursorKey, page: track.hasMore ? track.explorePage ?? 2 : 1, explorePage: track.hasMore ? track.explorePage ?? 2 : 2 }
      : { key: track.cursorKey, page: 1, explorePage: track.hasMore && page < cap ? page + 1 : 2 };
  }
  return next;
}
