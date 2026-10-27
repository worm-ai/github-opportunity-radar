import { expect, it } from "vitest";
import { nextScanDelay } from "./schedule.js";

it("retains the next due time across restarts and catches up once overdue", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  expect(nextScanDelay("2026-10-20T06:00:00Z", 24, now)).toBe(18 * 3_600_000);
  expect(nextScanDelay("2026-10-18T06:00:00Z", 24, now)).toBe(1_000);
  expect(nextScanDelay(null, 24, now)).toBe(24 * 3_600_000);
});
