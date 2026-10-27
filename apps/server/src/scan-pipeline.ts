import { createRepositorySignal } from "@radar/contracts";
import { extractCapabilities, scoreProject } from "@radar/analysis";
import { buildDiscoveryPlan, type DiscoveryTrack, type GitHubClient } from "@radar/sensor-github";
import type { RuntimeAdapter } from "@radar/runtime";
import type { RadarStore, ScanRun } from "@radar/storage";

// Collection and model analysis have independent durable outcomes and Engine calls.
// A slow or failed analysis must not hide successfully collected evidence.
export async function runScanPipeline(options: {
  run: ScanRun; store: RadarStore; runtime: RuntimeAdapter; client: Pick<GitHubClient, "discover">;
  analyze: (ids: Set<string>) => Promise<unknown>; onAnalysis: () => void;
}) {
  const { run, store, runtime, client } = options;
  let ids: Set<string>;
  try {
    // Arrays survive Engine serialization; Set does not.
    const collected = await runtime.run(async () => [...await collectScan(run, store, client)], "scan");
    ids = new Set(collected);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub collection failed";
    // An Engine reply can fail after the callback has committed its result.
    // Never replace a successful collection with a transport error.
    const current = store.getScanRun(run.id);
    if (current?.status === "running" || current?.status === "queued") {
      store.finishScanRun(run, { status: "failed", found: current.found, inserted: current.inserted, duplicates: current.duplicates, error: message }, current.warnings);
    }
    throw error;
  }
  options.onAnalysis();
  // Keep one rejection chain and reserve the shared job slot until analysis ends.
  // The collection's durable status is already terminal and independently visible.
  return runtime.run(() => options.analyze(ids), "analyze-opportunities");
}

async function collectScan(run: ScanRun, store: RadarStore, client: Pick<GitHubClient, "discover">) {
  const settings = store.getSettings();
  const progress = store.getDiscoveryProgress(), scanDate = new Date(run.startedAt);
  store.recordDiscovery(run.id, buildDiscoveryPlan(settings, scanDate, progress));
  const discovery = await client.discover(settings, progress, scanDate).catch((error: unknown) => {
    if (error instanceof Error && "tracks" in error && Array.isArray(error.tracks)) store.recordDiscovery(run.id, error.tracks as DiscoveryTrack[]);
    throw error;
  });
  const { repositories } = discovery;
  const observedAt = new Date().toISOString();
  let inserted = 0;
  let duplicates = 0;
  const warnings: string[] = [...discovery.warnings];

  for (const repository of repositories) {
    const signal = createRepositorySignal({
      repositoryId: repository.id,
      fullName: repository.fullName,
      url: repository.url,
      description: repository.description,
      language: repository.language,
      license: repository.license,
      stars: repository.stars,
      forks: repository.forks,
      openIssues: repository.openIssues,
      createdAt: repository.createdAt,
      pushedAt: repository.pushedAt,
      readmeExcerpt: repository.readmeExcerpt,
      releaseTag: repository.releaseTag,
      releaseUrl: repository.releaseUrl,
      issues: repository.issues ?? [], issuesFetchedAt: repository.issuesFetchedAt ?? null, discoveryChannels: repository.discoveryChannels ?? [],
    });
    const candidate = { ...repository, id: String(repository.id), observedAt };
    const analysis = scoreProject(candidate);
    const capabilities = extractCapabilities(candidate);
    const saved = store.saveRepository(repository, signal, analysis.score, analysis.reasons, capabilities, observedAt);
    if (saved.signalInserted) inserted += 1;
    else duplicates += 1;
    if (repository.warning) warnings.push(`${repository.fullName}: ${repository.warning}`);
  }

  store.completeDiscovery(run.id, discovery.tracks);
  store.finishScanRun(run, { status: warnings.length > 0 ? "partial" : "succeeded", found: repositories.length, inserted, duplicates, error: null }, warnings);
  return new Set(repositories.map((repository) => String(repository.id)));
}
