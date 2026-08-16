import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Full-text index over projected thread messages, backing cross-thread history
 * search (`thread_search` in the MCP `threads` toolkit).
 *
 * External-content FTS5: the index stores tokens only and reads column values
 * back from `projection_thread_messages`, so transcript text is not duplicated.
 * FTS5 is compiled into both SQLite builds this server runs on (`bun:sqlite`
 * and `node:sqlite`), so this needs no loadable extension.
 *
 * Two filters keep the index small and useful:
 *
 * - Only settled rows (`is_streaming = 0`) are indexed. Assistant text is
 *   rewritten on every streaming delta; indexing mid-stream would rewrite the
 *   same postings on each token for no benefit.
 * - Only `user` and `assistant` rows are indexed. `system` messages are
 *   scaffolding, and tool output lives in `projection_thread_activities`, which
 *   is deliberately left out: diffs, stack traces, and command dumps dominate
 *   term frequency and drown out the conversation.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS projection_thread_messages_fts USING fts5(
      text,
      content='projection_thread_messages',
      content_rowid='rowid',
      tokenize='unicode61'
    )
  `;

  // `INSERT ... SELECT ... WHERE` is how a trigger body applies a predicate to
  // a single row: FTS5 sync inserts take no WHERE clause of their own.
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS projection_thread_messages_fts_insert
    AFTER INSERT ON projection_thread_messages
    BEGIN
      INSERT INTO projection_thread_messages_fts(rowid, text)
      SELECT new.rowid, new.text
      WHERE new.is_streaming = 0 AND new.role IN ('user', 'assistant');
    END
  `;

  // External-content FTS5 deletes must replay the exact indexed text so the
  // right postings are removed; `old.text` is that value.
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS projection_thread_messages_fts_delete
    AFTER DELETE ON projection_thread_messages
    BEGIN
      INSERT INTO projection_thread_messages_fts(projection_thread_messages_fts, rowid, text)
      SELECT 'delete', old.rowid, old.text
      WHERE old.is_streaming = 0 AND old.role IN ('user', 'assistant');
    END
  `;

  // Streaming rows land here on the update that flips `is_streaming` to 0, so
  // this trigger is what indexes most assistant messages. Delete-then-insert
  // keeps it correct when text, role, or streaming state changes together.
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS projection_thread_messages_fts_update
    AFTER UPDATE ON projection_thread_messages
    BEGIN
      INSERT INTO projection_thread_messages_fts(projection_thread_messages_fts, rowid, text)
      SELECT 'delete', old.rowid, old.text
      WHERE old.is_streaming = 0 AND old.role IN ('user', 'assistant');

      INSERT INTO projection_thread_messages_fts(rowid, text)
      SELECT new.rowid, new.text
      WHERE new.is_streaming = 0 AND new.role IN ('user', 'assistant');
    END
  `;

  // Backfill existing history. The FTS5 'rebuild' command indexes every content
  // row, which would ignore the filters above, so the backfill is explicit.
  yield* sql`
    INSERT INTO projection_thread_messages_fts(rowid, text)
    SELECT rowid, text
    FROM projection_thread_messages
    WHERE is_streaming = 0 AND role IN ('user', 'assistant')
  `;
});
