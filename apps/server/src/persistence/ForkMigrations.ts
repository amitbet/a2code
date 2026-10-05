/**
 * Fork-only schema migrations, recorded in their own `fork_sql_migrations`
 * ledger so they can never shadow an upstream migration id.
 *
 * The upstream migrator compares ids only: a fork migration sharing an id with
 * a later upstream migration silently masks it forever. Keeping fork schema in
 * a separate ledger lets `effect_sql_migrations` match upstream exactly. Fork
 * migrations must be idempotent, because databases created before this ledger
 * existed may already carry their schema (see `reconcileForkMigrationLedger`).
 */
import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";

import ForkMigration0001 from "./ForkMigrations/001_AuthPairingSessionLifetime.ts";

export const FORK_MIGRATIONS_TABLE = "fork_sql_migrations";

export const forkMigrationEntries = [[1, "AuthPairingSessionLifetime", ForkMigration0001]] as const;

const run = Migrator.make({});

export const runForkMigrations = Effect.fn("runForkMigrations")(function* () {
  const executed = yield* run({
    table: FORK_MIGRATIONS_TABLE,
    loader: Migrator.fromRecord(
      Object.fromEntries(
        forkMigrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
      ),
    ),
  });
  if (executed.length > 0) {
    yield* Effect.log("Fork migrations ran successfully").pipe(
      Effect.annotateLogs({ migrations: executed.map(([id, name]) => `${id}_${name}`) }),
    );
  }
  return executed;
});
