import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const insertMessage = (input: {
  readonly messageId: string;
  readonly threadId: string;
  readonly role: string;
  readonly text: string;
  readonly isStreaming?: boolean;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_thread_messages (
        message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
      ) VALUES (
        ${input.messageId},
        ${input.threadId},
        NULL,
        ${input.role},
        ${input.text},
        ${input.isStreaming === true ? 1 : 0},
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      )
    `;
  });

// The suite shares one in-memory database, so every assertion is scoped to the
// thread under test rather than the whole index.
const matchedMessageIds = (threadId: string, match: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly message_id: string }>`
      SELECT m.message_id
      FROM projection_thread_messages_fts
      JOIN projection_thread_messages m ON m.rowid = projection_thread_messages_fts.rowid
      WHERE projection_thread_messages_fts MATCH ${match}
        AND m.thread_id = ${threadId}
      ORDER BY m.message_id
    `;
    return rows.map((row) => row.message_id);
  });

layer("043_ProjectionThreadMessagesFts", (it) => {
  it.effect("backfills history that existed before the index", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 42 });
      yield* insertMessage({
        messageId: "m-old",
        threadId: "t-backfill",
        role: "user",
        text: "the websocket reconnect kept dropping",
      });

      yield* runMigrations({ toMigrationInclusive: 43 });

      assert.deepStrictEqual(yield* matchedMessageIds("t-backfill", "websocket"), ["m-old"]);
    }),
  );

  it.effect("indexes settled user and assistant messages on insert", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* insertMessage({
        messageId: "m-ins-user",
        threadId: "t-insert",
        role: "user",
        text: "why does the reconnect loop stall",
      });
      yield* insertMessage({
        messageId: "m-ins-assistant",
        threadId: "t-insert",
        role: "assistant",
        text: "the reconnect backoff never resets",
      });

      assert.deepStrictEqual(yield* matchedMessageIds("t-insert", "reconnect"), [
        "m-ins-assistant",
        "m-ins-user",
      ]);
    }),
  );

  it.effect("excludes system messages", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* insertMessage({
        messageId: "m-sys",
        threadId: "t-system",
        role: "system",
        text: "reconnect scaffolding",
      });

      assert.deepStrictEqual(yield* matchedMessageIds("t-system", "reconnect"), []);
    }),
  );

  it.effect("indexes a streaming message only once it settles", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* insertMessage({
        messageId: "m-stream",
        threadId: "t-stream",
        role: "assistant",
        text: "the reconn",
        isStreaming: true,
      });

      assert.deepStrictEqual(yield* matchedMessageIds("t-stream", "reconnect"), []);

      // Streaming deltas rewrite `text` repeatedly; none of them should reach
      // the index while `is_streaming` is still 1.
      yield* sql`
        UPDATE projection_thread_messages
        SET text = 'the reconnect backoff'
        WHERE message_id = 'm-stream'
      `;
      assert.deepStrictEqual(yield* matchedMessageIds("t-stream", "reconnect"), []);

      yield* sql`
        UPDATE projection_thread_messages
        SET text = 'the reconnect backoff never resets', is_streaming = 0
        WHERE message_id = 'm-stream'
      `;
      assert.deepStrictEqual(yield* matchedMessageIds("t-stream", "reconnect"), ["m-stream"]);
    }),
  );

  it.effect("keeps the index consistent when settled text is edited", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* insertMessage({
        messageId: "m-edit",
        threadId: "t-edit",
        role: "user",
        text: "investigate the reconnect loop",
      });

      yield* sql`
        UPDATE projection_thread_messages
        SET text = 'investigate the pairing handshake'
        WHERE message_id = 'm-edit'
      `;

      // Stale postings would leave the old term matching forever.
      assert.deepStrictEqual(yield* matchedMessageIds("t-edit", "reconnect"), []);
      assert.deepStrictEqual(yield* matchedMessageIds("t-edit", "handshake"), ["m-edit"]);
    }),
  );

  it.effect("drops rows from the index when the message is deleted", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* insertMessage({
        messageId: "m-del",
        threadId: "t-delete",
        role: "user",
        text: "investigate the reconnect loop",
      });

      yield* sql`DELETE FROM projection_thread_messages WHERE message_id = 'm-del'`;

      assert.deepStrictEqual(yield* matchedMessageIds("t-delete", "reconnect"), []);
    }),
  );
});
