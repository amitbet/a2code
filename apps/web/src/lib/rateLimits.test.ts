import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderUsageLimits } from "@t3tools/contracts";

import {
  RATE_LIMIT_STALE_AFTER_MS,
  formatRateLimitReset,
  formatRateLimitResetShort,
  formatRateLimitUpdatedAgo,
  isRateLimitSnapshotStale,
  shouldShowRateLimitMeter,
} from "./rateLimits";

const NOW_MS = Date.parse("2026-06-03T12:00:00.000Z");

function limits(overrides: Partial<ServerProviderUsageLimits> = {}): ServerProviderUsageLimits {
  return {
    checkedAt: "2026-06-03T12:00:00.000Z",
    windows: [{ id: "five_hour", kind: "session", label: "Session", usedPercent: 40 }],
    ...overrides,
  };
}

describe("shouldShowRateLimitMeter", () => {
  it("hides the meter until a provider reports a window", () => {
    expect(shouldShowRateLimitMeter(null)).toBe(false);
    expect(shouldShowRateLimitMeter(undefined)).toBe(false);
    expect(shouldShowRateLimitMeter(limits({ windows: [] }))).toBe(false);
    expect(shouldShowRateLimitMeter(limits())).toBe(true);
  });
});

describe("isRateLimitSnapshotStale", () => {
  it("never dims the meter while a turn is running", () => {
    const old = limits({ checkedAt: new Date(NOW_MS - 60 * 60_000).toISOString() });
    expect(isRateLimitSnapshotStale(old, true, NOW_MS)).toBe(false);
    expect(isRateLimitSnapshotStale(old, false, NOW_MS)).toBe(true);
  });

  it("treats a reading inside the stale window as current", () => {
    const recent = limits({
      checkedAt: new Date(NOW_MS - RATE_LIMIT_STALE_AFTER_MS + 1_000).toISOString(),
    });
    expect(isRateLimitSnapshotStale(recent, false, NOW_MS)).toBe(false);
  });

  it("does not dim on an unparseable timestamp", () => {
    expect(isRateLimitSnapshotStale(limits({ checkedAt: "nonsense" }), false, NOW_MS)).toBe(false);
  });
});

describe("formatRateLimitUpdatedAgo", () => {
  it("scales the unit with the age", () => {
    expect(formatRateLimitUpdatedAgo(new Date(NOW_MS - 30_000).toISOString(), NOW_MS)).toBe(
      "updated just now",
    );
    expect(formatRateLimitUpdatedAgo(new Date(NOW_MS - 5 * 60_000).toISOString(), NOW_MS)).toBe(
      "updated 5m ago",
    );
    expect(formatRateLimitUpdatedAgo(new Date(NOW_MS - 3 * 3_600_000).toISOString(), NOW_MS)).toBe(
      "updated 3h ago",
    );
    expect(formatRateLimitUpdatedAgo(new Date(NOW_MS - 2 * 86_400_000).toISOString(), NOW_MS)).toBe(
      "updated 2d ago",
    );
  });

  it("returns null for an unparseable timestamp", () => {
    expect(formatRateLimitUpdatedAgo("nonsense", NOW_MS)).toBeNull();
  });
});

describe("formatRateLimitReset", () => {
  it("counts down in the largest useful unit", () => {
    expect(formatRateLimitReset(new Date(NOW_MS + 30 * 60_000).toISOString(), NOW_MS)).toBe(
      "resets in 30m",
    );
    expect(
      formatRateLimitReset(new Date(NOW_MS + 2 * 3_600_000 + 14 * 60_000).toISOString(), NOW_MS),
    ).toBe("resets in 2h 14m");
    expect(formatRateLimitReset(new Date(NOW_MS + 3 * 86_400_000).toISOString(), NOW_MS)).toBe(
      "resets in 3d",
    );
  });

  it("reports an elapsed window as resetting now", () => {
    expect(formatRateLimitReset(new Date(NOW_MS - 1_000).toISOString(), NOW_MS)).toBe("resets now");
  });

  it("returns null without a reset time", () => {
    expect(formatRateLimitReset(undefined, NOW_MS)).toBeNull();
  });
});

describe("formatRateLimitResetShort", () => {
  it("renders the compact trigger label", () => {
    expect(formatRateLimitResetShort(new Date(NOW_MS + 30 * 60_000).toISOString(), NOW_MS)).toBe(
      "30m",
    );
    expect(formatRateLimitResetShort(new Date(NOW_MS + 5 * 3_600_000).toISOString(), NOW_MS)).toBe(
      "5h",
    );
    expect(formatRateLimitResetShort(new Date(NOW_MS + 5 * 86_400_000).toISOString(), NOW_MS)).toBe(
      "5d",
    );
    expect(formatRateLimitResetShort(new Date(NOW_MS - 1_000).toISOString(), NOW_MS)).toBe("now");
  });
});
