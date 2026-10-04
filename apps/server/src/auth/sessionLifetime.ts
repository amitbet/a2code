import type { AuthSessionLifetime } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/**
 * Expiry stored for sessions that never expire. The sessions table requires an
 * expiry, so "forever" is the latest representable date instead of NULL.
 */
export const NEVER_EXPIRES_AT = DateTime.makeUnsafe("9999-12-31T23:59:59.999Z");

/** Resolves when a session issued at `issuedAt` with the chosen lifetime expires. */
export function sessionLifetimeExpiresAt(
  lifetime: AuthSessionLifetime,
  issuedAt: DateTime.Utc,
): DateTime.Utc {
  switch (lifetime) {
    case "month":
      // Matches the default session TTL, so "month" and "unspecified" agree.
      return DateTime.add(issuedAt, { days: 30 });
    case "year":
      return DateTime.add(issuedAt, { years: 1 });
    case "decade":
      return DateTime.add(issuedAt, { years: 10 });
    case "forever":
      return NEVER_EXPIRES_AT;
  }
}
