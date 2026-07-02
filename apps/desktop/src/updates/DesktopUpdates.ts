import {
  DesktopUpdateChannelSchema,
  type DesktopPayloadUpdateState,
  type DesktopUpdateActionResult,
  type DesktopUpdateChannel,
  type DesktopUpdateCheckResult,
  type DesktopUpdateState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopPayloadUpdates from "./DesktopPayloadUpdates.ts";
import { payloadUpdateStateToDesktopUpdateState } from "./payloadUpdateState.ts";

// This fork delivers desktop updates exclusively through the in-place payload
// hot-update channel (JS-only server + web bundle swap, applied on a clean app
// relaunch — see DesktopPayloadUpdates). The electron-installer auto-updater is
// intentionally not wired up: there is no update feed, no background installer
// poller, and no full-package download.
//
// DesktopUpdates is the thin facade the renderer, menu, and IPC layer talk to.
// It maps the payload state onto the single `DesktopUpdateState` the UI consumes
// and owns the UPDATE_STATE_CHANNEL broadcast. A user-initiated download/install
// arms the staged payload and reports `requiresRelaunch`, which the IPC layer
// turns into an app relaunch.

export class DesktopUpdateChannelPersistenceError extends Schema.TaggedErrorClass<DesktopUpdateChannelPersistenceError>()(
  "DesktopUpdateChannelPersistenceError",
  {
    channel: DesktopUpdateChannelSchema,
    cause: Schema.instanceOf(DesktopAppSettings.DesktopSettingsWriteError),
  },
) {
  override get message(): string {
    return `Failed to persist the ${this.channel} desktop update channel.`;
  }
}

export type DesktopUpdateConfigureError = never;

export const DesktopUpdateSetChannelError = DesktopUpdateChannelPersistenceError;
export type DesktopUpdateSetChannelError = DesktopUpdateChannelPersistenceError;
export const isDesktopUpdateSetChannelError = Schema.is(DesktopUpdateChannelPersistenceError);

export class DesktopUpdates extends Context.Service<
  DesktopUpdates,
  {
    readonly getState: Effect.Effect<DesktopUpdateState>;
    readonly emitState: Effect.Effect<void>;
    readonly disabledReason: Effect.Effect<Option.Option<string>>;
    readonly configure: Effect.Effect<void, DesktopUpdateConfigureError, Scope.Scope>;
    readonly setChannel: (
      channel: DesktopUpdateChannel,
    ) => Effect.Effect<DesktopUpdateState, DesktopUpdateSetChannelError>;
    readonly check: (reason: string) => Effect.Effect<DesktopUpdateCheckResult>;
    readonly download: Effect.Effect<DesktopUpdateActionResult>;
    readonly install: Effect.Effect<DesktopUpdateActionResult>;
  }
>()("@t3tools/desktop/updates/DesktopUpdates") {}

const { logInfo: logUpdaterInfo } = DesktopObservability.makeComponentLogger("desktop-updater");

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const payloadUpdates = yield* DesktopPayloadUpdates.DesktopPayloadUpdates;

  const channelRef = yield* Ref.make<DesktopUpdateChannel>(
    environment.defaultDesktopSettings.updateChannel,
  );

  // The renderer consumes a single update state, always the in-place payload
  // mechanism (there is no installer state to merge in).
  const getState: Effect.Effect<DesktopUpdateState> = Effect.gen(function* () {
    const payload = yield* payloadUpdates.refreshCurrentVersion;
    const channel = yield* Ref.get(channelRef);
    return payloadUpdateStateToDesktopUpdateState(payload, {
      channel,
      runtimeInfo: environment.runtimeInfo,
    });
  });

  const emitState = getState.pipe(
    Effect.flatMap((state) => electronWindow.sendAll(IpcChannels.UPDATE_STATE_CHANNEL, state)),
  );

  const disabledReason = payloadUpdates.getState.pipe(
    Effect.map((payload) =>
      payload.enabled
        ? Option.none<string>()
        : Option.some(payload.message ?? "Updates are not available right now."),
    ),
  );

  // A staged payload that armed its pending pointer needs a relaunch to take
  // effect; the IPC layer turns `requiresRelaunch` into an app relaunch.
  const isArmed = (payload: DesktopPayloadUpdateState): boolean =>
    payload.status === "staged" && payload.stagedVersion !== null;

  return DesktopUpdates.of({
    getState,
    emitState,
    disabledReason,
    configure: Effect.gen(function* () {
      const settings = yield* desktopSettings.get;
      yield* Ref.set(channelRef, settings.updateChannel);

      // Re-broadcast the merged state whenever the payload side changes so the
      // button reflects payload availability/progress without the payload
      // service emitting to the renderer itself.
      yield* payloadUpdates.changes.pipe(
        Stream.runForEach(() => emitState),
        Effect.forkScoped,
      );

      yield* emitState;
      yield* logUpdaterInfo("desktop updates configured (payload hot-update only)", {
        channel: settings.updateChannel,
      });
    }).pipe(Effect.withSpan("desktop.updates.configure")),
    setChannel: Effect.fn("desktop.updates.setChannel")(function* (
      nextChannel: DesktopUpdateChannel,
    ) {
      yield* Effect.annotateCurrentSpan({ channel: nextChannel });
      const currentChannel = yield* Ref.get(channelRef);
      if (nextChannel === currentChannel) {
        return yield* getState;
      }

      yield* desktopSettings
        .setUpdateChannel(nextChannel)
        .pipe(
          Effect.mapError(
            (cause) => new DesktopUpdateChannelPersistenceError({ channel: nextChannel, cause }),
          ),
        );
      yield* Ref.set(channelRef, nextChannel);
      yield* emitState;
      return yield* getState;
    }),
    check: Effect.fn("desktop.updates.check")(function* (reason: string) {
      yield* Effect.annotateCurrentSpan({ reason });
      const payload = yield* payloadUpdates.check(reason);
      return {
        checked: payload.enabled,
        state: yield* getState,
      } satisfies DesktopUpdateCheckResult;
    }),
    // The payload auto-downloads in the background; a manual "download" (only
    // surfaced after a failed attempt) re-stages and arms in one go. The app
    // then relaunches to activate it (see `install`).
    download: Effect.gen(function* () {
      const prepared = yield* payloadUpdates.update;
      const armed = isArmed(prepared);
      return {
        accepted: true,
        completed: false,
        requiresRelaunch: armed,
        state: yield* getState,
      } satisfies DesktopUpdateActionResult;
    }).pipe(Effect.withSpan("desktop.updates.download")),
    // Single-click apply (VSCode-style): the payload is already staged, so arm
    // the `pending` pointer and signal the IPC layer to do a full app relaunch;
    // the fresh launch promotes the payload. Fall back to a download+arm if it
    // somehow is not staged yet.
    install: Effect.gen(function* () {
      const payload = yield* payloadUpdates.getState;
      const prepared =
        payload.status === "staged" ? yield* payloadUpdates.apply : yield* payloadUpdates.update;
      const armed = isArmed(prepared);
      return {
        accepted: armed,
        // The update only completes once the relaunch finishes, so the action
        // itself never reports "completed"; the IPC layer drives the relaunch.
        completed: false,
        requiresRelaunch: armed,
        state: yield* getState,
      } satisfies DesktopUpdateActionResult;
    }).pipe(Effect.withSpan("desktop.updates.install")),
  });
});

export const layer = Layer.effect(DesktopUpdates, make);
