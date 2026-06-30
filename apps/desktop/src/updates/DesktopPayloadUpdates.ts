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
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import * as DesktopBackendPool from "../backend/DesktopBackendPool.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";
import {
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
    readonly configure: Effect.Effect<void, never, Scope.Scope>;
    readonly check: (reason: string) => Effect.Effect<DesktopPayloadUpdateState>;
  }
>()("@t3tools/desktop/updates/DesktopPayloadUpdates") {}

export const make = Effect.gen(function* () {
  const config = yield* DesktopConfig.DesktopConfig;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const backendPool = yield* DesktopBackendPool.DesktopBackendPool;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
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
  const stateRef = yield* Ref.make<DesktopPayloadUpdateState>(initialState);
  const checkInFlightRef = yield* Ref.make(false);

  const emitState = Ref.get(stateRef).pipe(
    Effect.flatMap((state) =>
      electronWindow.sendAll(IpcChannels.PAYLOAD_UPDATE_STATE_CHANNEL, state),
    ),
  );

  const setState = (
    f: (state: DesktopPayloadUpdateState) => DesktopPayloadUpdateState,
  ): Effect.Effect<DesktopPayloadUpdateState> =>
    Ref.updateAndGet(stateRef, f).pipe(Effect.tap(() => emitState));

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

  const applyImmediatelyIfConfigured = Effect.gen(function* () {
    if (!config.restartBackendOnPayloadStage) {
      return;
    }
    yield* logPayloadInfo("restarting backend to apply staged payload");
    // Payloads apply to the primary (local/Windows) backend; the pool's
    // primary instance is always registered, so a stop/start re-spawns it
    // against the freshly-staged payload entry path.
    const primaryBackend = yield* backendPool.primary;
    yield* primaryBackend.stop({ timeout: Duration.seconds(5) });
    yield* primaryBackend.start;
  });

  const downloadAndStage = (
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
      yield* provideEnv(
        writePayloadPointer(environment.pendingPayloadPointerPath, {
          version: manifest.version,
          minShellVersion: manifest.minShellVersion,
          sha256: manifest.sha256,
          stagedAt,
        }),
      );
      yield* logPayloadInfo("payload staged; will apply on next backend start", {
        version: manifest.version,
      });
      const next = yield* setState((state) => ({
        ...state,
        status: "staged",
        stagedVersion: manifest.version,
        availableVersion: manifest.version,
        downloadPercent: 100,
        message: null,
      }));
      yield* applyImmediatelyIfConfigured;
      return next;
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
      yield* setState((state) => ({
        ...state,
        status: "available",
        checkedAt,
        availableVersion: manifest.version,
        message: null,
      }));
      yield* logPayloadInfo("payload update available", { version: manifest.version });
      return yield* downloadAndStage(manifest);
    });

  const performCheck = (reason: string): Effect.Effect<DesktopPayloadUpdateState> =>
    Effect.gen(function* () {
      if (!enabled) {
        return yield* Ref.get(stateRef);
      }
      if (yield* Ref.get(checkInFlightRef)) {
        return yield* Ref.get(stateRef);
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
    getState: Ref.get(stateRef),
    check: performCheck,
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
