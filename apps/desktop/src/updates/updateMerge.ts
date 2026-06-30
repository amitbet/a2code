import type { DesktopPayloadUpdateState, DesktopUpdateState } from "@t3tools/contracts";

/**
 * Merge the electron-installer update state with the in-place payload update
 * state into the single `DesktopUpdateState` the renderer consumes.
 *
 * The button prefers the lightweight in-place payload update whenever one is
 * being auto-downloaded (available / downloading), staged and ready to apply,
 * or a user-initiated attempt failed (error with a known version). Background
 * payload detection errors — which have no `availableVersion` — never hijack
 * the button from a working installer flow. In every other case the installer
 * state passes through unchanged.
 *
 * The payload is auto-downloaded in the background, so a staged payload maps to
 * the actionable "downloaded" status: the button then shows a single
 * "Restart to update" action that applies it (VSCode-style, no confirmation).
 *
 * Pure and synchronous so it can be unit-tested without the Effect runtime.
 */
export function mergeDesktopUpdateState(
  installer: DesktopUpdateState,
  payload: DesktopPayloadUpdateState,
): DesktopUpdateState {
  if (!payload.enabled || !payloadTakesPrecedence(payload)) {
    return { ...installer, kind: "installer" };
  }

  const base: DesktopUpdateState = {
    ...installer,
    kind: "in-place",
    availableVersion: payload.availableVersion,
    downloadedVersion: null,
    downloadPercent: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };

  switch (payload.status) {
    case "staged":
      // Auto-downloaded and ready: offer the one-click apply action.
      return {
        ...base,
        status: "downloaded",
        downloadedVersion: payload.stagedVersion,
        downloadPercent: 100,
      };
    case "downloading":
      return { ...base, status: "downloading", downloadPercent: payload.downloadPercent };
    case "error":
      return {
        ...base,
        status: "error",
        message: payload.message,
        errorContext: "download",
        canRetry: payload.availableVersion !== null,
      };
    default:
      // "available": detected, auto-download is starting — show as busy.
      return { ...base, status: "downloading", downloadPercent: payload.downloadPercent };
  }
}

function payloadTakesPrecedence(payload: DesktopPayloadUpdateState): boolean {
  switch (payload.status) {
    case "available":
    case "downloading":
    case "staged":
      return true;
    case "error":
      // Only a failed user-initiated update (which retains the target version)
      // should take over the button; a failed background check should not.
      return payload.availableVersion !== null;
    default:
      return false;
  }
}
