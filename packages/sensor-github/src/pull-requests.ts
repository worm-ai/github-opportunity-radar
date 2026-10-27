import type { IssueContext } from "@radar/contracts";

type Review = NonNullable<IssueContext["referencedPullRequests"]>;
type RawPull = { number: number; title: string; body?: string | null; state: "open" | "closed"; draft: boolean;
  merged: boolean; merged_at: string | null; merge_commit_sha: string | null; updated_at: string;
  base: { repo: { full_name: string; private: boolean } } };

export function referencedNumbers(fullName: string, issueNumber: number, text: string): number[] {
  const mentions: Array<{ index: number; number: number }> = [];
  const prose = text.replace(/```[\s\S]*?```|`[^`\n]*`/g, (code) => " ".repeat(code.length));
  // Remove every URL before looking for shorthand, including cross-repository URL fragments.
  const withoutUrls = prose.replace(/https?:\/\/[^\s<>"')\]]+/g, (match, index: number) => {
    try {
      const url = new URL(match.replace(/[.,;]+$/, ""));
      const path = url.pathname.match(/^\/([^/]+\/[^/]+)\/(?:pull|issues)\/([1-9]\d*)\/?$/);
      if (url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password && !url.port && path?.[1]?.toLowerCase() === fullName.toLowerCase()) mentions.push({ index, number: Number(path[2]) });
    } catch { /* Not a canonical GitHub reference. */ }
    return " ".repeat(match.length);
  });
  for (const match of withoutUrls.matchAll(/(?<![\w/#])#([1-9]\d*)\b/g)) mentions.push({ index: match.index, number: Number(match[1]) });
  return [...new Set(mentions.sort((a, b) => a.index - b.index).map((item) => item.number).filter((number) => Number.isSafeInteger(number) && number !== issueNumber))];
}

export async function collectReferencedPullRequests(fullName: string, issueNumber: number, text: string, request: (number: number) => Promise<RawPull>, throwOnRateLimit = false): Promise<Review> {
  const numbers = referencedNumbers(fullName, issueNumber, text);
  const review: Review = { checkedNumbers: numbers.slice(0, 3), omitted: Math.max(0, numbers.length - 3), notFoundNumbers: [], errors: [], items: [] };
  for (const number of review.checkedNumbers) {
    try {
      const raw = await request(number);
      if (raw.number !== number || raw.base?.repo?.private !== false || raw.base.repo.full_name.toLowerCase() !== fullName.toLowerCase()
        || !["open", "closed"].includes(raw.state) || typeof raw.merged !== "boolean" || typeof raw.draft !== "boolean"
        || typeof raw.title !== "string" || !Number.isFinite(Date.parse(raw.updated_at))
        || (raw.merge_commit_sha !== null && !/^[a-f0-9]{40,64}$/i.test(raw.merge_commit_sha ?? ""))
        || (raw.merged && (raw.state !== "closed" || !raw.merged_at || !Number.isFinite(Date.parse(raw.merged_at))))) throw new Error("GitHub returned an inconsistent public PR snapshot");
      review.items.push({ number, title: raw.title.slice(0, 500), bodyExcerpt: (raw.body ?? "").slice(0, 2000), bodyTruncated: (raw.body?.length ?? 0) > 2000,
        url: `https://github.com/${fullName}/pull/${number}`, state: raw.state, draft: raw.draft, merged: raw.merged, mergedAt: raw.merged_at,
        mergeCommitSha: raw.merge_commit_sha, updatedAt: raw.updated_at });
    } catch (error) {
      if (throwOnRateLimit && error && typeof error === "object" && "code" in error && error.code === "rate_limited") throw error;
      if (error && typeof error === "object" && "code" in error && error.code === "not_found") review.notFoundNumbers.push(number);
      else review.errors.push({ number, message: error instanceof Error ? error.message : "PR unavailable" });
      // An API rate limit applies to the remaining references too; don't keep making requests.
      if (error && typeof error === "object" && "code" in error && error.code === "rate_limited") {
        for (const remaining of review.checkedNumbers.slice(review.checkedNumbers.indexOf(number) + 1)) review.errors.push({ number: remaining, message: "Skipped after GitHub rate limit" });
        break;
      }
    }
  }
  return review;
}
