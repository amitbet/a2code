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

const WINDOW_KINDS = new Set(["five_hour", "weekly", "overage", "spend", "other"]);

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
 * Return the most recent normalized rate-limit snapshot from a set of thread
 * activities, or null if the provider has not reported quota usage.
 *
 * Rate limits describe an account/subscription, not a single conversation, so
 * callers may pass activities merged across multiple threads in the same
 * environment. Each provider event is a complete normalized snapshot, so the
 * newest usable event replaces older snapshots instead of retaining windows
 * that the provider has removed.
 */
export function deriveLatestRateLimitSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): RateLimitSnapshot | null {
  const rateLimitActivities = activities
    .map((activity, index) => ({ activity, index }))
    .filter((entry) => entry.activity?.kind === "account.rate-limits.updated")
    .sort((a, b) =>
      a.activity.createdAt < b.activity.createdAt
        ? 1
        : a.activity.createdAt > b.activity.createdAt
          ? -1
          : b.index - a.index,
    );

  for (const { activity } of rateLimitActivities) {
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

/**
 * Validate an untrusted value (e.g. a snapshot restored from localStorage) into
 * a `RateLimitSnapshot`, or return null if it isn't usable. Windows are
 * re-parsed through the same normalization as live data so persisted state can
 * never inject shapes the renderer doesn't expect.
 */
export function sanitizeRateLimitSnapshot(value: unknown): RateLimitSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const updatedAt = record.updatedAt;
  if (typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) {
    return null;
  }
  const rawWindows = Array.isArray(record.windows) ? record.windows : [];
  const windows = rawWindows
    .map(parseWindow)
    .filter((window): window is ProviderRateLimitWindow => window !== null);
  if (windows.length === 0) {
    return null;
  }
  const status =
    record.status === "allowed" ||
    record.status === "allowed_warning" ||
    record.status === "rejected"
      ? record.status
      : undefined;
  const planType =
    typeof record.planType === "string" && record.planType.trim().length > 0
      ? record.planType
      : undefined;
  return {
    windows,
    ...(status ? { status } : {}),
    ...(planType ? { planType } : {}),
    updatedAt,
  };
}

/**
 * Pick the most recently updated of two snapshots (by `updatedAt`), preferring
 * the first argument on ties. Used to reconcile the live in-store snapshot with
 * one restored from persistent browser storage.
 */
export function freshestRateLimitSnapshot(
  a: RateLimitSnapshot | null,
  b: RateLimitSnapshot | null,
): RateLimitSnapshot | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a;
}

/** Always show the meter once the provider has reported quota usage at least once. */
export function shouldShowRateLimitMeter(snapshot: RateLimitSnapshot | null): boolean {
  return snapshot !== null;
}

/** A snapshot is considered stale this long after its last update while idle. */
export const RATE_LIMIT_STALE_AFTER_MS = 5 * 60_000;

/**
 * Activation refreshes are intentionally rate-limited to the same stale
 * horizon. This keeps focus/visibility churn from becoming background polling.
 */
export function shouldRefreshRateLimitsOnActivation(
  snapshot: RateLimitSnapshot | null,
  lastRequestedAtMs: number | null,
  nowMs: number,
): boolean {
  if (!snapshot || !isRateLimitSnapshotStale(snapshot, false, nowMs)) {
    return false;
  }
  return lastRequestedAtMs === null || nowMs - lastRequestedAtMs >= RATE_LIMIT_STALE_AFTER_MS;
}

/**
 * Whether the snapshot should render in a "stale" (greyed) state. Never stale
 * while the agent is running — usage is live then. Once idle, it goes stale
 * after RATE_LIMIT_STALE_AFTER_MS so the numbers visibly read as out of date.
 */
export function isRateLimitSnapshotStale(
  snapshot: RateLimitSnapshot,
  isRunning: boolean,
  nowMs: number,
): boolean {
  if (isRunning) {
    return false;
  }
  const updatedMs = Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(updatedMs)) {
    return false;
  }
  return nowMs - updatedMs > RATE_LIMIT_STALE_AFTER_MS;
}

/** Compact "updated Xm ago" label for the snapshot timestamp. */
export function formatRateLimitUpdatedAgo(updatedAt: string, nowMs: number): string | null {
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) {
    return null;
  }
  const diffMs = nowMs - updatedMs;
  if (diffMs < 60_000) {
    return "updated just now";
  }
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    return `updated ${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `updated ${hours}h ago`;
  }
  return `updated ${Math.floor(hours / 24)}d ago`;
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
