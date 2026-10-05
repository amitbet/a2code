import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { FORK_MIGRATIONS_TABLE, runForkMigrations } from "./ForkMigrations.ts";
import { migrationManifest, runMigrations } from "./Migrations.ts";
import { reconcileForkMigrationLedger } from "./reconcileForkMigrationLedger.ts";

// The ledger a fork database recorded before fork schema moved to its own table.
const PRE_SPLIT_FORK_LEDGER = [
  ...migrationManifest.filter(([id]) => id <= 32),
  [33, "ProjectionThreadsForkedFrom"],
  [34, "ProjectionQueuedPrompts"],
  [35, "ProjectionThreadsPinnedAt"],
  [36, "ProjectionThreadsSettled"],
  [37, "ProjectionThreadsSnoozed"],
  [38, "ProjectionThreadTitleRegeneration"],
  [39, "ProjectionTurnsKeysetIndex"],
  [40, "ProjectionThreadsPinOrderKey"],
  [41, "ProjectionProjectsDefaultThreadEnvMode"],
  [42, "ProjectionProjectFaviconPath"],
  [43, "ProjectionThreadMessagesFts"],
  [44, "AuthSessionClientConnection"],
  [45, "ProjectionThreadLinkedPullRequest"],
  [46, "ProjectionThreadsUnsettledAt"],
  [47, "ClearAutomaticProjectModelDefaults"],
  [48, "ProjectionQueuedPromptThreadReferences"],
  [49, "ProjectionProjectsAutoPull"],
  [50, "RepairAutomaticSettlementTimestamps"],
  [51, "ProjectionProjectIcon"],
  [52, "ProjectionThreadBranchPullRequest"],
  [53, "ProjectionThreadsActiveOrderKey"],
  [54, "ProjectionThreadPullRequests"],
  [55, "ProjectionThreadMessageContext"],
  [56, "ProjectionThreadTitleState"],
  [57, "PullRequestFilesViewed"],
  [58, "ProjectionThreadSideQuestionOf"],
  [59, "ProjectionThreadsAutoSettleDisabledAt"],
  [60, "AuthPairingSessionLifetime"],
] as const;

/** A database whose schema matches the fork through `throughForkId`, under the fork's ledger. */
const seedForkDatabase = (throughForkId: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const ledger = PRE_SPLIT_FORK_LEDGER.filter(([id]) => id <= throughForkId);
    const upstreamApplied = ledger.filter(([, name]) =>
      migrationManifest.some(
        ([, upstreamName]) =>
          upstreamName === name ||
          (name === "ProjectionThreadsPinnedAt" && upstreamName === "ProjectionThreadsPinned"),
      ),
    ).length;
    yield* runMigrations({ toMigrationInclusive: upstreamApplied });
    yield* sql`DELETE FROM effect_sql_migrations`;
    for (const [id, name] of ledger) {
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
    }
    if (throughForkId >= 60) {
      yield* sql`ALTER TABLE auth_pairing_links ADD COLUMN session_lifetime TEXT`;
    }
  });

const readLedger = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
      SELECT migration_id, name FROM ${sql(table)} ORDER BY migration_id
    `;
    return rows.map((row) => [row.migration_id, row.name] as const);
  });

const migrate = Effect.gen(function* () {
  yield* reconcileForkMigrationLedger();
  const upstream = yield* runMigrations();
  const fork = yield* runForkMigrations();
  return { upstream, fork };
});

const sqlite = NodeSqliteClient.layer({ filename: ":memory:" });

describe("reconcileForkMigrationLedger", () => {
  it.effect("moves a current fork database onto upstream ids so V2 migrations run", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedForkDatabase(60);

      const { upstream, fork } = yield* migrate;

      assert.deepStrictEqual(upstream, [
        [55, "OrchestrationV2"],
        [56, "RemoveRedundantProjectionIndexes"],
      ]);
      assert.deepStrictEqual(fork, []);
      assert.deepStrictEqual(yield* readLedger("effect_sql_migrations"), migrationManifest);
      assert.deepStrictEqual(yield* readLedger(FORK_MIGRATIONS_TABLE), [
        [1, "AuthPairingSessionLifetime"],
      ]);
      const v2Tables = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestration_v2_legacy_imports'
      `;
      assert.strictEqual(v2Tables.length, 1);
      assert.deepStrictEqual(yield* migrate, { upstream: [], fork: [] });
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("finishes the upstream migrations an older fork database had not reached", () =>
    Effect.gen(function* () {
      yield* seedForkDatabase(57);

      const { upstream, fork } = yield* migrate;

      assert.deepStrictEqual(upstream, [
        [54, "ProjectionThreadsAutoSettleDisabledAt"],
        [55, "OrchestrationV2"],
        [56, "RemoveRedundantProjectionIndexes"],
      ]);
      assert.deepStrictEqual(fork, [[1, "AuthPairingSessionLifetime"]]);
      assert.deepStrictEqual(yield* readLedger("effect_sql_migrations"), migrationManifest);
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("leaves upstream and fresh databases alone", () =>
    Effect.gen(function* () {
      const { upstream, fork } = yield* migrate;

      assert.deepStrictEqual(upstream, migrationManifest);
      assert.deepStrictEqual(fork, [[1, "AuthPairingSessionLifetime"]]);
      assert.isFalse(yield* reconcileForkMigrationLedger());
    }).pipe(Effect.provide(sqlite)),
  );
});
