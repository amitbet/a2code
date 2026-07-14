import type { ProviderRateLimitSnapshot, ProviderRateLimitWindow } from "@t3tools/contracts";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

export const CODEX_RATE_LIMIT_RESET_REFRESH_GRACE_MS = 10_000;

type CodexResetSnapshot = {
  readonly primary?: { readonly resetsAt?: number | null; readonly usedPercent?: number } | null;
  readonly secondary?: { readonly resetsAt?: number | null; readonly usedPercent?: number } | null;
};

/** Return the first future reset deadline, after a small rollover grace period. */
export function nextCodexRateLimitResetRefreshAt(
  rateLimits: CodexResetSnapshot,
  nowMs: number,
): number | undefined {
  const refreshTimes = [rateLimits.primary?.resetsAt, rateLimits.secondary?.resetsAt]
    .filter(
      (resetsAt): resetsAt is number => typeof resetsAt === "number" && Number.isFinite(resetsAt),
    )
    .map(
      (resetsAt) =>
        (resetsAt > 1e12 ? resetsAt : resetsAt * 1000) + CODEX_RATE_LIMIT_RESET_REFRESH_GRACE_MS,
    )
    .filter((refreshAt) => refreshAt > nowMs);
  return refreshTimes.length > 0 ? Math.min(...refreshTimes) : undefined;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function formatWindowLabel(windowMinutes: number): string {
  if (windowMinutes === 60) return "1-hour";
  if (windowMinutes === 1_440) return "Daily";
  if (windowMinutes === 10_080) return "Weekly";
  if (windowMinutes % 1_440 === 0) return `${windowMinutes / 1_440}-day`;
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}-hour`;
  return `${windowMinutes}-minute`;
}

function windowIdentity(
  window: EffectCodexSchema.V2AccountRateLimitsUpdatedNotification__RateLimitWindow,
  fallback: Pick<ProviderRateLimitWindow, "kind" | "label">,
): Pick<ProviderRateLimitWindow, "kind" | "label"> {
  if (typeof window.windowDurationMins !== "number") {
    return fallback;
  }
  const windowMinutes = Math.max(0, Math.round(window.windowDurationMins));
  if (windowMinutes === 300) {
    return { kind: "five_hour", label: "5-hour" };
  }
  if (windowMinutes === 10_080) {
    return { kind: "weekly", label: "Weekly" };
  }
  return {
    kind: "other",
    label: formatWindowLabel(windowMinutes),
  };
}

function normalizeWindow(
  fallback: Pick<ProviderRateLimitWindow, "kind" | "label">,
  window:
    | EffectCodexSchema.V2AccountRateLimitsUpdatedNotification__RateLimitWindow
    | null
    | undefined,
): ProviderRateLimitWindow | undefined {
  if (!window || typeof window.usedPercent !== "number") {
    return undefined;
  }
  return {
    ...windowIdentity(window, fallback),
    usedPercent: clampPercent(window.usedPercent),
    ...(typeof window.resetsAt === "number" ? { resetsAt: window.resetsAt } : {}),
    ...(typeof window.windowDurationMins === "number"
      ? { windowMinutes: Math.max(0, Math.round(window.windowDurationMins)) }
      : {}),
  };
}

export function normalizeCodexRateLimits(
  snapshot: EffectCodexSchema.V2AccountRateLimitsUpdatedNotification["rateLimits"],
): ProviderRateLimitSnapshot | undefined {
  // `primary` and `secondary` are ordering slots, not stable window identities.
  // Prefer the duration and retain the legacy slot mapping only when an older
  // app-server omits `windowDurationMins`.
  const windows = [
    normalizeWindow({ kind: "five_hour", label: "5-hour" }, snapshot.primary),
    normalizeWindow({ kind: "weekly", label: "Weekly" }, snapshot.secondary),
  ].filter((window): window is ProviderRateLimitWindow => window !== undefined);
  if (windows.length === 0) {
    return undefined;
  }
  return {
    windows,
    ...(typeof snapshot.planType === "string" ? { planType: snapshot.planType } : {}),
  };
}
