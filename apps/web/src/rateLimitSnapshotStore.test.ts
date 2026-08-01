import { beforeEach, describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import {
  migratePersistedRateLimitSnapshots,
  rateLimitSnapshotKey,
  selectPersistedRateLimitSnapshot,
  useRateLimitSnapshotStore,
} from "./rateLimitSnapshotStore";

const environmentM1 = EnvironmentId.make("environment-m1");
const environmentM4 = EnvironmentId.make("environment-m4");
const claude = ProviderInstanceId.make("claude");

const older = {
  updatedAt: "2026-06-02T00:00:00.000Z",
  windows: [{ kind: "spend", label: "Spend", usedPercent: 35 }],
};
const newer = {
  updatedAt: "2026-06-03T00:00:00.000Z",
  windows: [{ kind: "spend", label: "Spend", usedPercent: 36 }],
};

describe("migratePersistedRateLimitSnapshots", () => {
  it("returns an empty map for malformed state", () => {
    expect(migratePersistedRateLimitSnapshots(null)).toEqual({ byEnvironmentInstanceKey: {} });
    expect(migratePersistedRateLimitSnapshots({})).toEqual({ byEnvironmentInstanceKey: {} });
    expect(migratePersistedRateLimitSnapshots({ byEnvironmentInstanceKey: 7 })).toEqual({
      byEnvironmentInstanceKey: {},
    });
  });

  it("drops entries that don't sanitize and keeps valid ones", () => {
    const result = migratePersistedRateLimitSnapshots({
      byEnvironmentInstanceKey: {
        claude: newer,
        broken: { updatedAt: "nope", windows: [] },
      },
    });
    expect(Object.keys(result.byEnvironmentInstanceKey)).toEqual(["claude"]);
    expect(result.byEnvironmentInstanceKey.claude?.windows[0]?.usedPercent).toBe(36);
  });

  it("does not revive the old instance-only cache", () => {
    expect(migratePersistedRateLimitSnapshots({ byInstanceId: { claude: newer } })).toEqual({
      byEnvironmentInstanceKey: {},
    });
  });
});

describe("useRateLimitSnapshotStore.record", () => {
  beforeEach(() => {
    useRateLimitSnapshotStore.setState({ byEnvironmentInstanceKey: {} });
  });

  it("stores a first snapshot and only overwrites with strictly newer data", () => {
    const { record } = useRateLimitSnapshotStore.getState();
    record(environmentM1, claude, older as never);
    expect(
      selectPersistedRateLimitSnapshot(
        useRateLimitSnapshotStore.getState().byEnvironmentInstanceKey,
        environmentM1,
        claude,
      )?.updatedAt,
    ).toBe(older.updatedAt);

    record(environmentM1, claude, newer as never);
    expect(
      selectPersistedRateLimitSnapshot(
        useRateLimitSnapshotStore.getState().byEnvironmentInstanceKey,
        environmentM1,
        claude,
      )?.updatedAt,
    ).toBe(newer.updatedAt);

    // Older (and equal) updates are ignored and keep the same object reference.
    const before = useRateLimitSnapshotStore.getState().byEnvironmentInstanceKey;
    record(environmentM1, claude, older as never);
    expect(useRateLimitSnapshotStore.getState().byEnvironmentInstanceKey).toBe(before);
  });

  it("keeps identical provider instances isolated by environment", () => {
    const { record } = useRateLimitSnapshotStore.getState();
    record(environmentM1, claude, older as never);
    record(environmentM4, claude, newer as never);

    const snapshots = useRateLimitSnapshotStore.getState().byEnvironmentInstanceKey;
    expect(snapshots[rateLimitSnapshotKey(environmentM1, claude)]?.updatedAt).toBe(older.updatedAt);
    expect(snapshots[rateLimitSnapshotKey(environmentM4, claude)]?.updatedAt).toBe(newer.updatedAt);
    expect(selectPersistedRateLimitSnapshot(snapshots, environmentM1, claude)?.updatedAt).toBe(
      older.updatedAt,
    );
  });
});
