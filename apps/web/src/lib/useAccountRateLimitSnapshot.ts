import { useAtomCommand } from "../state/use-atom-command";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";
import { useLatestRateLimitActivitiesForInstance } from "../state/rateLimits";
import { serverEnvironment } from "../state/server";
import {
  selectPersistedRateLimitSnapshot,
  useRateLimitSnapshotStore,
} from "../rateLimitSnapshotStore";
import {
  deriveLatestRateLimitSnapshot,
  freshestRateLimitSnapshot,
  shouldRefreshRateLimitsOnActivation,
  type RateLimitSnapshot,
} from "./rateLimits";

/**
 * Latest quota/rate-limit snapshot for a provider instance (subscription),
 * selected across every conversation bound to that instance rather than read
 * from a single thread. This keeps the quota meter showing the freshest data
 * we have for the subscription — an idle conversation no longer pins a stale
 * "updated 14h ago" while another conversation on the same account reports
 * newer usage.
 *
 * Live data only arrives over the per-thread detail subscription (evicted when
 * idle), so the freshest snapshot is also mirrored into persistent browser
 * storage and reconciled here: whichever of the live or persisted snapshot is
 * newer wins. This survives reloads and conversations being evicted.
 *
 * Returns null until the provider has reported quota usage at least once.
 */
export function useAccountRateLimitSnapshot(
  environmentId: EnvironmentId | null | undefined,
  instanceId: ProviderInstanceId | null | undefined,
): RateLimitSnapshot | null {
  const activities = useLatestRateLimitActivitiesForInstance(instanceId);
  const live = useMemo(() => deriveLatestRateLimitSnapshot(activities), [activities]);

  const persisted = useRateLimitSnapshotStore((state) =>
    selectPersistedRateLimitSnapshot(state.byInstanceId, instanceId),
  );
  const record = useRateLimitSnapshotStore((state) => state.record);
  const refreshRateLimits = useAtomCommand(serverEnvironment.refreshProviderRateLimits, {
    reportFailure: false,
    reportDefect: false,
  });
  const lastRefreshRequestRef = useRef<{ readonly key: string; readonly atMs: number } | null>(
    null,
  );

  // Persist the freshest live snapshot. `record` no-ops unless it is strictly
  // newer than what's stored, so this can't loop on the resulting re-render.
  useEffect(() => {
    if (instanceId && live) {
      record(instanceId, live);
    }
  }, [instanceId, live, record]);

  const snapshot = useMemo(() => freshestRateLimitSnapshot(live, persisted), [live, persisted]);

  useEffect(() => {
    if (!environmentId || !instanceId || !snapshot) {
      return;
    }
    const key = `${environmentId}:${instanceId}`;
    const requestIfStale = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      const nowMs = Date.now();
      const previous = lastRefreshRequestRef.current;
      const lastRequestedAtMs = previous?.key === key ? previous.atMs : null;
      if (!shouldRefreshRateLimitsOnActivation(snapshot, lastRequestedAtMs, nowMs)) {
        return;
      }
      lastRefreshRequestRef.current = { key, atMs: nowMs };
      void refreshRateLimits({
        environmentId,
        input: { instanceId },
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestIfStale();
      }
    };

    requestIfStale();
    window.addEventListener("focus", requestIfStale);
    window.addEventListener("pageshow", requestIfStale);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", requestIfStale);
      window.removeEventListener("pageshow", requestIfStale);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [environmentId, instanceId, refreshRateLimits, snapshot]);

  return snapshot;
}
