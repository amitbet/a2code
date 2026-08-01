import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, describe, expect, vi } from "vite-plus/test";

import {
  clearMacOSKeychainPasswordCache,
  invalidateMacOSKeychainPassword,
  MACOS_KEYCHAIN_CACHE_TTL_MS,
  readMacOSKeychainPassword,
} from "./MacOSKeychain.ts";

describe("readMacOSKeychainPassword", () => {
  beforeEach(() => {
    clearMacOSKeychainPasswordCache();
  });

  it.effect("caches successful reads and deduplicates concurrent reads", () =>
    Effect.gen(function* () {
      const read = vi.fn(async () => "secret-token");
      const options = {
        account: "cursor-user",
        service: "cursor-access-token",
        platform: "darwin" as const,
        read,
      };

      const [first, second] = yield* Effect.all(
        [readMacOSKeychainPassword(options), readMacOSKeychainPassword(options)],
        { concurrency: "unbounded" },
      );
      const third = yield* readMacOSKeychainPassword(options);

      expect(first).toBe("secret-token");
      expect(second).toBe("secret-token");
      expect(third).toBe("secret-token");
      expect(read).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("caches misses and retries after the TTL", () =>
    Effect.gen(function* () {
      const read = vi.fn(async () => null);
      let now = 1_000;
      const options = {
        account: "cursor-user",
        service: "cursor-api-key",
        platform: "darwin" as const,
        read,
        now: () => now,
      };

      expect(yield* readMacOSKeychainPassword(options)).toBeNull();
      now += MACOS_KEYCHAIN_CACHE_TTL_MS - 1;
      expect(yield* readMacOSKeychainPassword(options)).toBeNull();
      expect(read).toHaveBeenCalledTimes(1);

      now += 1;
      expect(yield* readMacOSKeychainPassword(options)).toBeNull();
      expect(read).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect("keeps different Keychain entries isolated", () =>
    Effect.gen(function* () {
      const read = vi.fn(async () => "token");
      const base = {
        account: "cursor-user",
        platform: "darwin" as const,
        read,
      };

      yield* readMacOSKeychainPassword({ ...base, service: "cursor-access-token" });
      yield* readMacOSKeychainPassword({ ...base, service: "cursor-api-key" });

      expect(read).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect("can invalidate a still-fresh credential after authentication failure", () =>
    Effect.gen(function* () {
      const read = vi.fn(async () => "token");
      const options = {
        account: "cursor-user",
        service: "cursor-access-token",
        platform: "darwin" as const,
        read,
      };

      yield* readMacOSKeychainPassword(options);
      invalidateMacOSKeychainPassword(options);
      yield* readMacOSKeychainPassword(options);

      expect(read).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect("does not touch Keychain on non-macOS platforms", () =>
    Effect.gen(function* () {
      const read = vi.fn(async () => "token");
      const value = yield* readMacOSKeychainPassword({
        account: "cursor-user",
        service: "cursor-access-token",
        platform: "linux",
        read,
      });

      expect(value).toBeNull();
      expect(read).not.toHaveBeenCalled();
    }),
  );
});
