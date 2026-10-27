import type { ProjectSearchResponse } from "./api";

export type CachedCandidate = ProjectSearchResponse["items"][number];

export type CachedTriage = {
  item: CachedCandidate;
  evidenceCount: number;
  evidenceLabel: "证据较多" | "线索有限";
  matchLabel: "精确命中" | "扩展线索";
  nextAction: string;
};

/**
 * Sorts already-cached evidence for triage. This deliberately does not infer
 * capability satisfaction or produce a recommendation: README/description
 * excerpts only tell us what to inspect first.
 */
export function triageCachedCandidates(items: CachedCandidate[], expandedQueries: string[]): CachedTriage[] {
  return items
    .map((item) => {
      const evidenceCount = item.matchedEvidence.length;
      const hasReadme = item.matchedFields.includes("readmeExcerpt");
      const hasDescription = item.matchedFields.includes("description");
      const evidenceLabel: CachedTriage["evidenceLabel"] = hasReadme && hasDescription ? "证据较多" : "线索有限";
      const matchLabel: CachedTriage["matchLabel"] = expandedQueries.length ? "扩展线索" : "精确命中";
      const nextAction = hasReadme
        ? "先打开 GitHub，核对固定提交、依赖和最小启动命令。"
        : hasDescription
          ? "先确认描述中的能力是否属于项目自身，再查 README 的安装与运行方式。"
          : "先打开项目档案确认它是否真的提供目标能力，再决定是否继续。";
      return { item, evidenceCount, evidenceLabel, matchLabel, nextAction };
    })
    .sort((a, b) => {
      const readme = (value: CachedTriage) => value.item.matchedFields.includes("readmeExcerpt") ? 1 : 0;
      const description = (value: CachedTriage) => value.item.matchedFields.includes("description") ? 1 : 0;
      return readme(b) - readme(a) || description(b) - description(a) || b.evidenceCount - a.evidenceCount || b.item.observedAt.localeCompare(a.item.observedAt) || a.item.fullName.localeCompare(b.item.fullName);
    });
}
