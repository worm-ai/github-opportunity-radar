export function nextScanDelay(lastStartedAt: string | null, intervalHours: number, now = Date.now()): number {
  const interval = intervalHours * 3_600_000;
  if (!lastStartedAt) return interval;
  const lastStarted = Date.parse(lastStartedAt);
  return Number.isFinite(lastStarted) ? Math.max(1_000, lastStarted + interval - now) : interval;
}
