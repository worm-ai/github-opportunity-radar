import { describe, expect, it } from "vitest";
import type { DemandSnapshot, TechnicalExperiment } from "./api";
import { matchDemandExperiments } from "./demand-experiments";

const commit = "a".repeat(40), other = "b".repeat(40);
const project = { id: "1", fullName: "Owner/Repo", url: "https://github.com/Owner/Repo", license: null, language: null, observedAt: "2026-10-23" };
const code = (commitSha: string | null, url = "https://github.com/owner/repo/blob/main/file.py"): DemandSnapshot["sources"][number] => ({ id: "source", projectId: "1", field: "code", url, observedAt: "2026-10-23", content: "", path: "file.py", sha: null, commitSha, notice: "" });
const record: TechnicalExperiment = { id: "test", title: "experiment", question: "question", conclusion: "conclusion", executedAt: "2026-10-23T00:00:00Z", environment: "test", inputOrigin: "synthetic", projectIds: ["unrelated-id"], sources: [{ repository: "owner/repo", commit }], checks: [], limitations: [], nextAction: "next", artifacts: [] };
const snapshot = (sources: DemandSnapshot["sources"] = []): Pick<DemandSnapshot, "projects" | "sources"> => ({ projects: [project], sources });
const version = (sources: DemandSnapshot["sources"]) => matchDemandExperiments(snapshot(sources), [record])[0]!.repositories[0]!.version;

describe("manual experiment correspondence", () => {
  it("keeps a local adaptation distinct even when its upstream base matches the research", () => {
    const modification = { artifact: "adaptation.json", sha256: "c".repeat(64), description: "Added persistence and a rule policy" };
    const adapted = { ...record, sources: [{ ...record.sources[0]!, modification }] };
    for (const sources of [[code(commit)], [code(other)], []]) {
      const match = matchDemandExperiments(snapshot(sources), [adapted])[0]!;
      expect(match.repositories[0]).toMatchObject({ version: "adapted", experimentCommit: commit, modification });
      expect(match.repositories[0]!.researchCommits).toEqual(sources.map(source => source.commitSha));
    }
  });
  it("matches repository identity case insensitively, independently of stored project IDs", () => {
    expect(version([code(commit.toUpperCase())])).toBe("same");
    expect(matchDemandExperiments({ projects: [{ ...project, fullName: "other/repo", url: "https://github.com/other/repo" }], sources: [] }, [{ ...record, projectIds: ["1"] }])).toEqual([]);
  });
  it("rejects conflicting project names and deceptive GitHub URLs", () => {
    for (const url of ["https://github.com/other/repo", "https://github.com.evil.test/owner/repo", "https://github.com@evil.test/owner/repo", "https://evil.test/owner/repo"]) {
      expect(matchDemandExperiments({ projects: [{ ...project, url }], sources: [] }, [record])).toEqual([]);
    }
  });
  it("never infers pinned versions from README metadata or blob hashes", () => {
    expect(version([])).toBe("unknown");
    expect(version([{ ...code(commit), field: "readme" }])).toBe("unknown");
    expect(version([{ ...code(null), sha: commit }])).toBe("unknown");
    expect(version([code("aaaaaaa")])).toBe("unknown");
  });
  it("distinguishes different, conflicting, and partially unknown source versions", () => {
    expect(version([code(other)])).toBe("different");
    expect(version([code(commit), code(other)])).toBe("mixed");
    expect(version([code(commit), code(null)])).toBe("mixed");
    expect(version([code(commit), { ...code(null), field: "readme" }])).toBe("same");
  });
  it("does not attribute code commits from a different repository or project", () => {
    expect(version([code(commit, "https://github.com/other/repo/blob/main/f.py")])).toBe("unknown");
    expect(version([{ ...code(commit), projectId: "2" }])).toBe("unknown");
    expect(version([code(commit), code(commit, "https://evil.test/owner/repo")])).toBe("mixed");
  });
  it("keeps unmatched combination components explicit without mutating the research", () => {
    const input = snapshot([code(commit)]), before = JSON.stringify(input);
    const combination = { ...record, sources: [...record.sources, { repository: "other/component", commit: other }] };
    const matches = matchDemandExperiments(input, [combination]);
    expect(matches[0]!.unmatchedRepositories).toEqual(["other/component"]);
    expect(matches[0]!.repositories).toHaveLength(1);
    expect(JSON.stringify(input)).toBe(before);
    expect(matches[0]!.record).toBe(combination);
  });
});
