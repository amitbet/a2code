import {
  DesktopPayloadManifestSchema,
  type DesktopPayloadManifest,
  type DesktopPayloadUpdateState,
} from "@t3tools/contracts";
import { extractPayloadArchive } from "@t3tools/shared/payloadArchive";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import {
  type PayloadPointer,
  payloadVersionDir,
  readActivePayloadVersion,
  shellSatisfiesPayload,
  writePayloadPointer,
} from "./payloadLayout.ts";
import {
  computeSha256Hex,
  PAYLOAD_SIGNING_PUBLIC_KEY,
  verifyPayloadSignature,
} from "./payloadSigning.ts";

const STARTUP_DELAY = "25 seconds";
const POLL_INTERVAL = "30 minutes";

/**
 * Default manifest location: the latest stable GitHub release's payload
 * manifest asset. Mirrors the publish repository the full app updater targets
 * (`amitbet/a2code`). Override with `T3CODE_PAYLOAD_MANIFEST_URL`.
 */
const DEFAULT_PAYLOAD_MANIFEST_URL =
  "https://github.com/amitbet/a2code/releases/latest/download/payload-manifest.json";

const {
  logInfo: logPayloadInfo,
  logWarning: logPayloadWarning,
  logError: logPayloadError,
} = DesktopObservability.makeComponentLogger("desktop-payload-updater");

const currentIsoTimestamp = DateTime.now.pipe(Effect.map(DateTime.formatIso));

export class DesktopPayloadUpdates extends Context.Service<
  DesktopPayloadUpdates,
  {
    readonly getState: Effect.Effect<DesktopPayloadUpdateState>;
    /** Emits the latest payload-update state on every change (current value first). */
    readonly changes: Stream.Stream<DesktopPayloadUpdateState>;
    readonly configure: Effect.Effect<void, never, Scope.Scope>;
    readonly check: (reason: string) => Effect.Effect<DesktopPayloadUpdateState>;
    /** Download + verify + stage the newest compatible payload (no apply). */
    readonly download: Effect.Effect<DesktopPayloadUpdateState>;
    /**
     * Arm a staged payload by writing the `pending` pointer so the next backend
     * start promotes it. The caller triggers the full app relaunch.
     */
    readonly apply: Effect.Effect<DesktopPayloadUpdateState>;
    /** One-click user-initiated update: download then arm for relaunch. */
    readonly update: Effect.Effect<DesktopPayloadUpdateState>;
  }
>()("@t3tools/desktop/updates/DesktopPayloadUpdates") {}

export const make = Effect.gen(function* () {
  const config = yield* DesktopConfig.DesktopConfig;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const baseHttpClient = yield* HttpClient.HttpClient;
  const httpClient = baseHttpClient.pipe(HttpClient.filterStatusOk);

  const shellVersion = environment.appVersion;
  const manifestUrl = Option.getOrElse(
    config.payloadManifestUrl,
    () => DEFAULT_PAYLOAD_MANIFEST_URL,
  );
  const publicKeyPem = Option.getOrElse(
    config.payloadPublicKeyOverride,
    () => PAYLOAD_SIGNING_PUBLIC_KEY,
  ).trim();
  const signatureRequired = !config.allowUnsignedPayload;

  const disabledReason = ((): string | null => {
    if (config.disablePayloadUpdate) {
      return "Payload updates are disabled by T3CODE_DISABLE_PAYLOAD_UPDATE.";
    }
    if (environment.isDevelopment && Option.isNone(config.payloadManifestUrl)) {
      return "Payload updates require a packaged build or an explicit T3CODE_PAYLOAD_MANIFEST_URL.";
    }
    if (signatureRequired && publicKeyPem.length === 0) {
      return "Payload updates require an embedded signing key (none configured).";
    }
    return null;
  })();
  const enabled = disabledReason === null;

  const initialState: DesktopPayloadUpdateState = {
    enabled,
    status: enabled ? "idle" : "disabled",
    shellVersion,
    currentPayloadVersion: null,
    availableVersion: null,
    stagedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: disabledReason,
  };
  // SubscriptionRef so the aggregator (DesktopUpdates) can re-broadcast the
  // merged update state whenever the payload side changes. This service no
  // longer emits to the renderer directly — DesktopUpdates owns the single
  // UPDATE_STATE_CHANNEL the UI listens to.
  const stateRef = yield* SubscriptionRef.make<DesktopPayloadUpdateState>(initialState);
  const checkInFlightRef = yield* Ref.make(false);
  const actionInFlightRef = yield* Ref.make(false);
  // A staged payload sits on disk fully verified but is NOT activated: we only
  // write the `pending` pointer (which promotes on the next backend start) when
  // the user explicitly applies it. So a background auto-download never causes
  // an unattended update — a plain app restart won't pick it up.
  const stagedPointerRef = yield* Ref.make<Option.Option<PayloadPointer>>(Option.none());

  const setState = (
    f: (state: DesktopPayloadUpdateState) => DesktopPayloadUpdateState,
  ): Effect.Effect<DesktopPayloadUpdateState> => SubscriptionRef.updateAndGet(stateRef, f);

  // payloadLayout effects read DesktopEnvironment/FileSystem from context; discharge
  // those requirements with the services already resolved in this scope so the
  // public service surface stays requirement-free.
  const provideEnv = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
    );

  /** The version of the server actually running: the active payload, else the shell. */
  const runningServerVersion = provideEnv(readActivePayloadVersion).pipe(
    Effect.map(Option.getOrElse(() => shellVersion)),
  );

  const resolveAssetUrl = (manifest: DesktopPayloadManifest): string =>
    new URL(manifest.fileName, manifestUrl).toString();

  const verifyArchive = (
    manifest: DesktopPayloadManifest,
    bytes: Uint8Array,
  ): Effect.Effect<void, string> =>
    Effect.gen(function* () {
      if (bytes.byteLength !== manifest.sizeBytes) {
        return yield* Effect.fail(
          `Payload size mismatch (expected ${manifest.sizeBytes}, got ${bytes.byteLength}).`,
        );
      }
      const sha256 = computeSha256Hex(bytes);
      if (sha256 !== manifest.sha256) {
        return yield* Effect.fail("Payload checksum did not match the manifest.");
      }
      if (signatureRequired) {
        const ok = verifyPayloadSignature({
          sha256Hex: manifest.sha256,
          signatureBase64: manifest.signature,
          publicKeyPem,
        });
        if (!ok) {
          return yield* Effect.fail("Payload signature verification failed.");
        }
      } else {
        yield* logPayloadWarning("applying payload without signature verification (dev override)");
      }
    });

  const extractToVersionDir = (
    manifest: DesktopPayloadManifest,
    bytes: Uint8Array,
  ): Effect.Effect<void, string> =>
    Effect.gen(function* () {
      const entries = yield* Effect.try({
        try: () => extractPayloadArchive(bytes),
        catch: (cause) => `Failed to extract payload archive: ${String(cause)}`,
      });
      const finalDir = payloadVersionDir(environment, manifest.version);
      const partialDir = `${finalDir}.partial`;
      yield* fileSystem.remove(partialDir, { recursive: true }).pipe(Effect.ignore);
      yield* fileSystem
        .makeDirectory(partialDir, { recursive: true })
        .pipe(Effect.mapError((cause) => `Failed to create payload directory: ${String(cause)}`));
      yield* Effect.forEach(
        entries,
        (entry) =>
          Effect.gen(function* () {
            const target = environment.path.join(partialDir, entry.path);
            yield* fileSystem.makeDirectory(environment.path.dirname(target), { recursive: true });
            yield* fileSystem.writeFile(target, entry.data);
          }),
        { concurrency: 8, discard: true },
      ).pipe(Effect.mapError((cause) => `Failed to write payload files: ${String(cause)}`));
      // Swap the freshly-extracted tree into place atomically-ish.
      yield* fileSystem.remove(finalDir, { recursive: true }).pipe(Effect.ignore);
      yield* fileSystem
        .rename(partialDir, finalDir)
        .pipe(Effect.mapError((cause) => `Failed to finalize payload directory: ${String(cause)}`));
    });

  // Download + verify + extract a payload to its version dir and remember its
  // pointer in memory. Does NOT write the on-disk `pending` pointer — that
  // happens only in `applyImpl`, so staged-but-unapplied payloads never activate
  // on a normal restart.
  const stageManifest = (
    manifest: DesktopPayloadManifest,
  ): Effect.Effect<DesktopPayloadUpdateState> =>
    Effect.gen(function* () {
      yield* setState((state) => ({ ...state, status: "downloading", downloadPercent: 0 }));
      yield* logPayloadInfo("downloading payload", { version: manifest.version });
      const assetUrl = resolveAssetUrl(manifest);
      const buffer = yield* httpClient
        .get(assetUrl)
        .pipe(Effect.flatMap((response) => response.arrayBuffer));
      const bytes = new Uint8Array(buffer);
      yield* verifyArchive(manifest, bytes);
      yield* extractToVersionDir(manifest, bytes);
      const stagedAt = yield* currentIsoTimestamp;
      yield* Ref.set(
        stagedPointerRef,
        Option.some<PayloadPointer>({
          version: manifest.version,
          minShellVersion: manifest.minShellVersion,
          sha256: manifest.sha256,
          stagedAt,
        }),
      );
      yield* logPayloadInfo("payload downloaded and staged; click to apply", {
        version: manifest.version,
      });
      return yield* setState((state) => ({
        ...state,
        status: "staged",
        stagedVersion: manifest.version,
        availableVersion: manifest.version,
        downloadPercent: 100,
        message: null,
      }));
    }).pipe(
      Effect.scoped,
      Effect.catch((error) => {
        const message = typeof error === "string" ? error : String(error);
        return logPayloadError("payload download/stage failed", { message }).pipe(
          Effect.andThen(setState((state) => ({ ...state, status: "error", message }))),
        );
      }),
    );

  const fetchManifest: Effect.Effect<DesktopPayloadManifest, string> = httpClient
    .get(manifestUrl)
    .pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(DesktopPayloadManifestSchema)),
      Effect.scoped,
      Effect.mapError((cause) => `Failed to fetch payload manifest: ${String(cause)}`),
    );

  const evaluateManifest = (
    manifest: DesktopPayloadManifest,
    currentVersion: string,
    checkedAt: string,
  ): Effect.Effect<DesktopPayloadUpdateState> =>
    Effect.gen(function* () {
      if (compareSemverVersions(manifest.version, currentVersion) <= 0) {
        return yield* setState((state) => ({
          ...state,
          status: "up-to-date",
          checkedAt,
          availableVersion: null,
          message: null,
        }));
      }
      if (!shellSatisfiesPayload(shellVersion, manifest.minShellVersion)) {
        return yield* setState((state) => ({
          ...state,
          status: "up-to-date",
          checkedAt,
          availableVersion: null,
          message: `Payload ${manifest.version} requires app ${manifest.minShellVersion}; install the full update.`,
        }));
      }
      yield* logPayloadInfo("payload update available", { version: manifest.version });
      yield* setState((state) => ({
        ...state,
        status: "available",
        checkedAt,
        availableVersion: manifest.version,
        message: null,
      }));
      // Auto-download in the background so the update is staged and ready; the
      // user still applies it explicitly via the button (a one-click restart).
      // Skip if it is already staged, or a user action is mid-flight.
      const alreadyStaged = yield* Ref.get(stagedPointerRef);
      if (
        (Option.isSome(alreadyStaged) && alreadyStaged.value.version === manifest.version) ||
        (yield* Ref.get(actionInFlightRef))
      ) {
        return yield* SubscriptionRef.get(stateRef);
      }
      return yield* stageManifest(manifest);
    });

  const performCheck = (reason: string): Effect.Effect<DesktopPayloadUpdateState> =>
    Effect.gen(function* () {
      if (!enabled) {
        return yield* SubscriptionRef.get(stateRef);
      }
      if (yield* Ref.get(checkInFlightRef)) {
        return yield* SubscriptionRef.get(stateRef);
      }
      yield* Ref.set(checkInFlightRef, true);
      return yield* Effect.gen(function* () {
        const currentVersion = yield* runningServerVersion;
        yield* setState((state) => ({
          ...state,
          status: "checking",
          currentPayloadVersion:
            currentVersion === shellVersion ? state.currentPayloadVersion : currentVersion,
        }));
        yield* logPayloadInfo("checking for payload update", { reason });

        return yield* fetchManifest.pipe(
          Effect.flatMap((manifest) =>
            currentIsoTimestamp.pipe(
              Effect.flatMap((checkedAt) => evaluateManifest(manifest, currentVersion, checkedAt)),
            ),
          ),
          Effect.catch((message) =>
            currentIsoTimestamp.pipe(
              Effect.flatMap((checkedAt) =>
                setState((state) => ({ ...state, status: "error", checkedAt, message })),
              ),
            ),
          ),
        );
      }).pipe(Effect.ensuring(Ref.set(checkInFlightRef, false)));
    });

  // Re-fetch the manifest and stage the newest compatible payload. Used only by
  // explicit user actions, never by the background poller.
  const downloadImpl: Effect.Effect<DesktopPayloadUpdateState> = Effect.gen(function* () {
    if (!enabled) {
      return yield* SubscriptionRef.get(stateRef);
    }
    const currentVersion = yield* runningServerVersion;
    return yield* fetchManifest.pipe(
      Effect.flatMap((manifest) =>
        Effect.gen(function* () {
          const incompatible =
            compareSemverVersions(manifest.version, currentVersion) <= 0 ||
            !shellSatisfiesPayload(shellVersion, manifest.minShellVersion);
          if (incompatible) {
            const checkedAt = yield* currentIsoTimestamp;
            return yield* setState((state) => ({
              ...state,
              status: "up-to-date",
              checkedAt,
              availableVersion: null,
            }));
          }
          return yield* stageManifest(manifest);
        }),
      ),
      Effect.catch((message) =>
        currentIsoTimestamp.pipe(
          Effect.flatMap((checkedAt) =>
            setState((state) => ({ ...state, status: "error", checkedAt, message })),
          ),
        ),
      ),
    );
  });

  // Arm a staged payload to activate on the next backend start by writing the
  // on-disk `pending` pointer. The caller (DesktopUpdates → IPC) then triggers a
  // full app relaunch; `promotePendingPayload` activates the payload on the
  // fresh launch (see payloadLayout.ts).
  //
  // We intentionally do NOT hot-restart the primary backend in place here. That
  // stop/start swap raced the loopback port against an in-flight session: if the
  // old process had not released :PORT before the new one tried to bind, the new
  // backend crash-looped and the renderer was stranded "Reconnecting…" forever.
  // A clean relaunch rebinds from a fresh process. The pending pointer is a
  // no-op on the next start if the relaunch never happens, so arming is safe.
  const applyImpl: Effect.Effect<DesktopPayloadUpdateState> = Effect.gen(function* () {
    const staged = yield* Ref.get(stagedPointerRef);
    if (Option.isNone(staged)) {
      return yield* SubscriptionRef.get(stateRef);
    }
    const pointer = staged.value;
    yield* logPayloadInfo("arming staged payload for relaunch", {
      version: pointer.version,
    });
    yield* provideEnv(writePayloadPointer(environment.pendingPayloadPointerPath, pointer));
    yield* logPayloadInfo("payload armed; awaiting relaunch", { version: pointer.version });
    return yield* SubscriptionRef.get(stateRef);
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : logPayloadError("payload arm failed", { cause: Cause.pretty(cause) }).pipe(
            Effect.andThen(
              setState((state) => ({
                ...state,
                status: "error",
                message: "Failed to stage the payload update for restart.",
              })),
            ),
          ),
    ),
  );

  // Serialize user-initiated actions so a download and an apply never overlap.
  const runExclusive = (
    effect: Effect.Effect<DesktopPayloadUpdateState>,
  ): Effect.Effect<DesktopPayloadUpdateState> =>
    Effect.gen(function* () {
      if (yield* Ref.get(actionInFlightRef)) {
        return yield* SubscriptionRef.get(stateRef);
      }
      yield* Ref.set(actionInFlightRef, true);
      return yield* effect.pipe(Effect.ensuring(Ref.set(actionInFlightRef, false)));
    });

  const startPollers: Effect.Effect<void, never, Scope.Scope> = Effect.gen(function* () {
    yield* Effect.sleep(STARTUP_DELAY).pipe(
      Effect.andThen(performCheck("startup")),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : logPayloadError("payload startup check failed", { cause: Cause.pretty(cause) }),
      ),
      Effect.forkScoped,
    );
    yield* Effect.sleep(POLL_INTERVAL).pipe(
      Effect.andThen(performCheck("poll")),
      Effect.forever,
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : logPayloadError("payload poll loop failed", { cause: Cause.pretty(cause) }),
      ),
      Effect.forkScoped,
    );
  });

  return DesktopPayloadUpdates.of({
    getState: SubscriptionRef.get(stateRef),
    changes: SubscriptionRef.changes(stateRef),
    check: performCheck,
    download: runExclusive(downloadImpl),
    apply: runExclusive(applyImpl),
    update: runExclusive(
      Effect.gen(function* () {
        const staged = yield* downloadImpl;
        if (staged.status !== "staged") {
          return staged;
        }
        return yield* applyImpl;
      }),
    ),
    configure: Effect.gen(function* () {
      const currentVersion = yield* runningServerVersion;
      yield* setState((state) => ({
        ...state,
        currentPayloadVersion: currentVersion === shellVersion ? null : currentVersion,
      }));
      if (!enabled) {
        yield* logPayloadInfo("payload updates disabled", { reason: disabledReason ?? "" });
        return;
      }
      yield* logPayloadInfo("payload updates enabled", { manifestUrl });
      yield* startPollers;
    }).pipe(Effect.withSpan("desktop.payloadUpdates.configure")),
  });
});

export const layer = Layer.effect(DesktopPayloadUpdates, make);
