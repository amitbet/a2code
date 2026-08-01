// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeProcess from "node:process";
import * as NodeUtil from "node:util";

import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

/**
 * Avoid repeatedly probing macOS Keychain entries from background refreshes.
 * This caches both successful reads and misses/permission failures so a denied
 * Keychain request cannot turn into a prompt loop. A cached value is reused
 * until the caller invalidates it after an authentication failure or the
 * maximum lifetime expires.
 */
export const MACOS_KEYCHAIN_CACHE_TTL_MS = 24 * 60 * 60_000;

type ExecFile = (file: string, args: ReadonlyArray<string>) => Promise<{ readonly stdout: string }>;

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile) as unknown as ExecFile;

interface CacheEntry {
  readonly value: string | null;
  readonly expiresAt: number;
}

export interface ReadMacOSKeychainPasswordOptions {
  readonly account: string;
  readonly service: string;
  /** Test seam; production uses the system `security` command. */
  readonly read?: () => Promise<string | null>;
  /** Test seam for deterministic expiry checks. */
  readonly now?: () => number;
  readonly platform?: NodeJS.Platform;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | null>>();

const cacheKey = (account: string, service: string): string => `${account}\u0000${service}`;

const readFromSystemKeychain = (account: string, service: string): Promise<string | null> =>
  execFileAsync("security", ["find-generic-password", "-a", account, "-w", "-s", service]).then(
    (result) => result.stdout.trim() || null,
  );

/** Clear all cached Keychain results. Intended for tests and credential reset flows. */
export const clearMacOSKeychainPasswordCache = (): void => {
  cache.clear();
};

/** Invalidate one cached Keychain result after its credential is rejected. */
export const invalidateMacOSKeychainPassword = (input: {
  readonly account: string;
  readonly service: string;
}): void => {
  cache.delete(cacheKey(input.account, input.service));
};

export const readMacOSKeychainPassword = Effect.fn("readMacOSKeychainPassword")(function* (
  options: ReadMacOSKeychainPasswordOptions,
) {
  if ((options.platform ?? NodeProcess.platform) !== "darwin") {
    return null;
  }

  let now = options.now?.();
  if (now === undefined) {
    now = yield* Clock.currentTimeMillis;
  }
  const key = cacheKey(options.account, options.service);
  const cached = cache.get(key);
  if (cached) {
    if (cached.expiresAt > now) {
      return cached.value;
    }
    cache.delete(key);
  }

  let request = inFlight.get(key);
  if (!request) {
    request = Promise.resolve()
      .then(() =>
        options.read ? options.read() : readFromSystemKeychain(options.account, options.service),
      )
      .catch(() => null);
    inFlight.set(key, request);
    void request.finally(() => {
      if (inFlight.get(key) === request) {
        inFlight.delete(key);
      }
    });
  }

  const value = yield* Effect.tryPromise(() => request).pipe(Effect.orElseSucceed(() => null));
  cache.set(key, {
    value,
    expiresAt: now + MACOS_KEYCHAIN_CACHE_TTL_MS,
  });
  return value;
});
