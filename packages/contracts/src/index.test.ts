import { describe, expect, it } from "vitest";
import { createDocumentationSignal, createIssueContextSignal, createRepositorySignal, repositoryObservationKey, issueContextOutdated, type IssueContext } from "./index.js";

const repository = {
  repositoryId: 42,
  fullName: "sample/agent-memory",
  url: "https://github.com/sample/agent-memory",
  description: "Persistent memory primitives for AI agent applications.",
  language: "TypeScript",
  license: "MIT",
  stars: 140,
  forks: 12,
  openIssues: 3,
  createdAt: "2026-10-01T00:00:00.000Z",
  pushedAt: "2026-10-10T00:00:00.000Z",
  readmeExcerpt: "Persistent vector memory for agent applications.",
  releaseTag: "v1.0.0",
  releaseUrl: "https://github.com/sample/agent-memory/releases/tag/v1.0.0",
};

describe("World2Agent repository signal", () => {
  it("retains bounded discussion identity and distinguishes newer samples from a checked snapshot", () => {
    const context: IssueContext = { issue: { id: 7, number: 7, title: "Retain original data", bodyExcerpt: "Avoid losing image data during export.", bodyTruncated: false, url: `${repository.url}/issues/7`, state: "closed", stateReason: "completed", closedAt: "2026-10-20T00:00:00Z", createdAt: repository.createdAt, updatedAt: "2026-10-20T00:00:00Z", comments: 0, reactions: 0, authorAssociation: "NONE" }, comments: [], commentsComplete: true, commentsError: null, commentsObservedAt: "2026-10-20T01:00:00Z", observedAt: "2026-10-20T01:00:00Z" };
    const signal = createIssueContextSignal("42", repository.fullName, context);
    expect(signal.event.type).toBe("github.issue.context.observed");
    expect(signal.source_event?.data.context).toEqual(context);
    expect(issueContextOutdated(context, "2026-10-20T02:00:00Z")).toBe(true);
    expect(issueContextOutdated(context, "2026-10-20T00:00:00Z")).toBe(false);
  });
  it("retains technical source identity in a validated documentation signal", () => {
    const documentation = { documents: [{ path: "docs/api.md", url: "https://github.com/sample/agent-memory/blob/HEAD/docs/api.md", sha: "a".repeat(40), excerpt: "The API accepts structured JSON data.", observedAt: "2026-10-20T00:00:00Z" }], attemptedPaths: ["docs/api.md"], warnings: [], observedAt: "2026-10-20T00:00:00Z" };
    const signal = createDocumentationSignal("42", repository.fullName, documentation);
    expect(signal.schema_version).toBe("w2a/0.1");
    expect(signal.event.type).toBe("github.documentation.observed");
    expect(signal.source_event?.data.documentation).toEqual(documentation);
    expect(signal.source_event?.data.externalId).toBe(createDocumentationSignal("42", repository.fullName, documentation).source_event?.data.externalId);
  });
  it("creates a valid w2a/0.1 signal with a stable source event key", () => {
    const signal = createRepositorySignal(repository);
    expect(signal.schema_version).toBe("w2a/0.1");
    expect(signal.source.source_type).toBe("github");
    expect(signal.source.package).toBe("@radar/sensor-github");
    expect(signal.event.type).toBe("github.repository.observed");
    expect(signal.source_event?.data.externalId).toMatch(/^42:2026-10-10T00:00:00\.000Z:v1\.0\.0:[a-f0-9]{20}$/);
    expect(repositoryObservationKey(repository)).toBe(signal.source_event?.data.externalId);
  });
  it("emits changed evidence without inventing a source change from a fetch timestamp", () => {
    const issue = { id: 2, number: 2, title: "Export structured results", bodyExcerpt: "Please allow exporting structured results as JSON.", url: "https://github.com/sample/agent-memory/issues/2", updatedAt: "2026-10-20T00:00:00Z" };
    const original = repositoryObservationKey(repository);
    expect(repositoryObservationKey({ ...repository, issues: [issue] })).not.toBe(original);
    expect(repositoryObservationKey({ ...repository, stars: repository.stars + 1 })).not.toBe(original);
    expect(repositoryObservationKey({ ...repository, issues: [issue], issuesFetchedAt: "2026-10-21T00:00:00Z" })).toBe(repositoryObservationKey({ ...repository, issues: [issue], issuesFetchedAt: "2026-10-20T00:00:00Z" }));
  });
});
