/**
 * Persistent, per-subscription cache of the freshest quota/rate-limit snapshot
 * we've ever observed for a provider instance.
 *
 * Live rate-limit data only reaches the client over the per-thread detail
 * subscription, which is evicted when a conversation goes idle (see
 * `selectLatestRateLimitActivitiesForInstance`). Without persistence the quota
 * meter would fall back to "no data" after a reload or once every conversation
 * on a subscription has been evicted. Mirroring the freshest snapshot into
 * localStorage, keyed by instance id, lets the meter keep showing the most
 * up-to-date figures we have for the subscription even before any conversation
 * has streamed fresh usage this session.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { sanitizeRateLimitSnapshot, type RateLimitSnapshot } from "./lib/rateLimits";

const RATE_LIMIT_SNAPSHOT_STORAGE_KEY = "t3code:rate-limit-snapshots:v1";
const RATE_LIMIT_SNAPSHOT_STORAGE_VERSION = 1;

interface RateLimitSnapshotStoreState {
  byInstanceId: Record<string, RateLimitSnapshot>;
  /**
   * Record a snapshot for an instance, but only when it is strictly newer than
   * whatever is stored — so persistence never regresses to older figures and
   * repeated calls with the same snapshot are no-ops (no render churn).
   */
  record: (instanceId: string, snapshot: RateLimitSnapshot) => void;
}

export function migratePersistedRateLimitSnapshots(persistedState: unknown): {
  byInstanceId: Record<string, RateLimitSnapshot>;
} {
  if (
    !persistedState ||
    typeof persistedState !== "object" ||
    !("byInstanceId" in persistedState)
  ) {
    return { byInstanceId: {} };
  }
  const raw = (persistedState as { byInstanceId: unknown }).byInstanceId;
  if (!raw || typeof raw !== "object") {
    return { byInstanceId: {} };
  }
  const byInstanceId: Record<string, RateLimitSnapshot> = {};
  for (const [instanceId, value] of Object.entries(raw as Record<string, unknown>)) {
    const snapshot = sanitizeRateLimitSnapshot(value);
    if (snapshot) {
      byInstanceId[instanceId] = snapshot;
    }
  }
  return { byInstanceId };
}

export const useRateLimitSnapshotStore = create<RateLimitSnapshotStoreState>()(
  persist(
    (set) => ({
      byInstanceId: {},
      record: (instanceId, snapshot) =>
        set((state) => {
          const existing = state.byInstanceId[instanceId];
          if (existing && Date.parse(existing.updatedAt) >= Date.parse(snapshot.updatedAt)) {
            return state;
          }
          return {
            byInstanceId: { ...state.byInstanceId, [instanceId]: snapshot },
          };
        }),
    }),
    {
      name: RATE_LIMIT_SNAPSHOT_STORAGE_KEY,
      version: RATE_LIMIT_SNAPSHOT_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byInstanceId: state.byInstanceId }),
      migrate: migratePersistedRateLimitSnapshots,
    },
  ),
);

export function selectPersistedRateLimitSnapshot(
  byInstanceId: Record<string, RateLimitSnapshot>,
  instanceId: string | null | undefined,
): RateLimitSnapshot | null {
  if (!instanceId) return null;
  return byInstanceId[instanceId] ?? null;
}
