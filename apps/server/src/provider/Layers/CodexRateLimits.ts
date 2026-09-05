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
