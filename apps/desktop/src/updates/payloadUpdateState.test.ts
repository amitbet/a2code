import type { DesktopPayloadUpdateState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type DesktopUpdateStaticInfo,
  payloadUpdateStateToDesktopUpdateState,
} from "./payloadUpdateState.ts";

const staticInfo: DesktopUpdateStaticInfo = {
  channel: "latest",
  runtimeInfo: {
    hostArch: "x64",
    appArch: "x64",
    runningUnderArm64Translation: false,
  },
};

const payloadState = (
  overrides: Partial<DesktopPayloadUpdateState> = {},
): DesktopPayloadUpdateState => ({
  enabled: true,
  status: "idle",
  shellVersion: "1.0.0",
  currentPayloadVersion: null,
  availableVersion: null,
  stagedVersion: null,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  ...overrides,
});

describe("payloadUpdateStateToDesktopUpdateState", () => {
  it("always reports the in-place kind and carries static runtime info", () => {
    const state = payloadUpdateStateToDesktopUpdateState(payloadState(), staticInfo);
    expect(state.kind).toBe("in-place");
    expect(state.channel).toBe("latest");
    expect(state.hostArch).toBe("x64");
    expect(state.status).toBe("idle");
    expect(state.enabled).toBe(true);
  });

  it("reports the running server version from the active payload when applied", () => {
    const onShell = payloadUpdateStateToDesktopUpdateState(payloadState(), staticInfo);
    expect(onShell.currentVersion).toBe("1.0.0");

    const onPayload = payloadUpdateStateToDesktopUpdateState(
      payloadState({ currentPayloadVersion: "1.5.0" }),
      staticInfo,
    );
    expect(onPayload.currentVersion).toBe("1.5.0");
  });

  it("maps a disabled payload to a disabled state with its reason", () => {
    const state = payloadUpdateStateToDesktopUpdateState(
      payloadState({ enabled: false, status: "disabled", message: "off" }),
      staticInfo,
    );
    expect(state.enabled).toBe(false);
    expect(state.status).toBe("disabled");
    expect(state.message).toBe("off");
    expect(state.availableVersion).toBeNull();
  });

  it("surfaces an available payload as a busy downloading state (auto-download starts)", () => {
    const state = payloadUpdateStateToDesktopUpdateState(
      payloadState({ status: "available", availableVersion: "1.5.0" }),
      staticInfo,
    );
    expect(state.status).toBe("downloading");
    expect(state.availableVersion).toBe("1.5.0");
    expect(state.downloadPercent).toBeNull();
  });

  it("does not reuse stale staged progress for a newly available payload", () => {
    const state = payloadUpdateStateToDesktopUpdateState(
      payloadState({ status: "available", availableVersion: "1.6.0", downloadPercent: 100 }),
      staticInfo,
    );
    expect(state.status).toBe("downloading");
    expect(state.downloadPercent).toBeNull();
  });

  it("maps payload downloading to a busy state with progress", () => {
    const state = payloadUpdateStateToDesktopUpdateState(
      payloadState({ status: "downloading", availableVersion: "1.5.0", downloadPercent: 42 }),
      staticInfo,
    );
    expect(state.status).toBe("downloading");
    expect(state.downloadPercent).toBe(42);
  });

  it("maps a staged payload to the actionable downloaded status", () => {
    const state = payloadUpdateStateToDesktopUpdateState(
      payloadState({ status: "staged", availableVersion: "1.5.0", stagedVersion: "1.5.0" }),
      staticInfo,
    );
    expect(state.status).toBe("downloaded");
    expect(state.downloadedVersion).toBe("1.5.0");
    expect(state.downloadPercent).toBe(100);
  });

  it("clears the available version once the payload reports up-to-date", () => {
    const state = payloadUpdateStateToDesktopUpdateState(
      payloadState({ status: "up-to-date", checkedAt: "2026-07-01T00:00:00Z" }),
      staticInfo,
    );
    expect(state.status).toBe("up-to-date");
    expect(state.availableVersion).toBeNull();
    expect(state.checkedAt).toBe("2026-07-01T00:00:00Z");
  });

  it("surfaces a failed user-initiated payload update with retry", () => {
    const state = payloadUpdateStateToDesktopUpdateState(
      payloadState({ status: "error", availableVersion: "1.5.0", message: "checksum" }),
      staticInfo,
    );
    expect(state.status).toBe("error");
    expect(state.errorContext).toBe("download");
    expect(state.message).toBe("checksum");
    expect(state.canRetry).toBe(true);
  });

  it("does not offer retry for a failed background check with no target version", () => {
    const state = payloadUpdateStateToDesktopUpdateState(
      payloadState({ status: "error", availableVersion: null, message: "offline" }),
      staticInfo,
    );
    expect(state.status).toBe("error");
    expect(state.canRetry).toBe(false);
  });
});
