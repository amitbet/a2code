import type {
  AuthClientMetadataDeviceType,
  OrchestrationEvent,
  OrchestrationThreadDetailSnapshot,
} from "@t3tools/contracts";

import { projectThreadDetailSnapshot } from "./ActivityPayloadProjection.ts";

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

/**
 * The single entry point for turning a stored thread detail snapshot into the
 * one a given client receives. It applies the transport-wide payload
 * projection (`projectThreadDetailSnapshot`) and then the client-specific
 * trimming, so callers cannot accidentally ship a snapshot that skipped either
 * step.
 */
export function projectThreadSnapshotForClient(
  snapshot: OrchestrationThreadDetailSnapshot,
  deviceType: AuthClientMetadataDeviceType,
): OrchestrationThreadDetailSnapshot {
  const projected = projectThreadDetailSnapshot(snapshot);
  if (!isMobileClient(deviceType)) {
    return projected;
  }

  const activities = projected.thread.activities.filter(
    (activity) => activity.kind !== "account.rate-limits.updated",
  );
  if (activities.length === projected.thread.activities.length) {
    return projected;
  }

  return {
    ...projected,
    thread: {
      ...projected.thread,
      activities,
    },
  };
}
