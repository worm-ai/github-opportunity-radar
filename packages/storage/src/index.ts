import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type { ModelAnalysisResult, ModelUsage, OpportunityDraft, ResearchFocus, ResearchProfile } from "@radar/analysis";
import { canonicalResearchFocus, canonicalResearchProfile } from "@radar/analysis";
import { issueContextOutdated, type W2ASignal, type RepositoryDocumentation, type IssueContext, type MonitoredIssue } from "@radar/contracts";
import type { ResearchNote } from "@radar/contracts";
import type { DemandSnapshot } from "@radar/analysis";
import type { ValidationRecord, TaskMeasurement } from "@radar/contracts/validation";
export type { ValidationRecord, TrialMeasurement, TaskMeasurement } from "@radar/contracts/validation";
import { advanceDiscoveryProgress, type DiscoveryProgress, type DiscoveryTrack, type GitHubRepository } from "@radar/sensor-github";

export type AppSettings = { searchQuery: string; createdWithinDays: number; maxResults: number; scanIntervalHours: number; discoveryMode?: "balanced" | "custom"; researchProfile?: ResearchProfile | null };
export type RunStatus = "queued" | "running" | "succeeded" | "partial" | "failed";
export type DemandRun = { id: string; requestId: string; question: string; retryOf: string | null; continuationOf: string | null; continuationInput: import("@radar/analysis").SourceStudyInput | null; status: "running" | "succeeded" | "partial" | "failed" | "interrupted"; startedAt: string; updatedAt: string; finishedAt: string | null; error: string | null; snapshot: DemandSnapshot | null };
function sourceStudyKey(input: NonNullable<DemandRun["continuationInput"]>) { return JSON.stringify({ projectIds: [...input.projectIds].sort(), capabilityIds: [...input.capabilityIds].sort() }); }
export type ScanRun = { id: string; status: RunStatus; startedAt: string; finishedAt: string | null; found: number; inserted: number; duplicates: number; error: string | null; warnings: string[]; tracks?: DiscoveryTrack[] };
export type ProjectRecord = Omit<GitHubRepository, "id"> & { id: string; firstSeenAt: string | null; score: number; scoreReasons: string[]; capabilities: string[]; observedAt: string };
export type ProjectSearchResult = ProjectRecord & { matchedFields: Array<"fullName" | "description" | "readmeExcerpt">; matchedEvidence: Array<{ field: "fullName" | "description" | "readmeExcerpt"; excerpt: string }> };
export type ProjectSearchOptions = { expandOnEmpty?: boolean };
export type ProjectSearchDetailedResult = { items: ProjectSearchResult[]; expandedQueries: string[] };
export type ProjectObservation = { projectId: string; observedAt: string; stars: number; forks: number; openIssues: number; releaseTag: string | null };
export type MonitorChanges = { stars: number; releaseBefore: string | null; releaseAfter: string | null; readmeChanged: boolean };
export type ProjectMonitor = { projectId: string; fullName: string; enabled: boolean; enabledAt: string; status: "idle" | "running" | "succeeded" | "partial" | "failed"; lastAttemptAt: string | null; lastFinishedAt: string | null; lastSuccessAt: string | null; nextDueAt: string; error: string | null; errorCode: string | null; warning: string | null; changes: MonitorChanges | null; issues: MonitoredIssue[] };

function discussionFingerprint(context: IssueContext) {
  // Observation times and local selection flags are not upstream changes.
  const issue = context.issue, pulls = context.referencedPullRequests;
  return createHash("sha256").update(JSON.stringify([
    [issue.id, issue.number, issue.title, issue.bodyExcerpt, issue.url, issue.state, issue.stateReason, issue.closedAt, issue.updatedAt, issue.comments, issue.reactions, issue.authorLogin ?? null, issue.authorAssociation, issue.bodyTruncated],
    [...context.comments].sort((a, b) => a.id - b.id).map((comment) => [comment.id, comment.url, comment.bodyExcerpt, comment.bodyTruncated, comment.authorLogin, comment.authorAssociation, comment.isBot, comment.createdAt, comment.updatedAt]),
    context.commentSampling ?? (context.commentsComplete ? "all" : "first"), context.commentsComplete,
    [...(pulls?.items ?? [])].sort((a, b) => a.number - b.number).map((pull) => [pull.number, pull.title, pull.bodyExcerpt, pull.bodyTruncated, pull.state, pull.draft, pull.merged, pull.mergedAt, pull.mergeCommitSha, pull.updatedAt]),
    [...(pulls?.notFoundNumbers ?? [])].sort((a, b) => a - b), pulls?.omitted ?? 0,
  ])).digest("hex");
}
const discussionError = (context: IssueContext) => [context.commentsError, ...(context.referencedPullRequests?.errors.map((item) => `PR #${item.number}: ${item.message}`) ?? [])].filter(Boolean).join("; ") || null;
export type OpportunityStatus = "candidate" | "saved" | "validating" | "validated" | "dismissed";
export type OpportunityRecordStatus = Exclude<OpportunityStatus, "validated"> | "completed";
export type ValidationStepProgress = { index: number; step: string; status: "completed" | "skipped"; note: string; updatedAt: string };
export type OpportunityRecord = OpportunityDraft & { status: OpportunityRecordStatus; marketStatus: "unvalidated" | "evidence_recorded"; validationRecord: ValidationRecord | null; validationRecords: ValidationRecord[]; validationProgress?: ValidationStepProgress[]; createdAt: string; supersededAt?: string | null };
export type AnalysisRun = { modelsUsed?: string[]; id: string; model: string; status: "running" | "succeeded" | "failed"; startedAt: string; finishedAt: string | null; error: string | null; opportunities: number; rejected: number; usage: ModelAnalysisResult["usage"] | null; decisions: NonNullable<ModelAnalysisResult["decisions"]>; analyzedProjects: NonNullable<ModelAnalysisResult["analyzedProjects"]>; promptVersion: string | null; selection?: ModelAnalysisResult["selection"] | null; focus?: ResearchFocus | null; researchProfile?: ResearchProfile | null; reusedFrom?: string | null; candidateAudits?: ModelAnalysisResult["candidateAudits"] | null };

const DEFAULT_SETTINGS: AppSettings = {
  searchQuery: "topic:ai-agent language:TypeScript",
  createdWithinDays: 90,
  maxResults: 32,
  scanIntervalHours: 24,
  discoveryMode: "balanced",
  researchProfile: null,
};

function json<T>(value: SQLOutputValue | undefined, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export class RadarStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate() {
    let version = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version < 1) {
      this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','partial','failed')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        found INTEGER NOT NULL DEFAULT 0,
        inserted INTEGER NOT NULL DEFAULT 0,
        duplicates INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        warnings_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS raw_events (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        external_id TEXT NOT NULL,
        url TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE (source_type, external_id, content_hash)
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        repository_id INTEGER NOT NULL UNIQUE,
        full_name TEXT NOT NULL UNIQUE,
        description TEXT,
        language TEXT,
        license TEXT,
        stars INTEGER NOT NULL,
        forks INTEGER NOT NULL,
        open_issues INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        pushed_at TEXT,
        url TEXT NOT NULL,
        readme_excerpt TEXT,
        release_tag TEXT,
        release_url TEXT,
        score INTEGER NOT NULL,
        score_reasons_json TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        observed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS projects_observed_score_idx ON projects(score DESC, observed_at DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS project_search USING fts5(project_id UNINDEXED, full_name, description, readme_excerpt);
      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        external_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        emitted_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        processing_state TEXT NOT NULL DEFAULT 'processed',
        UNIQUE (source_type, external_id, event_type)
      );
      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        combination_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        target_user TEXT NOT NULL,
        job_to_be_done TEXT NOT NULL,
        hypothesis TEXT NOT NULL,
        project_ids_json TEXT NOT NULL,
        project_names_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('candidate','saved','validating','validated','dismissed')),
        score INTEGER NOT NULL,
        market_status TEXT NOT NULL CHECK (market_status IN ('unvalidated','validated')),
        supporting_evidence_json TEXT NOT NULL,
        counter_evidence_json TEXT NOT NULL,
        validation_steps_json TEXT NOT NULL,
        success_metric TEXT NOT NULL,
        failure_metric TEXT NOT NULL,
        validation_record_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS opportunities_status_score_idx ON opportunities(status, score DESC);
      PRAGMA user_version = 1;
        COMMIT;
      `);
      this.db.prepare("INSERT OR IGNORE INTO app_settings(key,value_json,updated_at) VALUES (?,?,?)").run("collector", JSON.stringify(DEFAULT_SETTINGS), new Date().toISOString());
      version = 1;
    }
    if (version < 2) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE opportunities ADD COLUMN analysis_version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE opportunities ADD COLUMN superseded_at TEXT;
        CREATE INDEX IF NOT EXISTS opportunities_analysis_version_idx ON opportunities(analysis_version,status,score DESC);
        PRAGMA user_version = 2;
        COMMIT;
      `);
    }
    if (version < 3) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE projects ADD COLUMN first_seen_at TEXT;
        UPDATE projects
        SET first_seen_at = (
          SELECT MIN(raw_events.fetched_at)
          FROM raw_events
          WHERE raw_events.source_type = 'github'
            AND raw_events.external_id LIKE CAST(projects.repository_id AS TEXT) || ':%'
        );
        PRAGMA user_version = 3;
        COMMIT;
      `);
    }
    if (version < 4) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE analysis_runs (
          id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, model TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
          started_at TEXT NOT NULL, finished_at TEXT, result_json TEXT, error TEXT
        );
        CREATE INDEX analysis_runs_cache_idx ON analysis_runs(input_hash,status);
        PRAGMA user_version = 4;
        COMMIT;
      `);
    }
    if (version < 5) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE projects ADD COLUMN issues_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE projects ADD COLUMN issues_fetched_at TEXT;
        ALTER TABLE projects ADD COLUMN discovery_channels_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE opportunities ADD COLUMN analysis_details_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE job_runs ADD COLUMN discovery_json TEXT NOT NULL DEFAULT '[]';
        CREATE TABLE project_observations (
          project_id TEXT NOT NULL REFERENCES projects(id), observed_at TEXT NOT NULL,
          stars INTEGER NOT NULL, forks INTEGER NOT NULL, open_issues INTEGER NOT NULL,
          release_tag TEXT, PRIMARY KEY(project_id, observed_at)
        );
        INSERT INTO project_observations SELECT id,observed_at,stars,forks,open_issues,release_tag FROM projects;
        PRAGMA user_version = 5;
        COMMIT;
      `);
    }
    if (version < 6) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE analysis_runs ADD COLUMN usage_json TEXT;
        PRAGMA user_version = 6;
        COMMIT;
      `);
    }
    if (version < 7) {
      this.db.exec("BEGIN IMMEDIATE; ALTER TABLE projects ADD COLUMN documentation_json TEXT; PRAGMA user_version = 7; COMMIT;");
    }
    if (version < 8) {
      this.db.exec("BEGIN IMMEDIATE; ALTER TABLE analysis_runs ADD COLUMN request_json TEXT; ALTER TABLE opportunities ADD COLUMN research_scope TEXT NOT NULL DEFAULT 'discovery'; PRAGMA user_version = 8; COMMIT;");
    }
    if (version < 9) {
      this.db.exec("BEGIN IMMEDIATE; ALTER TABLE projects ADD COLUMN issue_contexts_json TEXT NOT NULL DEFAULT '{}'; PRAGMA user_version = 9; COMMIT;");
    }
    if (version < 10) {
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE research_notes (
          id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, request_json TEXT NOT NULL,
          created_at TEXT NOT NULL, supersedes_id TEXT UNIQUE REFERENCES research_notes(id), payload_json TEXT NOT NULL
        );
        CREATE INDEX research_notes_created_idx ON research_notes(created_at DESC);
        PRAGMA user_version = 10; COMMIT;`);
    }
    if (version < 11) {
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE project_monitors (
          project_id TEXT PRIMARY KEY REFERENCES projects(id), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
          enabled_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','succeeded','partial','failed')),
          last_attempt_at TEXT, last_finished_at TEXT, last_success_at TEXT, next_due_at TEXT NOT NULL,
          error TEXT, error_code TEXT, warning TEXT, changes_json TEXT
        );
        CREATE INDEX project_monitors_due_idx ON project_monitors(enabled,next_due_at);
        PRAGMA user_version = 11; COMMIT;`);
    }
    if (version < 12) {
      this.db.exec("BEGIN IMMEDIATE; ALTER TABLE project_monitors ADD COLUMN issues_json TEXT NOT NULL DEFAULT '[]'; PRAGMA user_version = 12; COMMIT;");
    }
    if (version < 13) {
      this.db.exec("BEGIN IMMEDIATE; ALTER TABLE opportunities ADD COLUMN validation_progress_json TEXT NOT NULL DEFAULT '[]'; PRAGMA user_version = 13; COMMIT;");
    }
    if (version < 14) {
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE demand_runs (
          id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, question TEXT NOT NULL, retry_of TEXT REFERENCES demand_runs(id),
          status TEXT NOT NULL CHECK(status IN ('running','succeeded','partial','failed','interrupted')),
          started_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT, error TEXT, snapshot_json TEXT
        );
        CREATE INDEX demand_runs_started ON demand_runs(started_at);
        PRAGMA user_version = 14; COMMIT;`);
    }
    if (version < 15) {
      this.db.exec("BEGIN IMMEDIATE; ALTER TABLE demand_runs ADD COLUMN continuation_of TEXT REFERENCES demand_runs(id); ALTER TABLE demand_runs ADD COLUMN continuation_json TEXT; PRAGMA user_version = 15; COMMIT;");
    }
    if (version < 16) {
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS task_measurements (
          id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, request_json TEXT NOT NULL, created_at TEXT NOT NULL,
          origin_demand_id TEXT, payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS task_measurements_created_idx ON task_measurements(created_at DESC);
        PRAGMA user_version = 16; COMMIT;`);
    }
  }

  getDemandRun(id: string): DemandRun | null {
    const row = this.db.prepare("SELECT * FROM demand_runs WHERE id=?").get(id);
    return row ? { id: String(row.id), requestId: String(row.request_id), question: String(row.question), retryOf: row.retry_of as string | null, continuationOf: row.continuation_of as string | null, continuationInput: json<DemandRun["continuationInput"]>(row.continuation_json, null), status: row.status as DemandRun["status"], startedAt: String(row.started_at), updatedAt: String(row.updated_at), finishedAt: row.finished_at as string | null, error: row.error as string | null, snapshot: json<DemandSnapshot | null>(row.snapshot_json, null) } : null;
  }

  listDemandRuns(limit = 30): DemandRun[] {
    return (this.db.prepare("SELECT id FROM demand_runs ORDER BY started_at DESC,rowid DESC LIMIT ?").all(Math.max(1, Math.min(limit, 100))) as Array<{ id: string }>).map(row => this.getDemandRun(row.id)!);
  }

  demandRunForRequest(requestId: string, question: string, retryOf: string | null) {
    const row = this.db.prepare("SELECT id,question,retry_of,continuation_of FROM demand_runs WHERE request_id=?").get(requestId);
    if (!row) return null;
    if (row.question !== question || row.retry_of !== retryOf || row.continuation_of !== null) throw new Error("demand_request_conflict");
    return this.getDemandRun(String(row.id));
  }

  createDemandRun(requestId: string, question: string, retryOf: string | null): DemandRun {
    const existing = this.demandRunForRequest(requestId, question, retryOf);
    if (existing) return existing;
    if (retryOf && !this.getDemandRun(retryOf)) throw new Error("unknown_demand_parent");
    const id = randomUUID(), now = new Date().toISOString();
    this.db.prepare("INSERT INTO demand_runs(id,request_id,question,retry_of,status,started_at,updated_at) VALUES (?,?,?,?,'running',?,?)").run(id, requestId, question, retryOf, now, now);
    return this.getDemandRun(id)!;
  }

  sourceDemandForRequest(requestId: string, parentId: string, input: NonNullable<DemandRun["continuationInput"]>, retryOf: string | null = null) {
    const existing = this.db.prepare("SELECT id,continuation_of,continuation_json,retry_of FROM demand_runs WHERE request_id=?").get(requestId);
    if (!existing) return null;
    if (existing.continuation_of !== parentId || existing.continuation_json !== sourceStudyKey(input) || existing.retry_of !== retryOf) throw new Error("demand_request_conflict");
    return this.getDemandRun(String(existing.id));
  }

  createSourceDemandRun(requestId: string, parentId: string, input: NonNullable<DemandRun["continuationInput"]>, retryOf: string | null = null): DemandRun {
    const previous = this.sourceDemandForRequest(requestId, parentId, input, retryOf);
    if (previous) return previous;
    const parent = this.getDemandRun(parentId);
    if (!parent || parent.status === "running" || parent.continuationOf) throw new Error("invalid_source_parent");
    if (retryOf) {
      const saved = this.getDemandRun(retryOf);
      if (!saved || !["failed", "interrupted"].includes(saved.status) || saved.continuationOf !== parentId
        || !saved.continuationInput || sourceStudyKey(saved.continuationInput) !== sourceStudyKey(input)) throw new Error("invalid_source_retry");
    }
    const id = randomUUID(), now = new Date().toISOString();
    this.db.prepare("INSERT INTO demand_runs(id,request_id,question,continuation_of,continuation_json,retry_of,status,started_at,updated_at) VALUES (?,?,?,?,?,?,'running',?,?)")
      .run(id, requestId, parent.question, parentId, sourceStudyKey(input), retryOf, now, now);
    return this.getDemandRun(id)!;
  }

  checkpointDemandRun(id: string, snapshot: DemandSnapshot) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE demand_runs SET status=?,updated_at=?,finished_at=?,error=?,snapshot_json=? WHERE id=? AND status='running'")
      .run(snapshot.status, now, snapshot.status === "running" ? null : now, snapshot.error, JSON.stringify(snapshot), id);
  }

  failDemandRun(id: string, error: string) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE demand_runs SET status='failed',updated_at=?,finished_at=?,error=? WHERE id=? AND status='running'").run(now, now, error, id);
  }

  getProjectMonitor(id: string): ProjectMonitor | null {
    const row = this.db.prepare("SELECT m.*,p.full_name FROM project_monitors m JOIN projects p ON p.id=m.project_id WHERE m.project_id=?").get(id);
    return row ? { projectId: String(row.project_id), fullName: String(row.full_name), enabled: row.enabled === 1, enabledAt: String(row.enabled_at), status: row.status as ProjectMonitor["status"], lastAttemptAt: row.last_attempt_at as string | null, lastFinishedAt: row.last_finished_at as string | null, lastSuccessAt: row.last_success_at as string | null, nextDueAt: String(row.next_due_at), error: row.error as string | null, errorCode: row.error_code as string | null, warning: row.warning as string | null, changes: json<MonitorChanges | null>(row.changes_json, null), issues: json<MonitoredIssue[]>(row.issues_json, []) } : null;
  }

  setMonitoredIssue(id: string, number: number, enabled: boolean, now: string) {
    const project = this.getProject(id);
    if (!project) throw new Error("unknown_monitor_project");
    const monitor = this.getProjectMonitor(id);
    const issues = monitor?.issues ?? [], existing = issues.find((item) => item.number === number);
    if (enabled && !project.issues?.some((issue) => issue.number === number)) throw new Error("unknown_monitor_issue");
    if (enabled && !existing && issues.length >= 3) throw new Error("monitor_issue_limit");
    if (enabled && existing) return monitor!;
    const context = project.issueContexts?.[String(number)];
    const sample = project.issues?.find((issue) => issue.number === number);
    const baseline = context && !discussionError(context) && !issueContextOutdated(context, sample?.updatedAt ?? context.issue.updatedAt) ? context : null;
    const next = enabled ? [...issues, { id: randomUUID(), number, title: sample!.title, status: "pending" as const, lastCheckedAt: null, lastSuccessAt: null, error: null, fingerprint: baseline ? discussionFingerprint(baseline) : null, previousState: baseline?.issue.state ?? null, previousComments: baseline?.issue.comments ?? null, changeId: null, changedAt: null, unreadChange: false, changeDescription: null }] : issues.filter((item) => item.number !== number);
    this.db.prepare("INSERT OR IGNORE INTO project_monitors(project_id,enabled,enabled_at,next_due_at) VALUES (?,0,?,?)").run(id, now, now);
    // Adding a discussion schedules it promptly but never enables the project or bypasses a rate-limit pause.
    const due = enabled && monitor?.enabled && monitor.status !== "running" && !(monitor.errorCode === "rate_limited" && monitor.nextDueAt > now) ? now : monitor?.nextDueAt ?? now;
    this.db.prepare("UPDATE project_monitors SET issues_json=?,next_due_at=? WHERE project_id=?").run(JSON.stringify(next), due, id);
    return this.getProjectMonitor(id)!;
  }

  recordMonitoredIssueCheck(id: string, subscriptionId: string, checkedAt: string, result: { context?: IssueContext; error?: string }) {
    const monitor = this.getProjectMonitor(id);
    if (!monitor) return;
    const issues = monitor.issues.map((item): MonitoredIssue => {
      if (item.id !== subscriptionId) return item; // A cancelled/re-added subscription is a different request.
      const context = result.context, error = result.error ?? (context ? discussionError(context) : "未取得讨论");
      if (error) return { ...item, status: context ? "partial" : "failed", lastCheckedAt: checkedAt, error };
      if (!context) return item;
      const fingerprint = discussionFingerprint(context), changed = Boolean(item.fingerprint && fingerprint !== item.fingerprint);
      const parts: string[] = [];
      if (changed && item.previousState !== context.issue.state) parts.push(`状态 ${item.previousState} → ${context.issue.state}`);
      if (changed && item.previousComments !== context.issue.comments) parts.push(`评论数 ${item.previousComments} → ${context.issue.comments}`);
      return { ...item, title: context.issue.title, status: changed ? "changed" : item.fingerprint ? "unchanged" : "baseline", lastCheckedAt: checkedAt, lastSuccessAt: checkedAt, error: null, fingerprint, previousState: context.issue.state, previousComments: context.issue.comments,
        ...(changed ? { changeId: randomUUID(), changedAt: checkedAt, unreadChange: true, changeDescription: parts.join("；") || "讨论正文、采样评论、PR 或更新时间有变化" } : {}) };
    });
    this.db.prepare("UPDATE project_monitors SET issues_json=? WHERE project_id=?").run(JSON.stringify(issues), id);
  }

  acknowledgeMonitoredIssue(id: string, number: number, changeId: string) {
    const monitor = this.getProjectMonitor(id), item = monitor?.issues.find((issue) => issue.number === number);
    if (!item) throw new Error("unknown_monitor_issue");
    if (item.changeId !== changeId) throw new Error("monitor_change_conflict");
    this.db.prepare("UPDATE project_monitors SET issues_json=? WHERE project_id=?").run(JSON.stringify(monitor!.issues.map((issue) => issue.number === number ? { ...issue, unreadChange: false } : issue)), id);
    return this.getProjectMonitor(id)!;
  }

  listProjectMonitors() {
    return (this.db.prepare("SELECT project_id FROM project_monitors WHERE enabled=1 ORDER BY enabled_at,project_id").all() as { project_id: string }[]).map((row) => this.getProjectMonitor(row.project_id)!);
  }

  listMonitorIssueChanges() {
    return (this.db.prepare("SELECT project_id FROM project_monitors WHERE issues_json!='[]'").all() as { project_id: string }[]).flatMap((row) => {
      const monitor = this.getProjectMonitor(row.project_id)!;
      return monitor.issues.filter((issue) => issue.unreadChange).map((issue) => ({ ...issue, projectId: monitor.projectId, fullName: monitor.fullName, enabled: monitor.enabled }));
    }).sort((a, b) => (b.changedAt ?? "").localeCompare(a.changedAt ?? ""));
  }

  setProjectMonitor(id: string, enabled: boolean, now: string, limit = 20) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.db.prepare("SELECT 1 FROM projects WHERE id=?").get(id)) throw new Error("unknown_monitor_project");
      const previous = this.getProjectMonitor(id);
      const nextDueAt = previous?.errorCode === "rate_limited" && Date.parse(previous.nextDueAt) > Date.parse(now) ? previous.nextDueAt : now;
      if (enabled && !previous?.enabled && this.listProjectMonitors().length >= limit) throw new Error("monitor_limit");
      this.db.prepare("INSERT OR IGNORE INTO project_monitors(project_id,enabled,enabled_at,next_due_at) VALUES (?,?,?,?)").run(id, enabled ? 1 : 0, now, now);
      if (previous?.enabled !== enabled) this.db.prepare("UPDATE project_monitors SET enabled=?,enabled_at=CASE WHEN ?=1 THEN ? ELSE enabled_at END,next_due_at=CASE WHEN ?=1 THEN ? ELSE next_due_at END WHERE project_id=?").run(enabled ? 1 : 0, enabled ? 1 : 0, now, enabled ? 1 : 0, nextDueAt, id);
      this.db.exec("COMMIT");
      return this.getProjectMonitor(id)!;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  dueProjectMonitors(now: string, limit = 2) {
    return (this.db.prepare("SELECT project_id FROM project_monitors WHERE enabled=1 AND status!='running' AND next_due_at<=? ORDER BY next_due_at,project_id LIMIT ?").all(now, limit) as { project_id: string }[]).map((row) => this.getProjectMonitor(row.project_id)!);
  }

  monitoringPausedUntil(now: string) {
    const row = this.db.prepare("SELECT MAX(next_due_at) AS until FROM project_monitors WHERE error_code='rate_limited' AND status='failed' AND next_due_at>?").get(now);
    return typeof row?.until === "string" ? row.until : null;
  }

  beginMonitorAttempt(id: string, now: string, nextDueAt: string) {
    this.db.prepare("INSERT OR IGNORE INTO project_monitors(project_id,enabled,enabled_at,next_due_at) VALUES (?,0,?,?)").run(id, now, nextDueAt);
    this.db.prepare("UPDATE project_monitors SET status='running',last_attempt_at=?,next_due_at=?,error=NULL,error_code=NULL,warning=NULL WHERE project_id=?").run(now, nextDueAt, id);
  }

  finishMonitorAttempt(id: string, result: { status: "succeeded" | "partial" | "failed"; finishedAt: string; nextDueAt: string; error?: string | null; errorCode?: string | null; warning?: string | null; changes?: MonitorChanges }) {
    this.db.prepare("UPDATE project_monitors SET status=?,last_finished_at=?,last_success_at=CASE WHEN ?!='failed' THEN ? ELSE last_success_at END,next_due_at=?,error=?,error_code=?,warning=?,changes_json=COALESCE(?,changes_json) WHERE project_id=?").run(result.status, result.finishedAt, result.status, result.finishedAt, result.nextDueAt, result.error ?? null, result.errorCode ?? null, result.warning ?? null, result.changes ? JSON.stringify(result.changes) : null, id);
    return this.getProjectMonitor(id)!;
  }

  recoverInterruptedMonitors(now: string) {
    const retry = new Date(Date.parse(now) + 60_000).toISOString();
    this.db.prepare("UPDATE project_monitors SET status='failed',last_finished_at=?,next_due_at=?,error='上次刷新因服务重启中断，既有资料保留',error_code='interrupted' WHERE status='running'").run(now, retry);
  }

  getTaskMeasurement(id: string): TaskMeasurement | null {
    const row = this.db.prepare("SELECT payload_json FROM task_measurements WHERE id=?").get(id);
    return row ? JSON.parse(String(row.payload_json)) as TaskMeasurement : null;
  }

  listTaskMeasurements(limit = 100): TaskMeasurement[] {
    return (this.db.prepare("SELECT id FROM task_measurements ORDER BY created_at DESC,rowid DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 100)) as { id: string }[])
      .map(({ id }) => this.getTaskMeasurement(id)!).filter(Boolean);
  }

  taskMeasurementForRequest(requestId: string, requestJson: string) {
    const row = this.db.prepare("SELECT id,request_json FROM task_measurements WHERE request_id=?").get(requestId) as { id: string; request_json: string } | undefined;
    if (!row) return null;
    if (row.request_json !== requestJson) throw new Error("task_measurement_request_conflict");
    const saved = this.getTaskMeasurement(String(row.id));
    if (!saved) throw new Error("task_measurement_request_conflict");
    return saved;
  }

  saveTaskMeasurement(measurement: TaskMeasurement, requestId: string, requestJson: string) {
    const existing = this.db.prepare("SELECT id FROM task_measurements WHERE request_id=?").get(requestId) as { id: string } | undefined;
    if (existing) {
      const row = this.db.prepare("SELECT request_json FROM task_measurements WHERE id=?").get(existing.id) as { request_json: string } | undefined;
      const saved = this.getTaskMeasurement(existing.id);
      if (!row || row.request_json !== requestJson || !saved) throw new Error("task_measurement_request_conflict");
      return saved;
    }
    this.db.prepare("INSERT INTO task_measurements(id,request_id,request_json,created_at,origin_demand_id,payload_json) VALUES (?,?,?,?,?,?)")
      .run(measurement.id, requestId, requestJson, measurement.createdAt, measurement.originDemandId, JSON.stringify(measurement));
    return measurement;
  }

  getResearchNote(id: string): (ResearchNote & { supersededBy: string | null }) | null {
    const row = this.db.prepare("SELECT payload_json,(SELECT id FROM research_notes next WHERE next.supersedes_id=research_notes.id) AS superseded_by FROM research_notes WHERE id=?").get(id);
    return row ? { ...JSON.parse(String(row.payload_json)) as ResearchNote, supersededBy: row.superseded_by as string | null } : null;
  }

  listResearchNotes(limit = 100) {
    return (this.db.prepare("SELECT id FROM research_notes ORDER BY created_at DESC,rowid DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 100)) as { id: string }[]).map(({ id }) => this.getResearchNote(id)!);
  }

  listResearchNotesForProjects(projectIds: string[], limit = 100) {
    const wanted = new Set(projectIds);
    if (!wanted.size) return [];
    return this.listResearchNotes(limit).filter((note) => note.projectIds.some((projectId) => wanted.has(projectId)));
  }

  researchNoteForRequest(requestId: string, requestJson: string) {
    const row = this.db.prepare("SELECT id,request_json FROM research_notes WHERE request_id=?").get(requestId);
    if (!row) return null;
    if (row.request_json !== requestJson) throw new Error("research_request_conflict");
    return this.getResearchNote(String(row.id));
  }

  saveResearchNote(note: ResearchNote, requestId: string, requestJson: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.researchNoteForRequest(requestId, requestJson);
      if (previous) { this.db.exec("COMMIT"); return previous; }
      if (note.supersedesId) {
        const original = this.getResearchNote(note.supersedesId);
        if (!original || original.supersededBy) throw new Error("research_revision_conflict");
      }
      this.db.prepare("INSERT INTO research_notes(id,request_id,request_json,created_at,supersedes_id,payload_json) VALUES (?,?,?,?,?,?)").run(note.id, requestId, requestJson, note.createdAt, note.supersedesId, JSON.stringify(note));
      this.db.exec("COMMIT");
      return this.getResearchNote(note.id)!;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  getSettings(): AppSettings {
    const row = this.db.prepare("SELECT value_json FROM app_settings WHERE key = ?").get("collector") as { value_json: string } | undefined;
    const settings = { ...DEFAULT_SETTINGS, ...json<Partial<AppSettings>>(row?.value_json, {}) };
    return { ...settings, researchProfile: canonicalResearchProfile(settings.researchProfile) };
  }

  recordDiscovery(id: string, tracks: DiscoveryTrack[]) {
    this.db.prepare("UPDATE job_runs SET discovery_json=? WHERE id=?").run(JSON.stringify(tracks), id);
  }

  getDiscoveryProgress(): DiscoveryProgress {
    const row = this.db.prepare("SELECT value_json FROM app_settings WHERE key=?").get("discovery-progress");
    return json<DiscoveryProgress>(row?.value_json, {});
  }

  completeDiscovery(id: string, tracks: DiscoveryTrack[]) {
    // Call only after the repository evidence has been saved. A crash before this checkpoint retries the page.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT discovery_json FROM job_runs WHERE id=?").get(id);
      if (!row) throw new Error("Unknown discovery run");
      const recorded = json<DiscoveryTrack[]>(row.discovery_json, []);
      if (recorded.some((track) => track.searchComplete !== undefined)) { this.db.exec("COMMIT"); return; }
      this.recordDiscovery(id, tracks);
      const progress = advanceDiscoveryProgress(this.getDiscoveryProgress(), tracks);
      this.db.prepare("INSERT INTO app_settings(key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
        .run("discovery-progress", JSON.stringify(progress), new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  updateSettings(settings: AppSettings) {
    settings = { ...settings, researchProfile: settings.researchProfile === undefined ? this.getSettings().researchProfile ?? null : canonicalResearchProfile(settings.researchProfile) };
    this.db.prepare("INSERT INTO app_settings(key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
      .run("collector", JSON.stringify(settings), new Date().toISOString());
    for (const item of this.listProjectMonitors()) {
      if (item.status === "succeeded" && item.lastSuccessAt) {
        this.db.prepare("UPDATE project_monitors SET next_due_at=? WHERE project_id=?").run(new Date(Date.parse(item.lastSuccessAt) + settings.scanIntervalHours * 3_600_000).toISOString(), item.projectId);
      }
    }
    return settings;
  }

  getCachedModelAnalysis(inputHash: string): ModelAnalysisResult | null {
    return this.findCachedModelAnalysis(inputHash)?.result ?? null;
  }

  findCachedModelAnalysis(inputHash: string): { runId: string; result: ModelAnalysisResult } | null {
    const row = this.db.prepare("SELECT id,result_json FROM analysis_runs WHERE input_hash=? AND status='succeeded' ORDER BY finished_at DESC LIMIT 1").get(inputHash) as { id: string; result_json: string } | undefined;
    const result = json<ModelAnalysisResult | null>(row?.result_json, null);
    return row && result ? { runId: row.id, result } : null;
  }

  getAnalysisResult(id: string): ModelAnalysisResult | null {
    const row = this.db.prepare("SELECT result_json FROM analysis_runs WHERE id=? AND status='succeeded'").get(id) as { result_json: string } | undefined;
    return json<ModelAnalysisResult | null>(row?.result_json, null);
  }

  recoverInterruptedRuns() {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE demand_runs SET status='interrupted',updated_at=?,finished_at=?,error='服务重启使研究中断，已采集材料保留；请显式重试' WHERE status='running'").run(now, now);
    this.db.prepare("UPDATE analysis_runs SET status='failed',finished_at=?,error='Service restarted before analysis completed; retry manually' WHERE status='running'").run(now);
    this.db.prepare("UPDATE job_runs SET status='failed',finished_at=?,error='Service restarted before scan completed; retry manually' WHERE status IN ('queued','running')").run(now);
  }

  createAnalysisRun(inputHash: string, model: string, focus?: ResearchFocus | null, researchProfile?: ResearchProfile | null) {
    const id = randomUUID();
    const request = focus || researchProfile ? { ...(focus ? { focus } : {}), ...(researchProfile ? { researchProfile } : {}) } : null;
    this.db.prepare("INSERT INTO analysis_runs(id,input_hash,model,status,started_at,request_json) VALUES (?,?,?,'running',?,?)").run(id, inputHash, model, new Date().toISOString(), request ? JSON.stringify(request) : null);
    return id;
  }

  finishAnalysisRun(id: string, result: ModelAnalysisResult) {
    this.db.prepare("UPDATE analysis_runs SET status='succeeded',finished_at=?,result_json=?,usage_json=? WHERE id=?").run(new Date().toISOString(), JSON.stringify(result), result.usage ? JSON.stringify(result.usage) : null, id);
  }

  checkpointAnalysisRun(id: string, snapshot: ModelAnalysisResult) {
    // usage_json is updated independently as each request starts/finishes.
    this.db.prepare("UPDATE analysis_runs SET result_json=? WHERE id=? AND status='running'").run(JSON.stringify({ ...snapshot, drafts: [], usage: null }), id);
  }

  updateAnalysisUsage(id: string, usage: ModelUsage) {
    this.db.prepare("UPDATE analysis_runs SET usage_json=? WHERE id=?").run(JSON.stringify(usage), id);
  }

  failAnalysisRun(id: string, message: string) {
    this.db.prepare("UPDATE analysis_runs SET status='failed',finished_at=?,error=? WHERE id=?").run(new Date().toISOString(), message, id);
  }

  listAnalysisRuns(limit = 20): AnalysisRun[] {
    const rows = this.db.prepare("SELECT * FROM analysis_runs ORDER BY started_at DESC LIMIT ?").all(limit) as Record<string, SQLOutputValue>[];
    return rows.map((row) => this.mapAnalysisRun(row));
  }

  getAnalysisRun(id: string): AnalysisRun | null {
    const row = this.db.prepare("SELECT * FROM analysis_runs WHERE id=?").get(id) as Record<string, SQLOutputValue> | undefined;
    return row ? this.mapAnalysisRun(row) : null;
  }

  private mapAnalysisRun(row: Record<string, SQLOutputValue>): AnalysisRun {
    const result = json<ModelAnalysisResult | null>(row.result_json, null);
    const recordedUsage = json<ModelUsage | null>(row.usage_json, null) ?? result?.usage;
    const usage = recordedUsage ? { ...recordedUsage, complete: recordedUsage.complete === true } : null;
    const request = json<{ focus?: ResearchFocus; researchProfile?: ResearchProfile } | null>(row.request_json, null);
    return { id: String(row.id), model: String(row.model), modelsUsed: result?.modelsUsed ?? [], status: String(row.status) as AnalysisRun["status"], startedAt: String(row.started_at), finishedAt: typeof row.finished_at === "string" ? row.finished_at : null, error: typeof row.error === "string" ? row.error : null, opportunities: result?.drafts.length ?? 0, rejected: result?.rejected ?? 0, usage, decisions: result?.decisions ?? [], analyzedProjects: result?.analyzedProjects ?? [], promptVersion: result?.promptVersion ?? null, selection: result?.selection ?? null, focus: result?.focus ?? request?.focus ?? null, researchProfile: result?.researchProfile ?? request?.researchProfile ?? null, reusedFrom: result?.reusedFrom ?? null, candidateAudits: result?.candidateAudits ?? null };
  }

  createScanRun() {
    const run: ScanRun = { id: randomUUID(), status: "running", startedAt: new Date().toISOString(), finishedAt: null, found: 0, inserted: 0, duplicates: 0, error: null, warnings: [] };
    this.db.prepare("INSERT INTO job_runs(id,status,started_at) VALUES (?,?,?)").run(run.id, run.status, run.startedAt);
    return run;
  }

  finishScanRun(run: ScanRun, updates: Pick<ScanRun, "status" | "found" | "inserted" | "duplicates" | "error">, warnings: string[] = []) {
    const finishedAt = new Date().toISOString();
    this.db.prepare("UPDATE job_runs SET status=?,finished_at=?,found=?,inserted=?,duplicates=?,error=?,warnings_json=? WHERE id=?")
      .run(updates.status, finishedAt, updates.found, updates.inserted, updates.duplicates, updates.error, JSON.stringify(warnings), run.id);
    return this.getScanRun(run.id);
  }

  getScanRun(id: string): ScanRun | null {
    const row = this.db.prepare("SELECT * FROM job_runs WHERE id=?").get(id) as Record<string, SQLOutputValue> | undefined;
    return row ? this.mapRun(row) : null;
  }

  listScanRuns(limit = 30) {
    return (this.db.prepare("SELECT * FROM job_runs ORDER BY started_at DESC LIMIT ?").all(limit) as Record<string, SQLOutputValue>[]).map((row) => this.mapRun(row));
  }

  private mapRun(row: Record<string, SQLOutputValue>): ScanRun {
    return {
      id: String(row.id), status: String(row.status) as RunStatus, startedAt: String(row.started_at),
      finishedAt: typeof row.finished_at === "string" ? row.finished_at : null,
      found: Number(row.found), inserted: Number(row.inserted), duplicates: Number(row.duplicates),
      error: typeof row.error === "string" ? row.error : null,
      warnings: json(row.warnings_json, []),
      tracks: json(row.discovery_json, []),
    };
  }

  saveRepository(repository: GitHubRepository, signal: W2ASignal, score: number, scoreReasons: string[], capabilities: string[], observedAt: string) {
    const event = signal.source_event?.data;
    if (!event || typeof event.externalId !== "string") throw new Error("W2A signal is missing a stable external event ID");
    const sourceEventId = event.externalId;
    const contentHash = createHash("sha256").update(JSON.stringify({ raw: repository.raw, readme: repository.readmeExcerpt, release: repository.releaseTag, issues: repository.issues })).digest("hex");
    const id = String(repository.id);
    const readmeAvailable = repository.readmeFetchSucceeded ?? (!repository.warning || repository.readmeExcerpt !== null);
    const releaseAvailable = repository.releaseFetchSucceeded ?? (!repository.warning || repository.releaseTag !== null);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT OR IGNORE INTO raw_events(id,source_type,external_id,url,fetched_at,content_hash,payload_json) VALUES (?,?,?,?,?,?,?)")
        .run(randomUUID(), "github", sourceEventId, repository.url, observedAt, contentHash, JSON.stringify(repository.raw));
      const saved = this.db.prepare(`
        INSERT INTO projects(id,repository_id,full_name,description,language,license,stars,forks,open_issues,created_at,pushed_at,url,readme_excerpt,release_tag,release_url,score,score_reasons_json,capabilities_json,raw_json,observed_at,first_seen_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(repository_id) DO UPDATE SET
          full_name=excluded.full_name,description=excluded.description,language=excluded.language,license=excluded.license,
          stars=excluded.stars,forks=excluded.forks,open_issues=excluded.open_issues,pushed_at=excluded.pushed_at,
          url=excluded.url,
          readme_excerpt=CASE WHEN ? THEN excluded.readme_excerpt ELSE projects.readme_excerpt END,
          release_tag=CASE WHEN ? THEN excluded.release_tag ELSE projects.release_tag END,
          release_url=CASE WHEN ? THEN excluded.release_url ELSE projects.release_url END,
          score=excluded.score,score_reasons_json=excluded.score_reasons_json,capabilities_json=excluded.capabilities_json,
          raw_json=excluded.raw_json,observed_at=excluded.observed_at,
          first_seen_at=COALESCE(projects.first_seen_at,excluded.first_seen_at)
        RETURNING id,readme_excerpt
      `).get(id, repository.id, repository.fullName, repository.description, repository.language, repository.license, repository.stars, repository.forks, repository.openIssues, repository.createdAt, repository.pushedAt, repository.url, repository.readmeExcerpt, repository.releaseTag, repository.releaseUrl, score, JSON.stringify(scoreReasons), JSON.stringify(capabilities), JSON.stringify(repository.raw), observedAt, observedAt, Number(readmeAvailable), Number(releaseAvailable), Number(releaseAvailable)) as { id: string; readme_excerpt: string | null };
      this.db.prepare("DELETE FROM project_search WHERE project_id=?").run(saved.id);
      this.db.prepare("INSERT INTO project_search(project_id,full_name,description,readme_excerpt) VALUES (?,?,?,?)")
        .run(saved.id, repository.fullName, repository.description ?? "", repository.readmeExcerpt ?? saved.readme_excerpt ?? "");
      if (repository.issuesFetchSucceeded) {
        this.db.prepare("UPDATE projects SET issues_json=?,issues_fetched_at=? WHERE id=?").run(JSON.stringify(repository.issues ?? []), repository.issuesFetchedAt ?? observedAt, id);
        const contexts = json<Record<string, IssueContext>>(this.db.prepare("SELECT issue_contexts_json FROM projects WHERE id=?").get(id)?.issue_contexts_json, {});
        let changed = false;
        for (const issue of repository.issues ?? []) {
          const context = contexts[String(issue.number)];
          if (context && Date.parse(issue.updatedAt) > Date.parse(context.newestSampleUpdatedAt ?? context.issue.updatedAt)) {
            context.newestSampleUpdatedAt = issue.updatedAt;
            changed = true;
          }
        }
        if (changed) this.db.prepare("UPDATE projects SET issue_contexts_json=? WHERE id=?").run(JSON.stringify(contexts), id);
      }
      const priorChannels = json<string[]>((this.db.prepare("SELECT discovery_channels_json FROM projects WHERE id=?").get(id) as Record<string, SQLOutputValue>).discovery_channels_json, []);
      this.db.prepare("UPDATE projects SET discovery_channels_json=? WHERE id=?").run(JSON.stringify([...new Set([...priorChannels, ...(repository.discoveryChannels ?? [])])]), id);
      this.db.prepare("INSERT OR IGNORE INTO project_observations(project_id,observed_at,stars,forks,open_issues,release_tag) VALUES (?,?,?,?,?,?)").run(id, observedAt, repository.stars, repository.forks, repository.openIssues, releaseAvailable ? repository.releaseTag : this.getProject(id)?.releaseTag ?? null);
      const signalInsert = this.db.prepare("INSERT OR IGNORE INTO signals(id,source_type,external_id,event_type,occurred_at,emitted_at,payload_json) VALUES (?,?,?,?,?,?,?)")
        .run(signal.signal_id, signal.source.source_type, sourceEventId, signal.event.type, signal.event.occurred_at, signal.emitted_at, JSON.stringify(signal));
      this.db.exec("COMMIT");
      return { id: saved.id, signalInserted: Number(signalInsert.changes) > 0 };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getProjects(limit = 100): ProjectRecord[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY first_seen_at DESC,full_name ASC LIMIT ?").all(limit) as Record<string, SQLOutputValue>[];
    return rows.map((row) => this.mapProject(row));
  }

  searchProjects(query: string, limit = 30, options: ProjectSearchOptions = {}): ProjectSearchResult[] {
    return this.searchProjectsDetailed(query, limit, options).items;
  }

  searchProjectsDetailed(query: string, limit = 30, options: ProjectSearchOptions = {}): ProjectSearchDetailedResult {
    const normalized = query.trim();
    if (!normalized) throw new Error("project_search_query_required");
    if (normalized.length > 256) throw new Error("project_search_query_too_long");
    const tokens: string[] = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (tokens.length === 0) throw new Error("project_search_query_invalid");
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const queryRows = (searchTokens: string[], rowLimit: number): Record<string, SQLOutputValue>[] => {
      // Every token is quoted before it reaches FTS5. This keeps user input from
      // becoming an FTS expression (NEAR, NOT, column selectors, etc.).
      const matchQuery = searchTokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" AND ");
      try {
        return this.db.prepare(`
          SELECT p.* FROM project_search AS s
          JOIN projects AS p ON p.id = s.project_id
          WHERE s.project_search MATCH ?
          ORDER BY bm25(s), p.observed_at DESC, p.full_name ASC
          LIMIT ?
        `).all(matchQuery, rowLimit) as Record<string, SQLOutputValue>[];
      } catch {
        // A damaged/older FTS index must not make cached evidence unavailable.
        const clauses = searchTokens.map(() => "(lower(full_name) LIKE ? OR lower(COALESCE(description,'')) LIKE ? OR lower(COALESCE(readme_excerpt,'')) LIKE ?)").join(" AND ");
        const args = searchTokens.flatMap((token) => { const like = `%${token.toLowerCase()}%`; return [like, like, like]; });
        return this.db.prepare(`SELECT * FROM projects WHERE ${clauses} ORDER BY observed_at DESC,full_name ASC LIMIT ?`).all(...args, rowLimit) as Record<string, SQLOutputValue>[];
      }
    };

    let rows = queryRows(tokens, safeLimit);
    let evidenceTokens = tokens;
    let expandedQueries: string[] = [];
    if (rows.length === 0 && options.expandOnEmpty && tokens.length > 1) {
      const expansionTokens = [...new Set(tokens.filter((token) => token.length >= 3))].slice(0, 2);
      const merged = new Map<string, { row: Record<string, SQLOutputValue>; hits: number }>();
      for (const token of expansionTokens) {
        for (const row of queryRows([token], safeLimit)) {
          const id = String(row.id);
          const prior = merged.get(id);
          if (prior) prior.hits += 1;
          else merged.set(id, { row, hits: 1 });
        }
      }
      rows = [...merged.values()]
        .sort((a, b) => b.hits - a.hits || String(b.row.observed_at).localeCompare(String(a.row.observed_at)) || String(a.row.full_name).localeCompare(String(b.row.full_name)))
        .slice(0, safeLimit)
        .map((entry) => entry.row);
      if (rows.length > 0) {
        evidenceTokens = expansionTokens;
        expandedQueries = expansionTokens;
      }
    }

    const items = rows.map((row) => {
      const project = this.mapProject(row);
      const fields: ProjectSearchResult["matchedFields"] = [];
      const matchedEvidence: ProjectSearchResult["matchedEvidence"] = [];
      const values: Array<[ProjectSearchResult["matchedFields"][number], string]> = [
        ["fullName", project.fullName],
        ["description", project.description ?? ""],
        ["readmeExcerpt", project.readmeExcerpt ?? ""],
      ];
      for (const [field, value] of values) {
        const token = evidenceTokens.find((candidate) => value.toLocaleLowerCase().includes(candidate.toLocaleLowerCase()));
        if (!token) continue;
        fields.push(field);
        const lower = value.toLocaleLowerCase(), index = lower.indexOf(token.toLocaleLowerCase());
        const start = Math.max(0, index - 80), end = Math.min(value.length, index + token.length + 160);
        matchedEvidence.push({ field, excerpt: value.slice(start, end).replace(/\s+/g, " ").trim() });
      }
      return { ...project, matchedFields: fields, matchedEvidence };
    });
    return { items, expandedQueries };
  }

  getProjectsCreatedSince(createdAfter: string, limit = 100): ProjectRecord[] {
    const rows = this.db.prepare("SELECT * FROM projects WHERE created_at >= ? ORDER BY observed_at DESC,score DESC LIMIT ?").all(createdAfter, limit) as Record<string, SQLOutputValue>[];
    return rows.map((row) => this.mapProject(row));
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id=?").get(id) as Record<string, SQLOutputValue> | undefined;
    return row ? this.mapProject(row) : null;
  }

  private mapProject(row: Record<string, SQLOutputValue>): ProjectRecord {
    const raw = json<Record<string, unknown>>(row.raw_json, {});
    const sampledIssues = json<NonNullable<GitHubRepository["issues"]>>(row.issues_json, []);
    const issueContexts = json<Record<string, IssueContext>>(row.issue_contexts_json, {});
    const sampledNumbers = new Set(sampledIssues.map((issue) => issue.number));
    const selectedIssues = Object.values(issueContexts).filter((context) => context.selectedForResearch && !sampledNumbers.has(context.issue.number) && !issueContextOutdated(context, context.issue.updatedAt)).map((context) => context.issue).sort((a, b) => a.number - b.number);
    return {
      id: String(row.id), fullName: String(row.full_name),
      description: typeof row.description === "string" ? row.description : null,
      language: typeof row.language === "string" ? row.language : null,
      license: typeof row.license === "string" ? row.license : null,
      stars: Number(row.stars), forks: Number(row.forks), openIssues: Number(row.open_issues),
      createdAt: String(row.created_at), pushedAt: typeof row.pushed_at === "string" ? row.pushed_at : null,
      firstSeenAt: typeof row.first_seen_at === "string" ? row.first_seen_at : null,
      url: String(row.url), readmeExcerpt: typeof row.readme_excerpt === "string" ? row.readme_excerpt : null,
      releaseTag: typeof row.release_tag === "string" ? row.release_tag : null,
      releaseUrl: typeof row.release_url === "string" ? row.release_url : null,
      score: Number(row.score), scoreReasons: json(row.score_reasons_json, []), capabilities: json(row.capabilities_json, []),
      observedAt: String(row.observed_at), raw,
      issues: [...sampledIssues, ...selectedIssues], issuesFetchedAt: typeof row.issues_fetched_at === "string" ? row.issues_fetched_at : null,
      discoveryChannels: json(row.discovery_channels_json, []),
      documentation: json<RepositoryDocumentation | null>(row.documentation_json, null),
      issueContexts,
      warning: null,
    };
  }

  saveDocumentation(projectId: string, report: RepositoryDocumentation, signal: W2ASignal) {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const externalId = signal.source_event?.data?.externalId;
    if (typeof externalId !== "string") throw new Error("Documentation signal is missing an event ID");
    if (signal.event.type !== "github.documentation.observed" || signal.source_event?.data.repositoryId !== projectId || signal.source_event.data.fullName !== project.fullName) throw new Error("Documentation signal does not match the project");
    const freshPaths = new Set(report.documents.map((document) => document.path));
    const documents = [...report.documents, ...(project.documentation?.documents ?? []).filter((document) => !freshPaths.has(document.path)).map((document) => ({ ...document, stale: document.stale || report.attemptedPaths.includes(document.path) }))].slice(0, 6);
    const merged = { ...report, documents };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE projects SET documentation_json=? WHERE id=?").run(JSON.stringify(merged), projectId);
      this.db.prepare("INSERT OR IGNORE INTO signals(id,source_type,external_id,event_type,occurred_at,emitted_at,payload_json) VALUES (?,?,?,?,?,?,?)")
        .run(signal.signal_id, signal.source.source_type, externalId, signal.event.type, signal.event.occurred_at, signal.emitted_at, JSON.stringify(signal));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return merged;
  }

  saveOpportunities(drafts: OpportunityDraft[], focus?: ResearchFocus | null, profile?: ResearchProfile | null) {
    const now = new Date().toISOString();
    const canonicalFocus = canonicalResearchFocus(focus);
    const researchProfile = canonicalResearchProfile(profile);
    const baseScope = canonicalFocus ? `focus:${createHash("sha256").update(JSON.stringify(canonicalFocus)).digest("hex")}` : "discovery";
    const researchScope = researchProfile ? `${baseScope}:profile:${createHash("sha256").update(JSON.stringify(researchProfile)).digest("hex")}` : baseScope;
    const statement = this.db.prepare(`
      INSERT INTO opportunities(id,combination_key,title,target_user,job_to_be_done,hypothesis,project_ids_json,project_names_json,status,score,market_status,supporting_evidence_json,counter_evidence_json,validation_steps_json,success_metric,failure_metric,analysis_version,superseded_at,created_at,updated_at,research_scope)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(combination_key) DO UPDATE SET title=excluded.title,target_user=excluded.target_user,job_to_be_done=excluded.job_to_be_done,hypothesis=excluded.hypothesis,
        project_ids_json=excluded.project_ids_json,project_names_json=excluded.project_names_json,score=excluded.score,
        supporting_evidence_json=excluded.supporting_evidence_json,counter_evidence_json=excluded.counter_evidence_json,
        validation_steps_json=excluded.validation_steps_json,success_metric=excluded.success_metric,failure_metric=excluded.failure_metric,analysis_version=2,superseded_at=NULL,updated_at=excluded.updated_at,research_scope=excluded.research_scope
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE opportunities SET superseded_at=? WHERE analysis_version=2 AND status='candidate' AND research_scope=? AND superseded_at IS NULL").run(now, researchScope);
      for (const draft of drafts) {
        statement.run(draft.id, draft.combinationKey, draft.title, draft.targetUser, draft.jobToBeDone, draft.hypothesis, JSON.stringify(draft.projectIds), JSON.stringify(draft.projectNames), "candidate", draft.score, "unvalidated", JSON.stringify(draft.supportingEvidence), JSON.stringify(draft.counterEvidence), JSON.stringify(draft.validationSteps), draft.successMetric, draft.failureMetric, 2, null, now, now, researchScope);
        const details = { components: draft.components ?? [], integrationPlan: draft.integrationPlan ?? null, alternatives: draft.alternatives ?? null, whyNow: draft.whyNow ?? null, firstExperiment: draft.firstExperiment ?? null, problemEvidence: draft.problemEvidence ?? [], researchFocus: canonicalFocus, researchProfile };
        this.db.prepare("UPDATE opportunities SET analysis_details_json=? WHERE combination_key=?").run(JSON.stringify(details), draft.combinationKey);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getOpportunities(view: "current" | "history" = "current"): OpportunityRecord[] {
    // A later batch supersedes the list, not the underlying hypothesis. Keep
    // these candidates discoverable without treating them as the latest output.
    const query = view === "history"
      ? "SELECT * FROM opportunities WHERE analysis_version=2 AND status='candidate' AND superseded_at IS NOT NULL ORDER BY superseded_at DESC,updated_at DESC,id"
      : "SELECT * FROM opportunities WHERE status != 'dismissed' AND ((analysis_version=2 AND superseded_at IS NULL) OR status IN ('saved','validating','validated')) ORDER BY score DESC,updated_at DESC";
    const rows = this.db.prepare(query).all() as Record<string, SQLOutputValue>[];
    return rows.map((row) => this.mapOpportunity(row));
  }

  getOpportunity(id: string): OpportunityRecord | null {
    const row = this.db.prepare("SELECT * FROM opportunities WHERE id=?").get(id) as Record<string, SQLOutputValue> | undefined;
    return row ? this.mapOpportunity(row) : null;
  }

  private mapOpportunity(row: Record<string, SQLOutputValue>): OpportunityRecord {
    const draft: OpportunityDraft = {
      id: String(row.id), combinationKey: String(row.combination_key), title: String(row.title), targetUser: String(row.target_user),
      jobToBeDone: String(row.job_to_be_done), hypothesis: String(row.hypothesis),
      projectIds: json(row.project_ids_json, []), projectNames: json(row.project_names_json, []), score: Number(row.score),
      supportingEvidence: json(row.supporting_evidence_json, []), counterEvidence: json(row.counter_evidence_json, []),
      validationSteps: json(row.validation_steps_json, []), successMetric: String(row.success_metric), failureMetric: String(row.failure_metric),
      ...json<Partial<OpportunityDraft>>(row.analysis_details_json, {}),
    };
    return {
      ...draft,
      status: row.status === "validated" ? "completed" : String(row.status) as Exclude<OpportunityStatus, "validated">,
      marketStatus: row.market_status === "validated" ? "evidence_recorded" : "unvalidated",
      validationRecords: (() => {
        const raw = json<Partial<ValidationRecord> | Partial<ValidationRecord>[] | null>(row.validation_record_json ?? undefined, null);
        const records = Array.isArray(raw) ? raw : raw ? [raw] : [];
        return records.filter((record) => record.method && record.note && record.recordedAt).map((record) => ({ ...record, outcome: record.outcome ?? "inconclusive" } as ValidationRecord));
      })(),
      validationProgress: json<ValidationStepProgress[]>(row.validation_progress_json, []).filter((item) => Number.isInteger(item.index) && item.index >= 0 && item.step && ["completed", "skipped"].includes(item.status)),
      validationRecord: (() => {
        const raw = json<Partial<ValidationRecord> | Partial<ValidationRecord>[] | null>(row.validation_record_json ?? undefined, null);
        const records = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const record = records.at(-1);
        if (!record || !record.method || !record.note || !record.recordedAt) return null;
        return { ...record, outcome: record.outcome ?? "inconclusive" } as ValidationRecord;
      })(),
      createdAt: String(row.created_at), supersededAt: typeof row.superseded_at === "string" ? row.superseded_at : null,
    };
  }

  updateOpportunityStatus(id: string, status: Exclude<OpportunityStatus, "validated">) {
    const result = this.db.prepare("UPDATE opportunities SET status=?,updated_at=? WHERE id=?").run(status, new Date().toISOString(), id);
    return Number(result.changes) > 0 ? this.getOpportunity(id) : null;
  }

  recordExternalValidation(id: string, record: Omit<ValidationRecord, "recordedAt">) {
    const validation: ValidationRecord = { ...record, recordedAt: new Date().toISOString() };
    const existing = this.db.prepare("SELECT validation_record_json FROM opportunities WHERE id=?").get(id) as { validation_record_json?: SQLOutputValue } | undefined;
    if (!existing) return null;
    const raw = json<Partial<ValidationRecord> | Partial<ValidationRecord>[] | null>(existing.validation_record_json, null);
    const records = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((item) => item.method && item.note && item.recordedAt);
    records.push(validation);
    const result = this.db.prepare("UPDATE opportunities SET status='validating',market_status='validated',validation_record_json=?,updated_at=? WHERE id=?")
      .run(JSON.stringify(records), validation.recordedAt, id);
    return Number(result.changes) > 0 ? this.getOpportunity(id) : null;
  }

  updateValidationStep(id: string, index: number, status: "pending" | "completed" | "skipped", note: string) {
    const opportunity = this.getOpportunity(id);
    if (!opportunity || !Number.isInteger(index) || index < 0 || index >= opportunity.validationSteps.length) return null;
    const step = opportunity.validationSteps[index]!;
    const progress = (opportunity.validationProgress ?? []).filter((item) => item.index !== index || item.step !== step);
    if (status !== "pending") progress.push({ index, step, status, note: note.trim(), updatedAt: new Date().toISOString() });
    progress.sort((a, b) => a.index - b.index);
    const updatedAt = new Date().toISOString();
    const result = this.db.prepare("UPDATE opportunities SET validation_progress_json=?,updated_at=? WHERE id=?").run(JSON.stringify(progress), updatedAt, id);
    return Number(result.changes) > 0 ? this.getOpportunity(id) : null;
  }

  dashboard() {
    const projectCount = Number((this.db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count);
    const opportunityCount = Number((this.db.prepare("SELECT COUNT(*) AS count FROM opportunities WHERE status != 'dismissed' AND ((analysis_version=2 AND superseded_at IS NULL) OR status IN ('saved','validating','validated'))").get() as { count: number }).count);
    const freshCount = Number((this.db.prepare("SELECT COUNT(*) AS count FROM projects WHERE first_seen_at >= ?").get(new Date(Date.now() - 7 * 86400000).toISOString()) as { count: number }).count);
    const issueSampleCount = Number((this.db.prepare(`SELECT COALESCE(SUM(json_array_length(issues_json) + (
      SELECT COUNT(*) FROM json_each(issue_contexts_json) context
      WHERE json_extract(context.value,'$.selectedForResearch')=1
      AND (json_extract(context.value,'$.newestSampleUpdatedAt') IS NULL OR julianday(json_extract(context.value,'$.newestSampleUpdatedAt'))<=julianday(json_extract(context.value,'$.issue.updatedAt')))
      AND NOT EXISTS (
        SELECT 1 FROM json_each(issues_json) sample WHERE json_extract(sample.value,'$.number')=json_extract(context.value,'$.issue.number')
      )
    )),0) AS count FROM projects`).get() as { count: number }).count);
    return { projectCount, opportunityCount, freshCount, issueSampleCount, lastScan: this.listScanRuns(1)[0] ?? null };
  }

  getProjectObservations(id: string, limit = 30) {
    return this.db.prepare("SELECT observed_at AS observedAt,stars,forks,open_issues AS openIssues,release_tag AS releaseTag FROM project_observations WHERE project_id=? ORDER BY observed_at DESC LIMIT ?").all(id, limit);
  }

  saveIssueContext(projectId: string, context: IssueContext, signal: W2ASignal) {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Project not found");
    const data = signal.source_event?.data;
    if (data?.repositoryId !== projectId || data?.fullName !== project.fullName || signal.event.type !== "github.issue.context.observed" || JSON.stringify(data.context) !== JSON.stringify(context)) throw new Error("Issue context signal must match the project and context");
    const prior = project.issueContexts?.[String(context.issue.number)];
    const selected = { ...context, ...(context.selectedForResearch || prior?.selectedForResearch ? { selectedForResearch: true } : {}), ...(prior?.newestSampleUpdatedAt && Date.parse(prior.newestSampleUpdatedAt) > Date.parse(context.issue.updatedAt) ? { newestSampleUpdatedAt: prior.newestSampleUpdatedAt } : {}) };
    const saved: IssueContext = { ...selected };
    if (context.commentsError && prior) {
      saved.comments = prior.comments; saved.commentsObservedAt = prior.commentsObservedAt; saved.commentsComplete = false;
      if (prior.commentSampling) saved.commentSampling = prior.commentSampling;
      else delete saved.commentSampling;
    }
    const contexts = { ...project.issueContexts, [String(context.issue.number)]: saved };
    // Pin the at-most-three tracked discussions inside the existing ten-snapshot budget.
    const pinned = new Set(this.getProjectMonitor(projectId)?.issues.map((item) => String(item.number)) ?? []);
    const bounded = Object.fromEntries(Object.entries(contexts).sort((a, b) => Number(pinned.has(b[0])) - Number(pinned.has(a[0])) || b[1].observedAt.localeCompare(a[1].observedAt)).slice(0, 10));
    const externalId = signal.source_event?.data.externalId;
    if (typeof externalId !== "string") throw new Error("W2A Issue context signal has no event ID");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE projects SET issue_contexts_json=? WHERE id=?").run(JSON.stringify(bounded), projectId);
      this.db.prepare("INSERT OR IGNORE INTO signals(id,source_type,external_id,event_type,occurred_at,emitted_at,payload_json) VALUES (?,?,?,?,?,?,?)").run(signal.signal_id, signal.source.source_type, externalId, signal.event.type, signal.event.occurred_at, signal.emitted_at, JSON.stringify(signal));
      this.db.exec("COMMIT");
      return saved;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  getDiscoveryObservations(): ProjectObservation[] {
    return this.db.prepare(`SELECT project_id AS projectId,observed_at AS observedAt,stars,forks,open_issues AS openIssues,release_tag AS releaseTag
      FROM (SELECT *,ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY observed_at DESC) AS position FROM project_observations)
      WHERE position <= 2 ORDER BY project_id,observed_at DESC`).all() as ProjectObservation[];
  }

  close() {
    this.db.close();
  }
}
