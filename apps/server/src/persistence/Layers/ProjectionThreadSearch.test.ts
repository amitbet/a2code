import { assert, describe, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { ProjectionThreadSearchRepository } from "../Services/ProjectionThreadSearch.ts";
import {
  ProjectionThreadSearchRepositoryLive,
  toFtsMatchExpression,
} from "./ProjectionThreadSearch.ts";

const HOME_PROJECT = ProjectId.make("project-home");
const OTHER_PROJECT = ProjectId.make("project-other");

const layer = it.layer(
  ProjectionThreadSearchRepositoryLive.pipe(Layer.provideMerge(NodeSqliteClient.layerMemory())),
);

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations();

  // The suite shares one in-memory database, so seeding is idempotent rather
  // than per-test.

  const insertProject = (projectId: string, title: string, deletedAt: string | null) => sql`
    INSERT OR IGNORE INTO projection_projects (
      project_id, title, workspace_root, scripts_json,
      created_at, updated_at, deleted_at
    ) VALUES (
      ${projectId}, ${title}, '/tmp/ws', '{}',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ${deletedAt}
    )
  `;

  const insertThread = (
    threadId: string,
    projectId: string,
    title: string,
    deletedAt: string | null,
  ) => sql`
    INSERT OR IGNORE INTO projection_threads (
      thread_id, project_id, title, branch, worktree_path, latest_turn_id,
      created_at, updated_at, deleted_at
    ) VALUES (
      ${threadId}, ${projectId}, ${title}, NULL, NULL, NULL,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ${deletedAt}
    )
  `;

  const insertMessage = (messageId: string, threadId: string, text: string) => sql`
    INSERT OR IGNORE INTO projection_thread_messages (
      message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
    ) VALUES (
      ${messageId}, ${threadId}, NULL, 'user', ${text}, 0,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    )
  `;

  yield* insertProject(HOME_PROJECT, "Home", null);
  yield* insertProject(OTHER_PROJECT, "Other Customer", null);
  yield* insertProject("project-gone", "Deleted", "2026-01-02T00:00:00.000Z");

  yield* insertThread("thread-home", HOME_PROJECT, "Reconnect work", null);
  yield* insertThread("thread-caller", HOME_PROJECT, "Calling thread", null);
  yield* insertThread("thread-deleted", HOME_PROJECT, "Deleted thread", "2026-01-02T00:00:00.000Z");
  yield* insertThread("thread-other", OTHER_PROJECT, "Their reconnect work", null);
  yield* insertThread("thread-orphan", "project-gone", "In a deleted project", null);

  yield* insertMessage("m-home", "thread-home", "the websocket reconnect backoff never resets");
  yield* insertMessage("m-caller", "thread-caller", "asking about reconnect again");
  yield* insertMessage("m-deleted", "thread-deleted", "reconnect notes from a deleted thread");
  yield* insertMessage("m-other", "thread-other", "our reconnect logic also stalls");
  yield* insertMessage("m-orphan", "thread-orphan", "reconnect in a deleted project");
});

const search = (input: {
  readonly query: string;
  readonly scope: "project" | "all";
  readonly reportOtherProjectMatches: boolean;
}) =>
  Effect.gen(function* () {
    const repository = yield* ProjectionThreadSearchRepository;
    return yield* repository.search({
      query: input.query,
      projectId: HOME_PROJECT,
      excludeThreadId: ThreadId.make("thread-caller"),
      scope: input.scope,
      reportOtherProjectMatches: input.reportOtherProjectMatches,
      limit: 10,
    });
  });

describe("toFtsMatchExpression", () => {
  it("quotes each term so FTS5 operators in user input are inert", () => {
    assert.strictEqual(toFtsMatchExpression("websocket reconnect"), '"websocket" "reconnect"');
  });

  it("strips syntax that would otherwise be a malformed query", () => {
    // A bare `"` or a trailing `-` is a syntax error in FTS5; `NEAR` and `*`
    // would silently change the query's meaning.
    assert.strictEqual(toFtsMatchExpression('recon* NEAR/3 "drop -'), '"recon" "NEAR" "3" "drop"');
  });

  it("returns undefined when nothing searchable remains", () => {
    assert.strictEqual(toFtsMatchExpression("  *** "), undefined);
  });
});

layer("ProjectionThreadSearchRepository", (it) => {
  it.effect("returns only this project's threads and never the caller's own", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* search({
        query: "reconnect",
        scope: "project",
        reportOtherProjectMatches: false,
      });

      assert.deepStrictEqual(
        result.results.map((hit) => hit.threadId),
        ["thread-home"],
      );
      // Withheld, because the rows were never read.
      assert.strictEqual(result.otherProjectMatches, 0);
      assert.strictEqual(result.truncated, false);
    }),
  );

  it.effect("reports out-of-project matches as a count without exposing them", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* search({
        query: "reconnect",
        scope: "project",
        reportOtherProjectMatches: true,
      });

      assert.deepStrictEqual(
        result.results.map((hit) => hit.threadId),
        ["thread-home"],
      );
      // thread-other only; the deleted project's thread is not a match at all.
      assert.strictEqual(result.otherProjectMatches, 1);
    }),
  );

  it.effect("returns other projects' threads only when widened, labelled by project", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* search({
        query: "reconnect",
        scope: "all",
        reportOtherProjectMatches: true,
      });

      assert.deepStrictEqual(
        result.results.map((hit) => hit.threadId),
        ["thread-home", "thread-other"],
      );
      assert.deepStrictEqual(
        result.results.map((hit) => hit.projectTitle),
        ["Home", "Other Customer"],
      );
      assert.strictEqual(result.otherProjectMatches, 1);
    }),
  );

  it.effect("excludes soft-deleted threads and threads in deleted projects", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* search({
        query: "reconnect",
        scope: "all",
        reportOtherProjectMatches: true,
      });

      const threadIds = new Set(result.results.map((hit) => hit.threadId));
      assert.ok(!threadIds.has(ThreadId.make("thread-deleted")));
      assert.ok(!threadIds.has(ThreadId.make("thread-orphan")));
    }),
  );

  it.effect("returns a highlighted snippet for the matching message", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* search({
        query: "backoff",
        scope: "project",
        reportOtherProjectMatches: false,
      });

      assert.strictEqual(result.results.length, 1);
      assert.ok(result.results[0]?.snippet.includes("[backoff]"));
    }),
  );

  it.effect("returns nothing for a query with no searchable terms", () =>
    Effect.gen(function* () {
      yield* seed;
      const result = yield* search({
        query: "***",
        scope: "all",
        reportOtherProjectMatches: true,
      });

      assert.deepStrictEqual(result.results, []);
      assert.strictEqual(result.otherProjectMatches, 0);
    }),
  );
});
