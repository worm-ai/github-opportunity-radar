import { describe, expect, it } from "vitest";
import { extractCapabilities, generateOpportunityDrafts, scoreProject, type AnalyzableProject } from "./index.js";

const base = {
  description: "",
  language: "TypeScript",
  license: null,
  stars: 0,
  forks: 0,
  openIssues: 0,
  createdAt: "2026-10-01T00:00:00Z",
  pushedAt: "2026-10-10T00:00:00Z",
  readmeExcerpt: "",
  observedAt: "2026-10-17T00:00:00Z",
};

function project(id: string, fullName: string, description: string, readmeExcerpt: string): AnalyzableProject {
  return { ...base, id, fullName, description, readmeExcerpt, url: `https://github.com/${fullName}` };
}

describe("rule analysis", () => {
  it("extracts technical capabilities without treating popularity as market validation", () => {
    const item = project("1", "sample/agent", "LLM agent runtime", "Tool calling and workflow orchestration.");
    const scored = scoreProject({ ...item, stars: 15_000, license: null });
    const noStars = scoreProject({ ...item, stars: 0, license: null });
    expect(extractCapabilities(item)).toContain("Agent runtime");
    expect(scored.reasons).toContain("许可证未知，不推断可商业使用");
    expect(scored.score - noStars.score).toBeLessThanOrEqual(5);
  });

  it("only proposes a paired technical hypothesis when complementary capabilities exist", () => {
    const agent = project("1", "sample/agent", "LLM agent runtime", "Tool calling with pluggable agent tools.");
    const memory = project("2", "sample/memory", "Memory store", "Vector retrieval and long-term memory for AI applications.");
    const unrelated = project("3", "sample/cli", "Command-line formatter", "A small text formatting utility.");
    const secondAgent = project("4", "sample/agent-runtime", "Agent runtime", "LLM agent framework.");
    const secondMemory = project("5", "sample/vector-memory", "Vector store", "Long-term memory for AI agents.");
    const drafts = generateOpportunityDrafts([agent, memory, unrelated, secondAgent, secondMemory]);

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.projectIds).toContain("1");
    expect(drafts[0]?.projectIds).toContain("5");
    expect(drafts[0]?.counterEvidence[0]?.url).toBeNull();
    expect(drafts[0]?.hypothesis).toContain("尚未验证");
    expect(drafts[0]?.score).toBeLessThanOrEqual(65);
    expect(drafts).toHaveLength(1);
  });

  it("does not infer capabilities from generic mentions of agents and workflows", () => {
    const chatbot = project("1", "sample/chatbot", "LLM chatbot", "Uses a workflow to create prompts.");
    const browser = project("2", "sample/browser", "Browser helper", "Opens a browser and formats pages.");
    expect(generateOpportunityDrafts([chatbot, browser])).toHaveLength(0);
  });

  it("pairs a newly discovered project with an already tracked mature component", () => {
    const newAgent = { ...project("1", "sample/new-agent", "LLM agent runtime", "A small agent framework."), createdAt: "2026-10-10T00:00:00Z" };
    const matureMemory = { ...project("2", "sample/mature-memory", "Vector database", "Long-term memory retrieval for AI applications."), createdAt: "2022-01-01T00:00:00Z" };
    const unrelatedNewProject = project("3", "sample/cli", "Command-line formatter", "A small text formatting utility.");

    const drafts = generateOpportunityDrafts([newAgent, matureMemory, unrelatedNewProject], 5, new Set(["1", "3"]));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.projectIds).toEqual(["1", "2"]);
    expect(generateOpportunityDrafts([newAgent, matureMemory], 5, new Set(["unrelated-id"]))).toHaveLength(0);
  });
});
