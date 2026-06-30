import type { DesktopPayloadUpdateState, DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { createInitialDesktopUpdateState } from "./updateMachine.ts";
import { mergeDesktopUpdateState } from "./updateMerge.ts";

const runtimeInfo = {
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
} as const;

const installerState = (overrides: Partial<DesktopUpdateState> = {}): DesktopUpdateState => ({
  ...createInitialDesktopUpdateState("1.0.0", runtimeInfo, "latest"),
  enabled: true,
  status: "idle",
  ...overrides,
});

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

describe("mergeDesktopUpdateState", () => {
  it("passes the installer state through when no payload update is on offer", () => {
    const installer = installerState({ status: "available", availableVersion: "2.0.0" });
    const merged = mergeDesktopUpdateState(installer, payloadState({ status: "up-to-date" }));
    expect(merged.kind).toBe("installer");
    expect(merged.status).toBe("available");
    expect(merged.availableVersion).toBe("2.0.0");
  });

  it("prefers the in-place payload when one is available, overriding the installer", () => {
    const installer = installerState({ status: "available", availableVersion: "2.0.0" });
    const merged = mergeDesktopUpdateState(
      installer,
      payloadState({ status: "available", availableVersion: "1.5.0" }),
    );
    // Auto-download is starting, so "available" surfaces as a busy state.
    expect(merged.kind).toBe("in-place");
    expect(merged.status).toBe("downloading");
    expect(merged.availableVersion).toBe("1.5.0");
  });

  it("maps payload downloading to a busy state with progress", () => {
    const merged = mergeDesktopUpdateState(
      installerState(),
      payloadState({ status: "downloading", availableVersion: "1.5.0", downloadPercent: 42 }),
    );
    expect(merged.kind).toBe("in-place");
    expect(merged.status).toBe("downloading");
    expect(merged.downloadPercent).toBe(42);
  });

  it("maps a staged payload to the actionable downloaded status", () => {
    const merged = mergeDesktopUpdateState(
      installerState(),
      payloadState({ status: "staged", availableVersion: "1.5.0", stagedVersion: "1.5.0" }),
    );
    expect(merged.kind).toBe("in-place");
    expect(merged.status).toBe("downloaded");
    expect(merged.downloadedVersion).toBe("1.5.0");
  });

  it("surfaces a failed user-initiated payload update with retry", () => {
    const merged = mergeDesktopUpdateState(
      installerState(),
      payloadState({ status: "error", availableVersion: "1.5.0", message: "checksum" }),
    );
    expect(merged.kind).toBe("in-place");
    expect(merged.status).toBe("error");
    expect(merged.errorContext).toBe("download");
    expect(merged.message).toBe("checksum");
    expect(merged.canRetry).toBe(true);
  });

  it("does not let a background payload check error hijack the installer", () => {
    const installer = installerState({ status: "available", availableVersion: "2.0.0" });
    const merged = mergeDesktopUpdateState(
      installer,
      payloadState({ status: "error", availableVersion: null, message: "offline" }),
    );
    expect(merged.kind).toBe("installer");
    expect(merged.status).toBe("available");
    expect(merged.availableVersion).toBe("2.0.0");
  });

  it("ignores the payload channel entirely when it is disabled", () => {
    const installer = installerState({ status: "available", availableVersion: "2.0.0" });
    const merged = mergeDesktopUpdateState(
      installer,
      payloadState({ enabled: false, status: "available", availableVersion: "1.5.0" }),
    );
    expect(merged.kind).toBe("installer");
    expect(merged.availableVersion).toBe("2.0.0");
  });
});
