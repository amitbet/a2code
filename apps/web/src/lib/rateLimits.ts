import type { ServerProviderUsageLimits } from "@t3tools/contracts";

/**
 * Presentation helpers for the composer-footer quota meter.
 *
 * The snapshot itself is server-authoritative: providers publish
 * `usageLimits` on their `ServerProvider` snapshot (see
 * `apps/server/src/provider/providerUsageLimits.ts`), so the client only
 * formats what it is given. There is no client-side derivation, merging, or
 * persistence — an earlier fork revision carried all three to work around
 * quota arriving only over per-thread activity streams, which no longer
 * happens.
 */

/** Show the meter once the provider has reported at least one window. */
export function shouldShowRateLimitMeter(
  limits: ServerProviderUsageLimits | null | undefined,
): limits is ServerProviderUsageLimits {
  return limits != null && limits.windows.length > 0;
}

/** A snapshot is considered stale this long after its last update while idle. */
export const RATE_LIMIT_STALE_AFTER_MS = 5 * 60_000;

/**
 * A running turn keeps publishing updates, so it is never stale; between
 * turns the probe interval means figures can legitimately age, and the meter
 * dims rather than lying about how current it is.
 */
export function isRateLimitSnapshotStale(
  limits: ServerProviderUsageLimits,
  isRunning: boolean,
  nowMs: number,
): boolean {
  if (isRunning) {
    return false;
  }
  const checkedMs = Date.parse(limits.checkedAt);
  if (!Number.isFinite(checkedMs)) {
    return false;
  }
  return nowMs - checkedMs > RATE_LIMIT_STALE_AFTER_MS;
}

/** Compact "updated Xm ago" label for the snapshot timestamp. */
export function formatRateLimitUpdatedAgo(checkedAt: string, nowMs: number): string | null {
  const checkedMs = Date.parse(checkedAt);
  if (!Number.isFinite(checkedMs)) {
    return null;
  }
  const diffMs = nowMs - checkedMs;
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

function resetDiffMs(resetsAt: string | undefined, nowMs: number): number | null {
  if (resetsAt === undefined) {
    return null;
  }
  const resetMs = Date.parse(resetsAt);
  return Number.isFinite(resetMs) ? resetMs - nowMs : null;
}

/** Human-readable countdown to a reset, e.g. "resets in 2h 14m" / "resets in 3d". */
export function formatRateLimitReset(resetsAt: string | undefined, nowMs: number): string | null {
  const diffMs = resetDiffMs(resetsAt, nowMs);
  if (diffMs === null) {
    return null;
  }
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
  resetsAt: string | undefined,
  nowMs: number,
): string | null {
  const diffMs = resetDiffMs(resetsAt, nowMs);
  if (diffMs === null) {
    return null;
  }
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
