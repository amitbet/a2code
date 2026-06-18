import { beforeEach, describe, expect, it } from "vitest";
import {
  migratePersistedRateLimitSnapshots,
  selectPersistedRateLimitSnapshot,
  useRateLimitSnapshotStore,
} from "./rateLimitSnapshotStore";

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
    expect(migratePersistedRateLimitSnapshots(null)).toEqual({ byInstanceId: {} });
    expect(migratePersistedRateLimitSnapshots({})).toEqual({ byInstanceId: {} });
    expect(migratePersistedRateLimitSnapshots({ byInstanceId: 7 })).toEqual({ byInstanceId: {} });
  });

  it("drops entries that don't sanitize and keeps valid ones", () => {
    const result = migratePersistedRateLimitSnapshots({
      byInstanceId: {
        claude: newer,
        broken: { updatedAt: "nope", windows: [] },
      },
    });
    expect(Object.keys(result.byInstanceId)).toEqual(["claude"]);
    expect(result.byInstanceId.claude?.windows[0]?.usedPercent).toBe(36);
  });
});

describe("useRateLimitSnapshotStore.record", () => {
  beforeEach(() => {
    useRateLimitSnapshotStore.setState({ byInstanceId: {} });
  });

  it("stores a first snapshot and only overwrites with strictly newer data", () => {
    const { record } = useRateLimitSnapshotStore.getState();
    record("claude", older as never);
    expect(
      selectPersistedRateLimitSnapshot(useRateLimitSnapshotStore.getState().byInstanceId, "claude")
        ?.updatedAt,
    ).toBe(older.updatedAt);

    record("claude", newer as never);
    expect(
      selectPersistedRateLimitSnapshot(useRateLimitSnapshotStore.getState().byInstanceId, "claude")
        ?.updatedAt,
    ).toBe(newer.updatedAt);

    // Older (and equal) updates are ignored and keep the same object reference.
    const before = useRateLimitSnapshotStore.getState().byInstanceId;
    record("claude", older as never);
    expect(useRateLimitSnapshotStore.getState().byInstanceId).toBe(before);
  });
});
