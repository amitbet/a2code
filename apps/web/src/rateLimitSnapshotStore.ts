/**
 * Persistent, per-subscription cache of the freshest quota/rate-limit snapshot
 * we've ever observed for an environment/provider pair.
 *
 * Live rate-limit data only reaches the client over the per-thread detail
 * subscription, which is evicted when a conversation goes idle (see
 * `useLatestRateLimitActivitiesForEnvironmentInstance`). Without persistence the quota
 * meter would fall back to "no data" after a reload or once every conversation
 * on a subscription has been evicted. Mirroring the freshest snapshot into
 * localStorage, keyed by environment and instance id, lets the meter keep
 * showing the most up-to-date figures we have for that account even before any
 * conversation has streamed fresh usage this session.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";

import { resolveStorage } from "./lib/storage";
import { sanitizeRateLimitSnapshot, type RateLimitSnapshot } from "./lib/rateLimits";

const RATE_LIMIT_SNAPSHOT_STORAGE_KEY = "t3code:rate-limit-snapshots:v1";
const RATE_LIMIT_SNAPSHOT_STORAGE_VERSION = 2;

interface RateLimitSnapshotStoreState {
  byEnvironmentInstanceKey: Record<string, RateLimitSnapshot>;
  /**
   * Record a snapshot for an environment/provider pair, but only when it is
   * strictly newer than whatever is stored — so persistence never regresses to
   * older figures and repeated calls with the same snapshot are no-ops.
   */
  record: (
    environmentId: EnvironmentId,
    instanceId: ProviderInstanceId,
    snapshot: RateLimitSnapshot,
  ) => void;
}

export function migratePersistedRateLimitSnapshots(persistedState: unknown): {
  byEnvironmentInstanceKey: Record<string, RateLimitSnapshot>;
} {
  if (
    !persistedState ||
    typeof persistedState !== "object" ||
    !("byEnvironmentInstanceKey" in persistedState)
  ) {
    return { byEnvironmentInstanceKey: {} };
  }
  const raw = (persistedState as { byEnvironmentInstanceKey: unknown }).byEnvironmentInstanceKey;
  if (!raw || typeof raw !== "object") {
    return { byEnvironmentInstanceKey: {} };
  }
  const byEnvironmentInstanceKey: Record<string, RateLimitSnapshot> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const snapshot = sanitizeRateLimitSnapshot(value);
    if (snapshot) {
      byEnvironmentInstanceKey[key] = snapshot;
    }
  }
  return { byEnvironmentInstanceKey };
}

export function rateLimitSnapshotKey(
  environmentId: EnvironmentId,
  instanceId: ProviderInstanceId,
): string {
  return `${environmentId}:${instanceId}`;
}

export const useRateLimitSnapshotStore = create<RateLimitSnapshotStoreState>()(
  persist(
    (set) => ({
      byEnvironmentInstanceKey: {},
      record: (environmentId, instanceId, snapshot) =>
        set((state) => {
          const key = rateLimitSnapshotKey(environmentId, instanceId);
          const existing = state.byEnvironmentInstanceKey[key];
          if (existing && Date.parse(existing.updatedAt) >= Date.parse(snapshot.updatedAt)) {
            return state;
          }
          return {
            byEnvironmentInstanceKey: {
              ...state.byEnvironmentInstanceKey,
              [key]: snapshot,
            },
          };
        }),
    }),
    {
      name: RATE_LIMIT_SNAPSHOT_STORAGE_KEY,
      version: RATE_LIMIT_SNAPSHOT_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byEnvironmentInstanceKey: state.byEnvironmentInstanceKey }),
      migrate: migratePersistedRateLimitSnapshots,
    },
  ),
);

export function selectPersistedRateLimitSnapshot(
  byEnvironmentInstanceKey: Record<string, RateLimitSnapshot>,
  environmentId: EnvironmentId | null | undefined,
  instanceId: ProviderInstanceId | null | undefined,
): RateLimitSnapshot | null {
  if (!environmentId || !instanceId) return null;
  return byEnvironmentInstanceKey[rateLimitSnapshotKey(environmentId, instanceId)] ?? null;
}
