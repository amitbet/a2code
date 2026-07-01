import type {
  DesktopPayloadUpdateState,
  DesktopRuntimeInfo,
  DesktopUpdateChannel,
  DesktopUpdateState,
} from "@t3tools/contracts";

/** Static, mechanism-independent fields the renderer state always carries. */
export interface DesktopUpdateStaticInfo {
  readonly channel: DesktopUpdateChannel;
  readonly runtimeInfo: DesktopRuntimeInfo;
}

/**
 * Map the in-place payload update state onto the single `DesktopUpdateState`
 * the renderer consumes. This fork ships updates exclusively through the JS-only
 * payload hot-update channel, so the surfaced update is always `kind: "in-place"`
 * — there is no electron-installer state to merge in.
 *
 * The payload auto-downloads in the background, so a staged payload maps to the
 * actionable "downloaded" status: the button then shows a single "Restart to
 * update" action that applies it (VSCode-style, no confirmation).
 *
 * Pure and synchronous so it can be unit-tested without the Effect runtime.
 */
export function payloadUpdateStateToDesktopUpdateState(
  payload: DesktopPayloadUpdateState,
  info: DesktopUpdateStaticInfo,
): DesktopUpdateState {
  const base: DesktopUpdateState = {
    enabled: payload.enabled,
    status: "idle",
    kind: "in-place",
    channel: info.channel,
    // The running server version is the active payload when one is applied,
    // otherwise the shell-bundled payload.
    currentVersion: payload.currentPayloadVersion ?? payload.shellVersion,
    // The native shell version, independent of any applied payload.
    shellVersion: payload.shellVersion,
    hostArch: info.runtimeInfo.hostArch,
    appArch: info.runtimeInfo.appArch,
    runningUnderArm64Translation: info.runtimeInfo.runningUnderArm64Translation,
    availableVersion: payload.availableVersion,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: payload.checkedAt,
    message: null,
    errorContext: null,
    canRetry: false,
  };

  switch (payload.status) {
    case "disabled":
      return { ...base, status: "disabled", availableVersion: null, message: payload.message };
    case "idle":
      return base;
    case "checking":
      return { ...base, status: "checking" };
    case "up-to-date":
      return { ...base, status: "up-to-date", availableVersion: null };
    case "available":
      // Detected; the background auto-download is starting — show as busy.
      return { ...base, status: "downloading", downloadPercent: payload.downloadPercent };
    case "downloading":
      return { ...base, status: "downloading", downloadPercent: payload.downloadPercent };
    case "staged":
      // Auto-downloaded and ready: offer the one-click apply action.
      return {
        ...base,
        status: "downloaded",
        downloadedVersion: payload.stagedVersion,
        downloadPercent: 100,
      };
    case "error":
      return {
        ...base,
        status: "error",
        message: payload.message,
        errorContext: "download",
        // Only a failed user-initiated update (which retains the target version)
        // is retryable; a failed background check is not.
        canRetry: payload.availableVersion !== null,
      };
  }
}
