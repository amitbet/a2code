import type {
  AuthClientMetadataDeviceType,
  OrchestrationEvent,
  OrchestrationThreadDetailSnapshot,
} from "@t3tools/contracts";

const isMobileClient = (deviceType: AuthClientMetadataDeviceType): boolean =>
  deviceType === "mobile";

export function shouldSendThreadEventToClient(
  event: OrchestrationEvent,
  deviceType: AuthClientMetadataDeviceType,
): boolean {
  return !(
    isMobileClient(deviceType) &&
    event.type === "thread.activity-appended" &&
    event.payload.activity.kind === "account.rate-limits.updated"
  );
}

export function projectThreadSnapshotForClient(
  snapshot: OrchestrationThreadDetailSnapshot,
  deviceType: AuthClientMetadataDeviceType,
): OrchestrationThreadDetailSnapshot {
  if (!isMobileClient(deviceType)) {
    return snapshot;
  }

  const activities = snapshot.thread.activities.filter(
    (activity) => activity.kind !== "account.rate-limits.updated",
  );
  if (activities.length === snapshot.thread.activities.length) {
    return snapshot;
  }

  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      activities,
    },
  };
}
