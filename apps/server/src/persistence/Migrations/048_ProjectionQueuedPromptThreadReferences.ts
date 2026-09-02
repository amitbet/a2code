import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_queued_prompts)
  `;

  // Cross-environment thread references resolved for a prompt that is waiting
  // its turn. Without this column a restart would drain the prompt with its
  // referenced transcripts silently missing.
  if (!columns.some((column) => column.name === "thread_references_json")) {
    yield* sql`
      ALTER TABLE projection_queued_prompts
      ADD COLUMN thread_references_json TEXT
    `;
  }
});
