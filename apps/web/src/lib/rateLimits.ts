import type {
  OrchestrationThreadActivity,
  ProviderRateLimitSnapshot,
  ProviderRateLimitWindow,
} from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const WINDOW_KINDS = new Set(["five_hour", "weekly", "overage", "other"]);

function parseWindow(value: unknown): ProviderRateLimitWindow | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const usedPercent = asFiniteNumber(record.usedPercent);
  const resetsAt = asFiniteNumber(record.resetsAt);
  // Keep a window if it has either a usage figure or a reset time to show.
  if (usedPercent === null && resetsAt === null) {
    return null;
  }
  const kind =
    typeof record.kind === "string" && WINDOW_KINDS.has(record.kind)
      ? (record.kind as ProviderRateLimitWindow["kind"])
      : "other";
  const label =
    typeof record.label === "string" && record.label.trim().length > 0 ? record.label : "Limit";
  const windowMinutes = asFiniteNumber(record.windowMinutes);
  const detail =
    typeof record.detail === "string" && record.detail.trim().length > 0
      ? record.detail
      : undefined;
  return {
    kind,
    label,
    ...(usedPercent !== null ? { usedPercent: Math.max(0, Math.min(100, usedPercent)) } : {}),
    ...(resetsAt !== null ? { resetsAt } : {}),
    ...(windowMinutes !== null ? { windowMinutes } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };
}

export type RateLimitSnapshot = ProviderRateLimitSnapshot & {
  readonly updatedAt: string;
};

/**
 * Walk thread activities newest-first and return the most recent normalized
 * rate-limit snapshot, or null if the provider has not reported quota usage.
 */
export function deriveLatestRateLimitSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): RateLimitSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "account.rate-limits.updated") {
      continue;
    }
    const payload = asRecord(activity.payload);
    const snapshot = asRecord(payload?.snapshot);
    if (!snapshot) {
      continue;
    }
    const rawWindows = Array.isArray(snapshot.windows) ? snapshot.windows : [];
    const windows = rawWindows
      .map(parseWindow)
      .filter((window): window is ProviderRateLimitWindow => window !== null);
    if (windows.length === 0) {
      continue;
    }
    const status =
      snapshot.status === "allowed" ||
      snapshot.status === "allowed_warning" ||
      snapshot.status === "rejected"
        ? snapshot.status
        : undefined;
    const planType = typeof snapshot.planType === "string" ? snapshot.planType : undefined;
    return {
      windows,
      ...(status ? { status } : {}),
      ...(planType ? { planType } : {}),
      updatedAt: activity.createdAt,
    };
  }
  return null;
}

/** Human-readable countdown to a reset, e.g. "resets in 2h 14m" / "resets in 3d". */
export function formatRateLimitReset(resetsAt: number | undefined, nowMs: number): string | null {
  if (resetsAt === undefined || !Number.isFinite(resetsAt)) {
    return null;
  }
  // resetsAt is epoch seconds; tolerate accidental millisecond values.
  const resetMs = resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
  const diffMs = resetMs - nowMs;
  if (diffMs <= 0) {
    return "resets now";
  }
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) {
    return `resets in ${Math.max(1, minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `resets in ${hours}h ${remMinutes}m` : `resets in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `resets in ${days}d ${remHours}h` : `resets in ${days}d`;
}

/** Compact reset label for inline display, e.g. "5d" / "2h" / "30m". */
export function formatRateLimitResetShort(
  resetsAt: number | undefined,
  nowMs: number,
): string | null {
  if (resetsAt === undefined || !Number.isFinite(resetsAt)) {
    return null;
  }
  const resetMs = resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
  const diffMs = resetMs - nowMs;
  if (diffMs <= 0) {
    return "now";
  }
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) {
    return `${Math.max(1, minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}
