import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export class DesktopState extends Context.Service<
  DesktopState,
  {
    readonly backendReady: Ref.Ref<boolean>;
    readonly quitting: Ref.Ref<boolean>;
    /**
     * Synchronously readable flag set while an update install is restarting the
     * app via `quitAndInstall`. The Electron `before-quit` handler must decide
     * whether to `preventDefault()` synchronously, so it cannot await a Ref;
     * this lets it recognise an install-driven quit and let it pass through
     * uninterrupted (backends are already stopped) instead of vetoing it and
     * re-running shutdown — which breaks electron-updater's install handshake.
     */
    readonly isInstallRestart: () => boolean;
    readonly markInstallRestart: Effect.Effect<void>;
    readonly clearInstallRestart: Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopState") {}

const make = Effect.gen(function* () {
  const backendReady = yield* Ref.make(false);
  const quitting = yield* Ref.make(false);
  const installRestart = { active: false };
  return DesktopState.of({
    backendReady,
    quitting,
    isInstallRestart: () => installRestart.active,
    markInstallRestart: Effect.sync(() => {
      installRestart.active = true;
    }),
    clearInstallRestart: Effect.sync(() => {
      installRestart.active = false;
    }),
  });
});

export const layer = Layer.effect(DesktopState, make);
