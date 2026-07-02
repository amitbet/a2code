import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { DesktopPayloadUpdateState, DesktopUpdateState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopPayloadUpdates from "./DesktopPayloadUpdates.ts";
import * as DesktopUpdates from "./DesktopUpdates.ts";

const flushCallbacks = Effect.yieldNow;

const basePayloadState: DesktopPayloadUpdateState = {
  enabled: true,
  status: "idle",
  shellVersion: "1.2.3",
  currentPayloadVersion: null,
  availableVersion: null,
  stagedVersion: null,
  downloadPercent: null,
  checkedAt: null,
  message: null,
};

const payloadState = (
  overrides: Partial<DesktopPayloadUpdateState> = {},
): DesktopPayloadUpdateState => ({ ...basePayloadState, ...overrides });

interface UpdatesHarnessOptions {
  readonly initialPayload?: DesktopPayloadUpdateState;
  readonly onCheck?: (state: DesktopPayloadUpdateState) => DesktopPayloadUpdateState;
  readonly onRefresh?: (state: DesktopPayloadUpdateState) => DesktopPayloadUpdateState;
  readonly onUpdate?: (state: DesktopPayloadUpdateState) => DesktopPayloadUpdateState;
  readonly onApply?: (state: DesktopPayloadUpdateState) => DesktopPayloadUpdateState;
  readonly setUpdateChannelError?: DesktopAppSettings.DesktopSettingsWriteError;
}

// Returns an Effect so the controllable payload SubscriptionRef is allocated
// inside the Effect runtime (no manual runSync in tests). The ref backs the
// stubbed payload service and lets the test body drive state changes to exercise
// the re-broadcast wiring.
const makeHarness = (options: UpdatesHarnessOptions = {}) =>
  Effect.gen(function* () {
    const sentStates: DesktopUpdateState[] = [];
    const calls = { check: 0, update: 0, apply: 0 };
    const payloadRef = yield* SubscriptionRef.make(options.initialPayload ?? basePayloadState);

    const transition = (
      f?: (state: DesktopPayloadUpdateState) => DesktopPayloadUpdateState,
    ): Effect.Effect<DesktopPayloadUpdateState> =>
      f ? SubscriptionRef.updateAndGet(payloadRef, f) : SubscriptionRef.get(payloadRef);

    const payloadLayer = Layer.succeed(DesktopPayloadUpdates.DesktopPayloadUpdates, {
      getState: SubscriptionRef.get(payloadRef),
      refreshCurrentVersion: transition(options.onRefresh),
      changes: SubscriptionRef.changes(payloadRef),
      configure: Effect.void,
      check: () =>
        Effect.sync(() => {
          calls.check += 1;
        }).pipe(Effect.andThen(transition(options.onCheck))),
      download: Effect.sync(() => {
        calls.update += 1;
      }).pipe(Effect.andThen(transition(options.onUpdate))),
      apply: Effect.sync(() => {
        calls.apply += 1;
      }).pipe(Effect.andThen(transition(options.onApply))),
      update: Effect.sync(() => {
        calls.update += 1;
      }).pipe(Effect.andThen(transition(options.onUpdate))),
    } satisfies DesktopPayloadUpdates.DesktopPayloadUpdates["Service"]);

    const windowLayer = Layer.succeed(ElectronWindow.ElectronWindow, {
      create: () => Effect.die("unexpected BrowserWindow creation"),
      main: Effect.succeed(Option.none()),
      currentMainOrFirst: Effect.succeed(Option.none()),
      focusedMainOrFirst: Effect.succeed(Option.none()),
      setMain: () => Effect.void,
      clearMain: () => Effect.void,
      reveal: () => Effect.void,
      sendAll: (_channel, state) =>
        Effect.sync(() => {
          sentStates.push(state as DesktopUpdateState);
        }),
      destroyAll: Effect.void,
      syncAllAppearance: () => Effect.void,
    } satisfies ElectronWindow.ElectronWindow["Service"]);

    const configEnv = {
      T3CODE_HOME: `/tmp/t3-desktop-updates-test-${process.pid}`,
    };

    const environmentLayer = DesktopEnvironment.layer({
      dirname: "/repo/apps/desktop/src",
      homeDirectory: `/tmp/t3-desktop-updates-home-${process.pid}`,
      platform: "darwin",
      processArch: "x64",
      appVersion: "1.2.3",
      appPath: "/repo",
      isPackaged: true,
      resourcesPath: "/missing/resources",
      runningUnderArm64Translation: false,
    }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest(configEnv))));

    const setUpdateChannelError = options.setUpdateChannelError;
    const settingsLayer = setUpdateChannelError
      ? Layer.succeed(DesktopAppSettings.DesktopAppSettings, {
          get: Effect.succeed(DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS),
          load: Effect.succeed(DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS),
          setServerExposureMode: () => Effect.die("unexpected server exposure update"),
          setTailscaleServe: () => Effect.die("unexpected Tailscale Serve update"),
          setUpdateChannel: () => Effect.fail(setUpdateChannelError),
          setWslBackendEnabled: () => Effect.die("unexpected WSL backend toggle"),
          setWslDistro: () => Effect.die("unexpected WSL distro change"),
          setWslOnly: () => Effect.die("unexpected WSL-only toggle"),
          applyWslWindowsFallback: Effect.die("unexpected WSL Windows fallback"),
          applyWslWindowsFallbackInMemory: Effect.die("unexpected WSL Windows fallback"),
        } satisfies DesktopAppSettings.DesktopAppSettings["Service"])
      : DesktopAppSettings.layer;

    const layer = DesktopUpdates.layer.pipe(
      Layer.provideMerge(windowLayer),
      Layer.provideMerge(payloadLayer),
      Layer.provideMerge(settingsLayer),
      Layer.provideMerge(DesktopConfig.layerTest(configEnv)),
      Layer.provideMerge(environmentLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    return {
      layer,
      sentStates,
      calls,
      setPayloadState: (state: DesktopPayloadUpdateState) => SubscriptionRef.set(payloadRef, state),
    };
  });

describe("DesktopUpdates", () => {
  it.effect("configures the payload-only updater and broadcasts the initial state", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        const state = yield* updates.getState;
        assert.equal(state.enabled, true);
        assert.equal(state.status, "idle");
        assert.equal(state.kind, "in-place");
        assert.equal(state.channel, "latest");
        assert.equal(state.currentVersion, "1.2.3");
        assert.isAbove(harness.sentStates.length, 0);
        assert.equal(harness.sentStates.at(-1)?.kind, "in-place");
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("maps a staged payload to an actionable downloaded state", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        initialPayload: payloadState({
          status: "staged",
          availableVersion: "1.3.0",
          stagedVersion: "1.3.0",
        }),
      });
      yield* Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        const state = yield* updates.getState;
        assert.equal(state.kind, "in-place");
        assert.equal(state.status, "downloaded");
        assert.equal(state.downloadedVersion, "1.3.0");
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("refreshes the running content version before returning update state", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        onRefresh: (state) => ({ ...state, currentPayloadVersion: "1.2.4" }),
      });
      yield* Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        const state = yield* updates.getState;

        assert.equal(state.currentVersion, "1.2.4");
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("delegates check to the payload updater and returns its mapped state", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        onCheck: (state) => ({ ...state, status: "up-to-date", checkedAt: "2026-07-01T00:00:00Z" }),
      });
      yield* Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        const result = yield* updates.check("manual");
        assert.equal(harness.calls.check, 1);
        assert.equal(result.checked, true);
        assert.equal(result.state.status, "up-to-date");
        assert.equal(result.state.checkedAt, "2026-07-01T00:00:00Z");
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("download re-stages, arms, and requests a relaunch", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        onUpdate: (state) => ({
          ...state,
          status: "staged",
          availableVersion: "1.3.0",
          stagedVersion: "1.3.0",
        }),
      });
      yield* Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        const result = yield* updates.download;
        assert.equal(harness.calls.update, 1);
        assert.equal(result.accepted, true);
        assert.equal(result.completed, false);
        assert.equal(result.requiresRelaunch, true);
        assert.equal(result.state.status, "downloaded");
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("install applies a staged payload and requests a relaunch", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        initialPayload: payloadState({
          status: "staged",
          availableVersion: "1.3.0",
          stagedVersion: "1.3.0",
        }),
        // Apply keeps the payload staged (armed) until the relaunch promotes it.
        onApply: (state) => state,
      });
      yield* Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        const result = yield* updates.install;
        assert.equal(harness.calls.apply, 1);
        assert.equal(harness.calls.update, 0);
        assert.equal(result.accepted, true);
        assert.equal(result.completed, false);
        assert.equal(result.requiresRelaunch, true);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("install falls back to a download+arm when nothing is staged yet", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        onUpdate: (state) => ({
          ...state,
          status: "staged",
          availableVersion: "1.3.0",
          stagedVersion: "1.3.0",
        }),
      });
      yield* Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        const result = yield* updates.install;
        assert.equal(harness.calls.apply, 0);
        assert.equal(harness.calls.update, 1);
        assert.equal(result.requiresRelaunch, true);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("persists channel changes through the settings service", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        const state = yield* updates.setChannel("nightly");
        const persistedSettings = yield* settings.get;

        assert.equal(state.channel, "nightly");
        assert.equal(persistedSettings.updateChannel, "nightly");
        assert.equal(persistedSettings.updateChannelConfiguredByUser, true);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("does not persist an unchanged update channel as a user preference", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        const state = yield* updates.setChannel("latest");
        const persistedSettings = yield* settings.get;

        assert.equal(state.channel, "latest");
        assert.equal(persistedSettings.updateChannel, "latest");
        assert.equal(persistedSettings.updateChannelConfiguredByUser, false);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("maps settings write failures to a typed channel persistence error", () =>
    Effect.gen(function* () {
      const diskFailure = new Error("disk exploded");
      const settingsFailure = new DesktopAppSettings.DesktopSettingsWriteError({
        operation: "replace-settings-file",
        path: "/tmp/settings.json",
        cause: diskFailure,
      });
      const harness = yield* makeHarness({ setUpdateChannelError: settingsFailure });
      yield* Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        const error = yield* updates.setChannel("nightly").pipe(Effect.flip);

        assert.instanceOf(error, DesktopUpdates.DesktopUpdateChannelPersistenceError);
        assert.isTrue(DesktopUpdates.isDesktopUpdateSetChannelError(error));
        assert.equal(error.channel, "nightly");
        assert.strictEqual(error.cause, settingsFailure);
        assert.equal(error.message, "Failed to persist the nightly desktop update channel.");
        assert.notInclude(error.message, diskFailure.message);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("reports a disabled reason when payload updates are disabled", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        initialPayload: payloadState({
          enabled: false,
          status: "disabled",
          message: "Payload updates are disabled by T3CODE_DISABLE_PAYLOAD_UPDATE.",
        }),
      });
      yield* Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        const reason = yield* updates.disabledReason;
        assert.isTrue(Option.isSome(reason));
        if (Option.isSome(reason)) {
          assert.include(reason.value, "T3CODE_DISABLE_PAYLOAD_UPDATE");
        }
        const state = yield* updates.getState;
        assert.equal(state.enabled, false);
        assert.equal(state.status, "disabled");
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("re-broadcasts the merged state when the payload state changes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;

        const before = harness.sentStates.length;
        yield* harness.setPayloadState(
          payloadState({ status: "staged", availableVersion: "1.3.0", stagedVersion: "1.3.0" }),
        );

        let attempts = 0;
        while (harness.sentStates.length === before && attempts < 100) {
          yield* flushCallbacks;
          attempts += 1;
        }

        assert.isAbove(harness.sentStates.length, before);
        assert.equal(harness.sentStates.at(-1)?.status, "downloaded");
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );
});
