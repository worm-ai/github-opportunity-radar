import type { ResearchNoteInput, ResearchNoteView, ResearchSource } from "@radar/contracts/research";
import type { DemandSnapshot } from "../../../packages/analysis/src/demand";
export type { DemandSnapshot } from "../../../packages/analysis/src/demand";
export type DemandRun = { id: string; requestId: string; question: string; retryOf: string | null; continuationOf?: string | null; continuationInput?: { projectIds: string[]; capabilityIds: string[] } | null; status: "running" | "succeeded" | "partial" | "failed" | "interrupted"; startedAt: string; updatedAt: string; finishedAt: string | null; error: string | null; snapshot: DemandSnapshot | null };
export type DemandSummary = Omit<DemandRun, "snapshot"> & { stage: DemandSnapshot["stage"] | null; outcome: DemandSnapshot["outcome"] | null; researchNoteCount: number };
import type { TaskMeasurement, TrialMeasurement, ValidationRecord } from "@radar/contracts/validation";
import type { IssueContext, MonitoredIssue } from "@radar/contracts/issues";
export type { IssueContext } from "@radar/contracts/issues";
export type { ResearchNoteInput, ResearchNoteView } from "@radar/contracts/research";

export type Project = {
  id: string;
  fullName: string;
  firstSeenAt: string | null;
  description: string | null;
  language: string | null;
  license: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  createdAt: string;
  pushedAt: string | null;
  url: string;
  readmeExcerpt: string | null;
  score: number;
  scoreReasons: string[];
  capabilities: string[];
  observedAt: string;
  discoveryChannels: string[];
  issuesFetchedAt: string | null;
  issues: Array<{ id: number; number: number; title: string; bodyExcerpt: string; bodyTruncated?: boolean; url: string; updatedAt: string; comments: number; reactions: number; authorAssociation: string; authorLogin?: string | null }>;
  documentation?: RepositoryDocumentation | null;
  issueContexts?: Record<string, IssueContext>;
  discovery: { kind: "capability_hint" | "resource_hint" | "unclassified"; resourceQuote: string | null; clues: CapabilityClue[] };
};
export type ProjectSearchResponse = { mode: "local_cache"; query: string; observedAt: string | null; expandedQueries: string[]; items: Array<Project & { matchedFields: Array<"fullName" | "description" | "readmeExcerpt">; matchedEvidence: Array<{ field: "fullName" | "description" | "readmeExcerpt"; excerpt: string }> }> };

export type CapabilityClue = { id: string; label: string; source: "description" | "readme"; quote: string; url: string; observedAt: string; nextCheck: string };
export type DiscoveryItem = {
  id: string; fullName: string; description: string | null; url: string; createdAt: string; firstSeenAt: string | null; observedAt: string;
  license: string | null; releaseTag: string | null; releaseUrl: string | null; issueCount: number; issuesFetchedAt: string | null; documentationCount: number;
  kind: Project["discovery"]["kind"]; resourceQuote: string | null; clues: CapabilityClue[]; firstSeenInScan: boolean;
  observation: { count: number; comparison: { from: string; to: string; stars: number; forks: number; openIssues: number } | null; releaseChange: { from: string; to: string; fromObservedAt: string; toObservedAt: string } | null };
};
export type DiscoveryBrief = {
  scan: { id: string; startedAt: string; finishedAt: string | null } | null;
  summary: { total: number; withClues: number; resources: number; unclassified: number; firstSeenInScan: number; releaseChanges: number };
  categories: Array<{ id: string; label: string; count: number }>;
  items: DiscoveryItem[];
};

export type RepositoryDocumentation = {
  documents: Array<{ path: string; url: string; sha: string; excerpt: string; observedAt: string; stale?: boolean; ref?: string; commitSha?: string }>;
  attemptedPaths: string[]; warnings: string[]; observedAt: string; ref?: string; commitSha?: string;
};

export type Evidence = {
  url: string | null;
  quote: string;
  observedAt: string;
  relation: "supports" | "refutes";
  sourcePath?: string;
  sourceSha?: string;
};

export type Opportunity = {
  researchProfile?: Settings["researchProfile"];
  supersededAt?: string | null;
  researchFocus?: ResearchFocus | null;
  id: string;
  title: string;
  targetUser: string;
  jobToBeDone: string;
  hypothesis: string;
  projectIds: string[];
  projectNames: string[];
  status: "candidate" | "saved" | "validating" | "completed" | "dismissed";
  score: number;
  marketStatus: "unvalidated" | "evidence_recorded";
  supportingEvidence: Evidence[];
  counterEvidence: Evidence[];
  validationSteps: string[];
  successMetric: string;
  failureMetric: string;
  validationRecord: ValidationRecord | null;
  validationRecords: ValidationRecord[];
  validationProgress?: Array<{ index: number; step: string; status: "completed" | "skipped"; note: string; updatedAt: string }>;
  createdAt: string;
  combinationKey: string;
  components?: Array<{ projectId: string; role: string; input: string; output: string }>;
  integrationPlan?: string;
  alternatives?: string;
  whyNow?: string;
  firstExperiment?: string;
  problemEvidence?: Evidence[];
};

export type RelatedResearchNote = ResearchNoteView & { sharedProjectIds: string[]; relation: "exact" | "partial" };

export type AnalysisRun = {
  modelsUsed?: string[];
  candidateAudits?: Array<{
    index: number; proposal: unknown; evidenceStatus: "passed" | "schema_failed" | "evidence_failed";
    evidenceFailures?: Array<{ code: string; message: string; projectId?: string; issueNumber?: number; commentId?: number; field?: string; documentPath?: string }>;
    review: { index: number; verdict: "keep" | "reject"; reason: string; risks: string[]; checks: { distinctRoles: boolean; evidenceSupportsRoles: boolean; plausibleIntegration: boolean; specificTestableProblem: boolean; claimsStayHypothetical: boolean; problemSignalsRelevant: boolean; profileFit?: "not_applicable" | "aligned" | "plausible" | "unknown" | "misaligned" } } | null;
  }> | null;
  focus?: ResearchFocus | null;
  researchProfile?: Settings["researchProfile"];
  reusedFrom?: string | null;
  id: string; model: string; promptVersion: string | null; status: "running" | "succeeded" | "failed"; startedAt: string; finishedAt: string | null;
  opportunities: number; rejected: number; error: string | null; usage: { promptTokens: number; completionTokens: number; complete: boolean } | null;
  analyzedProjects: Array<{ id: string; fullName: string; url?: string }>;
  selection?: {
    catalogProjects: number;
    groups: Array<{ projectIds: string[]; projectNames: string[]; researchQuestion: string; reason: string }>;
    skipped: Array<{ projectId: string; projectName: string; reason: string }>;
    warnings?: string[];
  } | null;
  decisions: Array<{ title: string; stage: "schema" | "evidence" | "review" | "accepted"; reason: string; projectIds?: string[]; projectNames: string[] }>;
};
export type ResearchFocus = { projectIds: string[]; question: string; originIssue?: { projectId: string; issueNumber: number } };
export type ComponentSearch = {
  query: string; total: number; incomplete: boolean; observedAt: string;
  items: Array<{ id: number; fullName: string; description: string | null; language: string | null; license: string | null; stars: number; createdAt: string; pushedAt: string | null; url: string; archived: boolean; fork: boolean; collected: boolean }>;
};
export type TechnicalExperiment = {
  id: string; title: string; question: string; conclusion: string; executedAt: string; environment: string; inputOrigin: string;
  projectIds: string[]; sources: Array<{ repository: string; commit: string; modification?: { artifact: string; sha256: string; description: string } }>;
  checks: Array<{ label: string; observation: string; outcome: "supported" | "refuted" | "inconclusive" }>;
  limitations: string[]; nextAction: string;
  artifacts: Array<{ name: string; label: string; sha256: string }>;
};
export type ExperimentRun = {
  id: string; experimentId: string; status: "queued" | "running" | "succeeded" | "failed";
  startedAt: string; finishedAt: string | null; command: string[]; logFile: string; outputTail: string; error: string | null;
};
export type DiscoveryTrack = { id: string; label: string; query: string; sort: string; limit: number; page?: number; found?: number; totalCount?: number; searchComplete?: boolean; incomplete?: boolean; error?: string };

export type IntegrationStatus = {
  runtime: "local" | "iii"; engineState: string; completedExecutions: number;
  github: { tokenConfigured: boolean; caConfigured: boolean };
  evidence: { running: boolean; projectId: string | null };
  analysis: { mode: "rules" | "deepseek" | "opencode" | "local" | "codex"; state: "configured" | "needs_api_key" | "needs_cli" | "rules_only"; freeModelsOnly?: boolean; codexFallback?: boolean; automaticPaidFallback?: boolean; model: string; running: boolean;
    lastRun: AnalysisRun | null;
  };
};

export type ScanRun = {
  id: string;
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
  startedAt: string;
  finishedAt: string | null;
  found: number;
  inserted: number;
  duplicates: number;
  error: string | null;
  warnings: string[];
  tracks?: DiscoveryTrack[];
};

export type Settings = {
  searchQuery: string;
  createdWithinDays: number;
  maxResults: number;
  scanIntervalHours: number;
  discoveryMode: "balanced" | "custom";
  researchProfile: { targetUser: string; recurringWork: string; constraints: string } | null;
};

export type ProjectMonitor = { projectId: string; fullName?: string; enabled: boolean; status: "idle" | "running" | "succeeded" | "partial" | "failed"; enabledAt?: string; lastAttemptAt?: string | null; lastFinishedAt?: string | null; lastSuccessAt?: string | null; nextDueAt?: string; error?: string | null; warning?: string | null; changes?: { stars: number; releaseBefore: string | null; releaseAfter: string | null; readmeChanged: boolean } | null; issues?: MonitoredIssue[] };
export type MonitoringStatus = { limit: number; batchLimit: number; intervalHours: number; pausedUntil: string | null; items: ProjectMonitor[]; discussionChanges?: Array<MonitoredIssue & { projectId: string; fullName: string; enabled: boolean }> };
export type { TaskMeasurement } from "@radar/contracts/validation";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  demands: () => request<DemandSummary[]>("/demands"),
  demand: (id: string) => request<DemandRun>(`/demands/${encodeURIComponent(id)}`),
  startDemand: (input: { question: string; requestId: string; retryOf?: string | null }) => request<DemandRun>("/demands", { method: "POST", body: JSON.stringify(input) }),
  demandFeatures: () => request<{ sourceStudy: boolean; sourceResume?: boolean; selectionResume?: boolean; evaluationResume?: boolean; fallbackEvaluationResume?: boolean; gapResume?: boolean; researchNotes?: boolean }>("/demands/features"),
  resumeDemandSelection: (input: { runId: string; requestId: string }) => request<DemandRun>(`/demands/${encodeURIComponent(input.runId)}/resume-selection`, { method: "POST", body: JSON.stringify({ requestId: input.requestId }) }),
  resumeDemandEvaluation: (input: { runId: string; requestId: string }) => request<DemandRun>(`/demands/${encodeURIComponent(input.runId)}/resume-evaluation`, { method: "POST", body: JSON.stringify({ requestId: input.requestId }) }),
  resumeDemandGaps: (input: { runId: string; requestId: string }) => request<DemandRun>(`/demands/${encodeURIComponent(input.runId)}/resume-gaps`, { method: "POST", body: JSON.stringify({ requestId: input.requestId }) }),
  demandNoteSources: (id: string) => request<{ sources: ResearchSource[]; warnings: string[] }>(`/demands/${encodeURIComponent(id)}/note-sources`),
  demandResearchNotes: (id: string) => request<ResearchNoteView[]>(`/demands/${encodeURIComponent(id)}/research-notes`),
  resumeDemandSource: (input: { runId: string; requestId: string }) => request<DemandRun>(`/demands/${encodeURIComponent(input.runId)}/resume-source`, { method: "POST", body: JSON.stringify({ requestId: input.requestId }) }),
  continueDemand: (input: { parentId: string; requestId: string; projectIds: string[]; capabilityIds: string[] }) => { const { parentId, ...body } = input; return request<DemandRun>(`/demands/${encodeURIComponent(parentId)}/continue`, { method: "POST", body: JSON.stringify(body) }); },
  researchLeads: () => request<{ leads: ResearchLead[] }>("/research/leads"),
  monitoring: () => request<MonitoringStatus>("/monitoring"),
  projectMonitor: (id: string) => request<ProjectMonitor>(`/projects/${id}/monitor`),
  setProjectMonitor: (id: string, enabled: boolean) => request<ProjectMonitor>(`/projects/${id}/monitor`, { method: "PUT", body: JSON.stringify({ enabled }) }),
  setMonitoredIssue: (id: string, number: number, enabled: boolean) => request<ProjectMonitor>(`/projects/${id}/monitor/issues/${number}`, { method: "PUT", body: JSON.stringify({ enabled }) }),
  acknowledgeMonitoredIssue: (id: string, number: number, changeId: string) => request<ProjectMonitor>(`/projects/${id}/monitor/issues/${number}/acknowledge`, { method: "POST", body: JSON.stringify({ changeId }) }),
  refreshProject: (id: string) => request<ProjectMonitor>(`/projects/${id}/refresh`, { method: "POST", body: "{}" }),
  researchNotes: () => request<ResearchNoteView[]>("/research-notes"),
  researchNote: (id: string) => request<ResearchNoteView>(`/research-notes/${encodeURIComponent(id)}`),
  saveResearchNote: (note: ResearchNoteInput) => request<ResearchNoteView>("/research-notes", { method: "POST", body: JSON.stringify(note) }),
  taskMeasurements: () => request<TaskMeasurement[]>("/task-measurements"),
  saveTaskMeasurement: (measurement: Omit<TaskMeasurement, "id" | "createdAt"> & { requestId: string }) => request<TaskMeasurement>("/task-measurements", { method: "POST", body: JSON.stringify(measurement) }),
  refreshIssue: (id: string, number: number) => request<IssueContext>(`/projects/${id}/issues/${number}/context`, { method: "POST", body: "{}" }),
  importIssue: (id: string, issue: string) => request<IssueContext>(`/projects/${id}/issues/import`, { method: "POST", body: JSON.stringify({ issue }) }),
  findComponents: (query: string) => request<ComponentSearch>("/components/search", { method: "POST", body: JSON.stringify({ query }) }),
  importComponent: (repository: string) => request<{ id: string; fullName: string; existing: boolean; warning: string | null; observedAt: string }>("/components/import", { method: "POST", body: JSON.stringify({ repository }) }),
  discoveryBrief: () => request<DiscoveryBrief>("/discovery/brief"),
  experiments: () => request<{ records: TechnicalExperiment[]; warnings: string[]; runnableIds?: string[] }>("/experiments"),
  experimentRuns: () => request<ExperimentRun[]>("/experiments/runs"),
  startExperimentRun: (id: string) => request<ExperimentRun>(`/experiments/${encodeURIComponent(id)}/runs`, { method: "POST", body: "{}" }),
  dashboard: () => request<IntegrationStatus & { projectCount: number; opportunityCount: number; freshCount: number; issueSampleCount: number; lastScan: ScanRun | null }>("/dashboard"),
  integrations: () => request<IntegrationStatus>("/integrations"),
  analyze: () => request<{ status: string }>("/analysis", { method: "POST", body: "{}" }),
  research: (focus: ResearchFocus) => request<{ status: string }>("/analysis", { method: "POST", body: JSON.stringify({ focus }) }),
  projects: () => request<Project[]>("/projects"),
  searchProjects: (query: string, limit = 30, expand = false) => request<ProjectSearchResponse>(`/projects/search?q=${encodeURIComponent(query)}&limit=${limit}${expand ? "&expand=true" : ""}`),
  project: (id: string) => request<Project>(`/projects/${id}`),
  collectDocumentation: (id: string, paths?: string[], ref?: string) => request<RepositoryDocumentation>(`/projects/${id}/documentation`, { method: "POST", body: JSON.stringify({ paths, ref }) }),
  opportunities: () => request<Opportunity[]>("/opportunities"),
  opportunityHistory: () => request<Opportunity[]>("/opportunities?view=history"),
  opportunity: (id: string) => request<Opportunity>(`/opportunities/${id}`),
  opportunityResearchNotes: (id: string) => request<RelatedResearchNote[]>(`/opportunities/${id}/research-notes`),
  scans: () => request<ScanRun[]>("/scans"),
  analysisRuns: () => request<AnalysisRun[]>("/analysis/runs"),
  discoveryPlan: () => request<DiscoveryTrack[]>("/discovery/plan"),
  observations: (id: string) => request<Array<{ observedAt: string; stars: number; releaseTag: string | null }>>(`/projects/${id}/observations`),
  startScan: () => request<{ id: string; status: ScanRun["status"] }>("/scans", { method: "POST", body: "{}" }),
  settings: () => request<Settings>("/settings"),
  saveSettings: (settings: Settings) => request<Settings>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
  updateOpportunity: (id: string, status: "candidate" | "saved" | "validating" | "dismissed") => request<Opportunity>(`/opportunities/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  recordValidation: (id: string, method: "interview" | "trial" | "payment", outcome: "supports" | "refutes" | "inconclusive", note: string, trialMeasurement?: TrialMeasurement) => request<Opportunity>(`/opportunities/${id}/validation`, { method: "POST", body: JSON.stringify({ method, outcome, note, ...(trialMeasurement ? { trialMeasurement } : {}) }) }),
  updateValidationStep: (id: string, index: number, step: string, status: "pending" | "completed" | "skipped", note: string) => request<Opportunity>(`/opportunities/${id}/steps/${index}`, { method: "PUT", body: JSON.stringify({ step, status, note }) }),
};

export type ResearchLead = {
  id: string; runId: string; candidateIndex: number; observedAt: string; title: string;
  status: "schema_failed" | "evidence_gap" | "rejected" | "review_incomplete";
  projects: AnalysisRun["analyzedProjects"]; reason: string; gaps: Array<{ code: string; message: string }>;
  nextSteps: string[]; proposedExperiment: string | null;
  resume: { projectIds: string[]; question: string; originIssue?: { projectId: string; issueNumber: number } } | null;
};
