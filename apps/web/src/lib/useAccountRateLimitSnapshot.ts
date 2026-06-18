import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectLatestRateLimitActivitiesForInstance, useStore } from "../store";
import {
  selectPersistedRateLimitSnapshot,
  useRateLimitSnapshotStore,
} from "../rateLimitSnapshotStore";
import {
  deriveLatestRateLimitSnapshot,
  freshestRateLimitSnapshot,
  type RateLimitSnapshot,
} from "./rateLimits";

/**
 * Latest quota/rate-limit snapshot for a provider instance (subscription),
 * merged across every conversation bound to that instance rather than read
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
  instanceId: string | null | undefined,
): RateLimitSnapshot | null {
  const activities = useStore(useShallow(selectLatestRateLimitActivitiesForInstance(instanceId)));
  const live = useMemo(() => deriveLatestRateLimitSnapshot(activities), [activities]);

  const persisted = useRateLimitSnapshotStore((state) =>
    selectPersistedRateLimitSnapshot(state.byInstanceId, instanceId),
  );
  const record = useRateLimitSnapshotStore((state) => state.record);

  // Persist the freshest live snapshot. `record` no-ops unless it is strictly
  // newer than what's stored, so this can't loop on the resulting re-render.
  useEffect(() => {
    if (instanceId && live) {
      record(instanceId, live);
    }
  }, [instanceId, live, record]);

  return useMemo(() => freshestRateLimitSnapshot(live, persisted), [live, persisted]);
}
