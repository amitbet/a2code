import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { FORK_MIGRATIONS_TABLE } from "./ForkMigrations.ts";
import { migrationEntries } from "./Migrations.ts";

/**
 * Ledger names the fork recorded in `effect_sql_migrations` before fork schema
 * moved to its own ledger. Fork ids 1-60 interleaved fork migrations with
 * upstream's 1-54, shifting upstream's ids.
 */
const FORK_ONLY_NAMES = new Set([
  "ProjectionThreadsForkedFrom",
  "ProjectionQueuedPrompts",
  "ProjectionThreadMessagesFts",
  "ProjectionQueuedPromptThreadReferences",
  "ProjectionThreadSideQuestionOf",
  "AuthPairingSessionLifetime",
]);
/** Fork ledger names whose upstream migration has a different name. */
const UPSTREAM_NAME_BY_FORK_NAME = new Map([
  ["ProjectionThreadsPinnedAt", "ProjectionThreadsPinned"],
]);
/** Fork-only migrations that still have a fork-ledger counterpart. */
const FORK_LEDGER_ID_BY_NAME = new Map([["AuthPairingSessionLifetime", 1]]);
const FORK_LEDGER_MARKER = { id: 33, name: "ProjectionThreadsForkedFrom" } as const;

/**
 * Rewrites a pre-split fork ledger into upstream ids, once.
 *
 * Every fork migration up to the recorded maximum ran in order, so the upstream
 * migrations among them are a prefix of upstream's list. They are re-recorded
 * under upstream's ids; the fork-only ones that still exist move to
 * `fork_sql_migrations`, and retired fork-only ones are dropped from the ledger
 * (their v1 tables stay as legacy import data). Without this, upstream's
 * migrations at ids at or below the fork's old maximum would be skipped.
 */
export const reconcileForkMigrationLedger = Effect.fn("reconcileForkMigrationLedger")(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
      `;
      if (tables.length === 0) return false;
      const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;
      const isForkLedger = history.some(
        (row) => row.migration_id === FORK_LEDGER_MARKER.id && row.name === FORK_LEDGER_MARKER.name,
      );
      if (!isForkLedger) return false;

      const upstreamIdByName = new Map<string, number>(
        migrationEntries.map(([id, name]) => [name, id]),
      );
      const upstreamIds: Array<readonly [number, string]> = [];
      const forkIds: Array<readonly [number, string]> = [];
      for (const row of history) {
        if (FORK_ONLY_NAMES.has(row.name)) {
          const forkId = FORK_LEDGER_ID_BY_NAME.get(row.name);
          if (forkId !== undefined) forkIds.push([forkId, row.name]);
          continue;
        }
        const upstreamName = UPSTREAM_NAME_BY_FORK_NAME.get(row.name) ?? row.name;
        const upstreamId = upstreamIdByName.get(upstreamName);
        if (upstreamId === undefined) {
          return yield* new Migrator.MigrationError({
            kind: "BadState",
            message: `Cannot reconcile fork migration ledger: unknown migration ${row.migration_id}_${row.name}.`,
          });
        }
        upstreamIds.push([upstreamId, upstreamName]);
      }
      const isPrefix = upstreamIds.every(([id], index) => id === index + 1);
      if (!isPrefix) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message:
            "Cannot reconcile fork migration ledger: upstream migrations were not applied in order.",
        });
      }

      yield* sql`DELETE FROM effect_sql_migrations`;
      for (const [id, name] of upstreamIds) {
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
      }
      yield* sql`
        CREATE TABLE IF NOT EXISTS ${sql(FORK_MIGRATIONS_TABLE)} (
          migration_id INTEGER UNSIGNED NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          name VARCHAR(255) NOT NULL,
          PRIMARY KEY (migration_id)
        )
      `;
      for (const [id, name] of forkIds) {
        yield* sql`INSERT OR IGNORE INTO ${sql(FORK_MIGRATIONS_TABLE)} (migration_id, name) VALUES (${id}, ${name})`;
      }
      yield* Effect.log("Reconciled fork migration ledger onto upstream ids").pipe(
        Effect.annotateLogs({
          upstreamThrough: upstreamIds.length,
          forkMigrations: forkIds.length,
        }),
      );
      return true;
    }),
  );
});
