import { describe, expect, it } from "vitest";
import { normalizeClaudeUtilization } from "./ClaudeUsageApi.ts";

describe("normalizeClaudeUtilization", () => {
  it("returns null when nothing is reported", () => {
    expect(normalizeClaudeUtilization({})).toBeNull();
    expect(
      normalizeClaudeUtilization({ five_hour: { utilization: null, resets_at: null } }),
    ).toBeNull();
  });

  it("maps session + weekly windows with reset times (0-100 scale)", () => {
    const snapshot = normalizeClaudeUtilization({
      five_hour: { utilization: 42, resets_at: "2026-06-03T05:00:00.000Z" },
      seven_day: { utilization: 80, resets_at: "2026-06-10T00:00:00.000Z" },
    });
    expect(snapshot?.windows).toHaveLength(2);
    const session = snapshot?.windows.find((w) => w.kind === "five_hour");
    expect(session?.usedPercent).toBe(42);
    expect(session?.resetsAt).toBe(Math.round(Date.parse("2026-06-03T05:00:00.000Z") / 1000));
    const weekly = snapshot?.windows.find((w) => w.label === "Weekly");
    expect(weekly?.usedPercent).toBe(80);
  });

  it("maps extra_usage into a spend window with a dollar detail", () => {
    const snapshot = normalizeClaudeUtilization({
      extra_usage: {
        is_enabled: true,
        monthly_limit: 100000,
        used_credits: 16927,
        utilization: 17,
      },
    });
    expect(snapshot?.windows).toHaveLength(1);
    const spend = snapshot?.windows[0];
    expect(spend?.kind).toBe("spend");
    expect(spend?.usedPercent).toBe(17);
    expect(spend?.detail).toBe("$169.27 / $1,000.00");
  });

  it("skips a disabled extra_usage window", () => {
    expect(
      normalizeClaudeUtilization({
        extra_usage: { is_enabled: false, utilization: 50 },
      }),
    ).toBeNull();
  });

  it("clamps out-of-range utilization", () => {
    const snapshot = normalizeClaudeUtilization({
      five_hour: { utilization: 150, resets_at: null },
    });
    expect(snapshot?.windows[0]?.usedPercent).toBe(100);
  });
});
