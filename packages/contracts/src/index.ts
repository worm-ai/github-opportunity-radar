import { createSignal, validateSignal, type W2ASignal } from "@world2agent/sdk";
import { createHash } from "node:crypto";
export { explainAnalysisOutcome } from "./analysis-outcome.js";
export type { AnalysisOutcome, AnalysisOutcomeInput } from "./analysis-outcome.js";
export { readmeEvidenceExcerpt } from "./excerpts.js";
export type { W2ASignal } from "@world2agent/sdk";
export type { RepositoryDocument, RepositoryDocumentation } from "./documentation.js";
export type { PublicIssue, IssueContext, MonitoredIssue } from "./issues.js";
export { collectedResearchIssues, issueContextOutdated, issueCommentSamplingDescription, pullRequestSourceText, boundedIssueBody, issueBodyDescription } from "./issues.js";
export * from "./research.js";

export type RepositorySignalInput = {
  repositoryId: number;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  license: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  createdAt: string;
  pushedAt: string | null;
  readmeExcerpt: string | null;
  releaseTag: string | null;
  releaseUrl: string | null;
  issues?: Array<{ id: number; number: number; title: string; bodyExcerpt: string; bodyTruncated?: boolean; url: string; updatedAt: string }>;
  issuesFetchedAt?: string | null;
  discoveryChannels?: string[];
};

const sensor = {
  id: "@radar/sensor-github",
  version: "0.1.0",
  source_type: "github",
};

const repositoryEventSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    externalId: { type: "string", description: "Stable repository observation key" },
    repositoryId: { type: "integer", description: "GitHub repository identifier" },
    fullName: { type: "string", description: "Repository owner and name" },
    url: { type: "string", description: "Canonical repository URL" },
    description: { type: ["string", "null"] },
    language: { type: ["string", "null"] },
    license: { type: ["string", "null"] },
    stars: { type: "integer" },
    forks: { type: "integer" },
    openIssues: { type: "integer" },
    createdAt: { type: "string", format: "date-time" },
    pushedAt: { type: ["string", "null"], format: "date-time" },
    readmeExcerpt: { type: ["string", "null"] },
    releaseTag: { type: ["string", "null"] },
    releaseUrl: { type: ["string", "null"], format: "uri" },
    issues: { type: "array", maxItems: 5, items: { type: "object", required: ["id", "number", "title", "bodyExcerpt", "url", "updatedAt"] } },
    issuesFetchedAt: { type: ["string", "null"], format: "date-time" },
    discoveryChannels: { type: "array", items: { type: "string" } },
  },
  required: ["externalId", "repositoryId", "fullName", "url", "stars", "forks", "openIssues", "createdAt"],
  additionalProperties: false,
};

export function repositoryObservationKey(input: RepositorySignalInput) {
  const contentHash = createHash("sha256").update(JSON.stringify({
    description: input.description, license: input.license, stars: input.stars, forks: input.forks, openIssues: input.openIssues,
    readme: input.readmeExcerpt, issues: [...(input.issues ?? [])].sort((a, b) => a.number - b.number),
  })).digest("hex").slice(0, 20);
  return [input.repositoryId, input.pushedAt ?? "never-pushed", input.releaseTag ?? "no-release", contentHash].join(":");
}

export function createRepositorySignal(input: RepositorySignalInput): W2ASignal {
  const externalId = repositoryObservationKey(input);
  const occurredAt = Date.parse(input.pushedAt ?? input.createdAt);
  const signal = createSignal(sensor, {
    source: { user_identity: "public" },
    event: {
      type: "github.repository.observed",
      occurred_at: Number.isFinite(occurredAt) ? occurredAt : Date.now(),
      summary: `Public GitHub repository ${input.fullName} observed.`,
    },
    source_event: {
      schema: repositoryEventSchema,
      data: { externalId, ...input },
    },
  });
  const validation = validateSignal(signal);
  if (!validation.success) throw new Error(`W2A signal validation failed: ${JSON.stringify(validation.errors)}`);
  return signal;
}

export function createDocumentationSignal(repositoryId: string, fullName: string, documentation: import("./documentation.js").RepositoryDocumentation): W2ASignal {
  const externalId = `${repositoryId}:docs:${createHash("sha256").update(JSON.stringify(documentation)).digest("hex").slice(0, 24)}`;
  const signal = createSignal(sensor, {
    source: { user_identity: "public" },
    event: { type: "github.documentation.observed", occurred_at: Date.parse(documentation.observedAt), summary: `Technical documentation observed for ${fullName}.` },
    source_event: {
      schema: { type: "object", properties: { externalId: { type: "string" }, repositoryId: { type: "string" }, fullName: { type: "string" }, documentation: { type: "object" } }, required: ["externalId", "repositoryId", "fullName", "documentation"], additionalProperties: false },
      data: { externalId, repositoryId, fullName, documentation },
    },
  });
  const validation = validateSignal(signal);
  if (!validation.success) throw new Error("W2A documentation signal validation failed");
  return signal;
}

export function createIssueContextSignal(repositoryId: string, fullName: string, context: import("./issues.js").IssueContext): W2ASignal {
  const externalId = `${repositoryId}:issue:${context.issue.number}:${createHash("sha256").update(JSON.stringify(context)).digest("hex").slice(0, 24)}`;
  const signal = createSignal(sensor, {
    source: { user_identity: "public" },
    event: { type: "github.issue.context.observed", occurred_at: Date.parse(context.observedAt), summary: `Public issue and bounded discussion observed for ${fullName} #${context.issue.number}.` },
    source_event: {
      schema: { type: "object", properties: { externalId: { type: "string" }, repositoryId: { type: "string" }, fullName: { type: "string" }, context: { type: "object" } }, required: ["externalId", "repositoryId", "fullName", "context"], additionalProperties: false },
      data: { externalId, repositoryId, fullName, context },
    },
  });
  const validation = validateSignal(signal);
  if (!validation.success) throw new Error("W2A Issue context signal validation failed");
  return signal;
}
