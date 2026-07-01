import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

/**
 * On-disk bookkeeping for the desktop payload hot-update channel.
 *
 * Extracted payloads live under `<stateDir>/payloads/<version>/` (the contents
 * of a release's `apps/server/dist`, i.e. `bin.mjs` + chunks + `client/`). Two
 * JSON pointers select which one the backend launches:
 *
 * - `active.json`  — the payload currently applied; read at every backend start.
 * - `pending.json` — a freshly-staged payload, promoted to `active` on the next
 *   backend start (so a download never interrupts a running session unless the
 *   updater explicitly restarts the backend).
 *
 * All resolution is intentionally fault-tolerant: anything unexpected falls back
 * to the shell-bundled backend, so a corrupt payload can never brick the app.
 */

export const PayloadPointer = Schema.Struct({
  version: Schema.String,
  minShellVersion: Schema.String,
  sha256: Schema.String,
  stagedAt: Schema.String,
});
export type PayloadPointer = typeof PayloadPointer.Type;

const PayloadPointerJson = Schema.fromJsonString(PayloadPointer);
const decodePayloadPointerJson = Schema.decodeUnknownEffect(PayloadPointerJson);
const encodePayloadPointerJson = Schema.encodeUnknownEffect(PayloadPointerJson);

export function payloadVersionDir(
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
  version: string,
): string {
  return environment.path.join(environment.payloadsDir, version);
}

export function payloadVersionEntryPath(
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
  version: string,
): string {
  return environment.path.join(payloadVersionDir(environment, version), "bin.mjs");
}

/** Read + decode a pointer file, returning none for missing/corrupt pointers. */
export const readPayloadPointer = (
  pointerPath: string,
): Effect.Effect<Option.Option<PayloadPointer>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(pointerPath).pipe(Effect.option);
    if (Option.isNone(raw)) {
      return Option.none<PayloadPointer>();
    }
    return yield* decodePayloadPointerJson(raw.value).pipe(
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none<PayloadPointer>()),
    );
  });

export const writePayloadPointer = (
  pointerPath: string,
  pointer: PayloadPointer,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const json = yield* encodePayloadPointerJson(pointer).pipe(Effect.orDie);
    yield* fileSystem.writeFileString(pointerPath, json).pipe(Effect.ignore);
  });

const removePointer = (pointerPath: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.remove(pointerPath).pipe(Effect.ignore);
  });

export const clearActivePayload: Effect.Effect<
  Option.Option<PayloadPointer>,
  never,
  FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
> = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const active = yield* readPayloadPointer(environment.activePayloadPointerPath);
  yield* removePointer(environment.activePayloadPointerPath);
  return active;
});

/** True when the running shell is new enough to run a payload's `minShellVersion`. */
export function shellSatisfiesPayload(shellVersion: string, minShellVersion: string): boolean {
  return compareSemverVersions(shellVersion, minShellVersion) >= 0;
}

const payloadEntryExists = (
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
  version: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem
      .exists(payloadVersionEntryPath(environment, version))
      .pipe(Effect.orElseSucceed(() => false));
  });

/**
 * Promote a staged `pending` payload to `active` when its files are present and
 * its `minShellVersion` is satisfied; otherwise discard the stale pointer.
 * Runs at backend start so a staged payload applies on the next launch.
 */
const promotePendingPayload: Effect.Effect<
  void,
  never,
  FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
> = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const pending = yield* readPayloadPointer(environment.pendingPayloadPointerPath);
  if (Option.isNone(pending)) {
    return;
  }
  const pointer = pending.value;
  const ready =
    (yield* payloadEntryExists(environment, pointer.version)) &&
    shellSatisfiesPayload(environment.appVersion, pointer.minShellVersion);
  if (ready) {
    yield* writePayloadPointer(environment.activePayloadPointerPath, pointer);
  }
  yield* removePointer(environment.pendingPayloadPointerPath);
});

/**
 * Resolve the backend entry path to launch: a promoted/active payload's
 * `bin.mjs` when present and intact, else the shell-bundled backend.
 */
export const resolveActiveBackendEntryPath: Effect.Effect<
  string,
  never,
  FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
> = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  yield* promotePendingPayload;
  const active = yield* readPayloadPointer(environment.activePayloadPointerPath);
  if (Option.isSome(active) && (yield* payloadEntryExists(environment, active.value.version))) {
    return payloadVersionEntryPath(environment, active.value.version);
  }
  return environment.bundledBackendEntryPath;
});

/** The applied payload version (none when running the shell-bundled backend). */
export const readActivePayloadVersion: Effect.Effect<
  Option.Option<string>,
  never,
  FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment
> = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const active = yield* readPayloadPointer(environment.activePayloadPointerPath);
  if (Option.isSome(active) && (yield* payloadEntryExists(environment, active.value.version))) {
    return Option.some(active.value.version);
  }
  return Option.none<string>();
});
