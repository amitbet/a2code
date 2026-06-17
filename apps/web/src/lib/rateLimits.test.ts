import { describe, expect, it } from "vitest";
import { EventId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  RATE_LIMIT_STALE_AFTER_MS,
  deriveLatestRateLimitSnapshot,
  formatRateLimitReset,
  isRateLimitSnapshotStale,
  shouldShowRateLimitMeter,
} from "./rateLimits";

function activity(
  partial: Partial<OrchestrationThreadActivity> & { payload: unknown },
): OrchestrationThreadActivity {
  return {
    id: EventId.make("evt-1"),
    createdAt: "2026-06-03T00:00:00.000Z",
    tone: "info",
    kind: "account.rate-limits.updated",
    summary: "Account rate limits updated",
    turnId: null,
    ...partial,
  } as OrchestrationThreadActivity;
}

describe("deriveLatestRateLimitSnapshot", () => {
  it("returns null when there are no rate-limit activities", () => {
    expect(deriveLatestRateLimitSnapshot([])).toBeNull();
  });

  it("parses windows and metadata from the latest snapshot", () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      activity({
        payload: {
          snapshot: {
            windows: [
              { kind: "five_hour", label: "5-hour", usedPercent: 42, resetsAt: 1_900_000_000 },
              {
                kind: "weekly",
                label: "Weekly",
                usedPercent: 80,
                resetsAt: 1_900_500_000,
                windowMinutes: 10080,
              },
            ],
            status: "allowed_warning",
            planType: "max",
          },
        },
      }),
    ]);
    expect(snapshot?.windows).toHaveLength(2);
    expect(snapshot?.windows[0]?.usedPercent).toBe(42);
    expect(snapshot?.windows[1]?.label).toBe("Weekly");
    expect(snapshot?.windows[1]?.resetsAt).toBe(1_900_500_000);
    expect(snapshot?.status).toBe("allowed_warning");
    expect(snapshot?.planType).toBe("max");
  });

  it("surfaces a single overage window (the Claude shape)", () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      activity({
        payload: {
          snapshot: {
            windows: [{ kind: "overage", label: "Overage", usedPercent: 84 }],
            status: "allowed_warning",
          },
        },
      }),
    ]);
    expect(snapshot?.windows).toHaveLength(1);
    expect(snapshot?.windows[0]?.label).toBe("Overage");
    expect(snapshot?.windows[0]?.usedPercent).toBe(84);
  });

  it("preserves Claude spend windows and detail text", () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      activity({
        payload: {
          snapshot: {
            windows: [
              {
                kind: "spend",
                label: "Spend",
                usedPercent: 17,
                detail: "$169.27 / $1,000.00",
              },
            ],
            status: "allowed",
          },
        },
      }),
    ]);
    expect(snapshot?.windows).toHaveLength(1);
    expect(snapshot?.windows[0]?.kind).toBe("spend");
    expect(snapshot?.windows[0]?.detail).toBe("$169.27 / $1,000.00");
    expect(snapshot?.windows[0]?.usedPercent).toBe(17);
  });

  it("keeps a reset-only window when Claude omits the percentage", () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      activity({
        payload: {
          snapshot: {
            windows: [{ kind: "overage", label: "Overage", resetsAt: 1_900_000_000 }],
            status: "allowed",
          },
        },
      }),
    ]);
    expect(snapshot?.windows).toHaveLength(1);
    expect(snapshot?.windows[0]?.usedPercent).toBeUndefined();
    expect(snapshot?.windows[0]?.resetsAt).toBe(1_900_000_000);
  });

  it("prefers the most recent activity and clamps out-of-range percentages", () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      activity({
        payload: {
          snapshot: { windows: [{ kind: "five_hour", label: "5-hour", usedPercent: 10 }] },
        },
      }),
      activity({
        payload: {
          snapshot: { windows: [{ kind: "five_hour", label: "5-hour", usedPercent: 150 }] },
        },
      }),
    ]);
    expect(snapshot?.windows[0]?.usedPercent).toBe(100);
  });

  it("merges sparse rolling updates with older windows", () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      activity({
        createdAt: "2026-06-03T00:00:00.000Z",
        payload: {
          snapshot: {
            windows: [
              { kind: "five_hour", label: "5-hour", usedPercent: 42, resetsAt: 1_900_000_000 },
              { kind: "weekly", label: "Weekly", usedPercent: 80, resetsAt: 1_900_500_000 },
            ],
            planType: "max",
          },
        },
      }),
      activity({
        createdAt: "2026-06-03T00:05:00.000Z",
        payload: {
          snapshot: {
            windows: [{ kind: "five_hour", label: "5-hour", usedPercent: 55 }],
            status: "allowed",
          },
        },
      }),
    ]);
    expect(snapshot?.updatedAt).toBe("2026-06-03T00:05:00.000Z");
    expect(snapshot?.status).toBe("allowed");
    expect(snapshot?.planType).toBe("max");
    expect(snapshot?.windows).toHaveLength(2);
    expect(snapshot?.windows[0]?.usedPercent).toBe(55);
    expect(snapshot?.windows[1]?.label).toBe("Weekly");
  });

  it("skips activities whose snapshot has no usable window", () => {
    const snapshot = deriveLatestRateLimitSnapshot([
      activity({ payload: { snapshot: { windows: [], status: "allowed" } } }),
    ]);
    expect(snapshot).toBeNull();
  });
});

describe("shouldShowRateLimitMeter", () => {
  const baseSnapshot = {
    updatedAt: "2026-06-03T00:00:00.000Z",
    windows: [{ kind: "five_hour", label: "5-hour", usedPercent: 42 }] as const,
  };

  it("hides when there is no snapshot", () => {
    expect(shouldShowRateLimitMeter(null)).toBe(false);
  });

  it("shows whenever a snapshot exists, regardless of status", () => {
    expect(shouldShowRateLimitMeter({ ...baseSnapshot, status: "allowed" })).toBe(true);
    expect(shouldShowRateLimitMeter({ ...baseSnapshot, status: "allowed_warning" })).toBe(true);
    expect(shouldShowRateLimitMeter({ ...baseSnapshot, status: "rejected" })).toBe(true);
  });
});

describe("isRateLimitSnapshotStale", () => {
  const baseSnapshot = {
    status: "allowed" as const,
    updatedAt: "2026-06-03T00:00:00.000Z",
    windows: [{ kind: "five_hour", label: "5-hour", usedPercent: 42 }] as const,
  };
  const updatedMs = Date.parse(baseSnapshot.updatedAt);

  it("is never stale while running", () => {
    expect(
      isRateLimitSnapshotStale(baseSnapshot, true, updatedMs + RATE_LIMIT_STALE_AFTER_MS + 1),
    ).toBe(false);
  });

  it("is fresh when idle but recently updated", () => {
    expect(
      isRateLimitSnapshotStale(baseSnapshot, false, updatedMs + RATE_LIMIT_STALE_AFTER_MS - 1),
    ).toBe(false);
  });

  it("goes stale when idle past the threshold", () => {
    expect(
      isRateLimitSnapshotStale(baseSnapshot, false, updatedMs + RATE_LIMIT_STALE_AFTER_MS + 1),
    ).toBe(true);
  });
});

describe("formatRateLimitReset", () => {
  const now = Date.parse("2026-06-03T00:00:00.000Z");

  it("returns null when resetsAt is missing", () => {
    expect(formatRateLimitReset(undefined, now)).toBeNull();
  });

  it("formats minutes, hours, and days from epoch seconds", () => {
    expect(formatRateLimitReset(now / 1000 + 30 * 60, now)).toBe("resets in 30m");
    expect(formatRateLimitReset(now / 1000 + (2 * 60 + 14) * 60, now)).toBe("resets in 2h 14m");
    expect(formatRateLimitReset(now / 1000 + 3 * 24 * 3600, now)).toBe("resets in 3d");
  });

  it("treats millisecond timestamps gracefully", () => {
    expect(formatRateLimitReset(now + 45 * 60_000, now)).toBe("resets in 45m");
  });
});
