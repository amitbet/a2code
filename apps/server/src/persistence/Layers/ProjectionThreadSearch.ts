import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { IsoDateTime, ProjectId, ThreadId } from "@t3tools/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionThreadSearchRepository,
  type ProjectionThreadSearchRepositoryShape,
  type SearchProjectionThreadsInput,
  type ThreadSearchHit,
  type ThreadSearchResult,
} from "../Services/ProjectionThreadSearch.ts";

/**
 * Upper bound on matching *messages* pulled from one FTS scan, before they are
 * collapsed to one hit per thread.
 *
 * FTS5 ranks messages, not threads, and a single chatty thread can occupy many
 * rows, so this is set well above the caller's thread `limit`. Cross-project
 * searches order in-project matches ahead of the rest, so the cap only ever
 * truncates the out-of-project tail and cannot cost in-project recall.
 */
const MATCH_SCAN_CAP = 400;

/** Snippet width in tokens. Wide enough to read, short enough to scan a list of hits. */
const SNIPPET_TOKENS = 24;

const SNIPPET_OPEN = "[";
const SNIPPET_CLOSE = "]";
const SNIPPET_ELLIPSIS = "...";

const ThreadSearchRowSchema = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  projectId: ProjectId,
  projectTitle: Schema.String,
  updatedAt: IsoDateTime,
  snippet: Schema.String,
  inProject: Schema.Number,
});
type ThreadSearchRow = typeof ThreadSearchRowSchema.Type;

const ScopedSearchRequest = Schema.Struct({
  match: Schema.String,
  projectId: ProjectId,
  excludeThreadId: Schema.String,
});

const toHit = (row: ThreadSearchRow): ThreadSearchHit => ({
  threadId: row.threadId,
  title: row.title,
  projectId: row.projectId,
  projectTitle: row.projectTitle,
  updatedAt: row.updatedAt,
  snippet: row.snippet,
});

/**
 * Collapse message-level matches to one hit per thread, preserving order.
 *
 * Rows arrive best-first, so the first row seen for a thread is its strongest
 * message and the one whose snippet is worth showing.
 */
function bestPerThread(rows: ReadonlyArray<ThreadSearchRow>): ReadonlyArray<ThreadSearchRow> {
  const seen = new Set<string>();
  const best: ThreadSearchRow[] = [];
  for (const row of rows) {
    if (seen.has(row.threadId)) {
      continue;
    }
    seen.add(row.threadId);
    best.push(row);
  }
  return best;
}

/**
 * Build an FTS5 MATCH expression from free-form text.
 *
 * Agent-supplied queries routinely contain characters FTS5 reads as syntax
 * (`"`, `*`, `-`, `:`, `NEAR`), which would either raise a malformed-query
 * error mid-turn or silently mean something the caller did not intend. Terms
 * are extracted and re-quoted as phrases, so the query is always well-formed
 * and matching is plain conjunctive term search.
 *
 * Returns `undefined` when nothing searchable is left.
 */
export function toFtsMatchExpression(query: string): string | undefined {
  const terms = query.match(/[\p{L}\p{N}_]+/gu);
  if (terms === null || terms.length === 0) {
    return undefined;
  }
  return terms.map((term) => `"${term}"`).join(" ");
}

const EMPTY_RESULT: ThreadSearchResult = {
  results: [],
  otherProjectMatches: 0,
  truncated: false,
};

const makeProjectionThreadSearchRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // `bm25` and `snippet` are FTS5 auxiliary functions: they read the match
  // context of the row being returned, so they must be projected directly by
  // the query that does the MATCH and cannot be nested in an aggregate. Ranking
  // therefore happens per message here and collapses to per thread in
  // `bestPerThread`. bm25 is negative — lower is better.
  //
  // Scoped search: every predicate that bounds visibility is part of the
  // matching query, so rows belonging to other projects are never returned to
  // this process. This is the privacy boundary, not a filter applied afterwards.
  const searchWithinProjectRows = SqlSchema.findAll({
    Request: ScopedSearchRequest,
    Result: ThreadSearchRowSchema,
    execute: ({ match, projectId, excludeThreadId }) => sql`
      SELECT
        m.thread_id AS "threadId",
        t.title AS "title",
        t.project_id AS "projectId",
        p.title AS "projectTitle",
        t.updated_at AS "updatedAt",
        snippet(
          projection_thread_messages_fts,
          0,
          ${SNIPPET_OPEN},
          ${SNIPPET_CLOSE},
          ${SNIPPET_ELLIPSIS},
          ${SNIPPET_TOKENS}
        ) AS "snippet",
        1 AS "inProject",
        bm25(projection_thread_messages_fts) AS "score"
      FROM projection_thread_messages_fts
      JOIN projection_thread_messages m ON m.rowid = projection_thread_messages_fts.rowid
      JOIN projection_threads t ON t.thread_id = m.thread_id
      JOIN projection_projects p ON p.project_id = t.project_id
      WHERE projection_thread_messages_fts MATCH ${match}
        AND t.project_id = ${projectId}
        AND t.deleted_at IS NULL
        AND p.deleted_at IS NULL
        AND t.thread_id <> ${excludeThreadId}
      ORDER BY "score" ASC
      LIMIT ${MATCH_SCAN_CAP}
    `,
  });

  // Cross-project search: one scan, in-project matches ordered first so the cap
  // truncates only the out-of-project tail. The caller partitions on
  // `inProject` — returning the near threads and counting the far ones.
  const searchAllProjectsRows = SqlSchema.findAll({
    Request: ScopedSearchRequest,
    Result: ThreadSearchRowSchema,
    execute: ({ match, projectId, excludeThreadId }) => sql`
      SELECT
        m.thread_id AS "threadId",
        t.title AS "title",
        t.project_id AS "projectId",
        p.title AS "projectTitle",
        t.updated_at AS "updatedAt",
        snippet(
          projection_thread_messages_fts,
          0,
          ${SNIPPET_OPEN},
          ${SNIPPET_CLOSE},
          ${SNIPPET_ELLIPSIS},
          ${SNIPPET_TOKENS}
        ) AS "snippet",
        (t.project_id = ${projectId}) AS "inProject",
        bm25(projection_thread_messages_fts) AS "score"
      FROM projection_thread_messages_fts
      JOIN projection_thread_messages m ON m.rowid = projection_thread_messages_fts.rowid
      JOIN projection_threads t ON t.thread_id = m.thread_id
      JOIN projection_projects p ON p.project_id = t.project_id
      WHERE projection_thread_messages_fts MATCH ${match}
        AND t.deleted_at IS NULL
        AND p.deleted_at IS NULL
        AND t.thread_id <> ${excludeThreadId}
      ORDER BY "inProject" DESC, "score" ASC
      LIMIT ${MATCH_SCAN_CAP}
    `,
  });

  const search: ProjectionThreadSearchRepositoryShape["search"] = (
    input: SearchProjectionThreadsInput,
  ) => {
    const match = toFtsMatchExpression(input.query);
    if (match === undefined) {
      return Effect.succeed(EMPTY_RESULT);
    }
    // Thread ids are always non-empty, so the empty sentinel excludes nothing.
    // It keeps one prepared statement per scope instead of branching the SQL.
    const request = {
      match,
      projectId: input.projectId,
      excludeThreadId: input.excludeThreadId ?? "",
    };
    const limit = Math.max(0, Math.trunc(input.limit));

    // Reading other projects' rows is what crosses the boundary, so the scoped
    // query is used whenever nothing outside the project may be read — whether
    // because the caller asked to stay in-project with no hint, or because
    // cross-project search is disabled outright.
    if (input.scope === "project" && !input.reportOtherProjectMatches) {
      return searchWithinProjectRows(request).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionThreadSearchRepository.search:project")),
        Effect.map((rows) => ({
          results: bestPerThread(rows).slice(0, limit).map(toHit),
          otherProjectMatches: 0,
          truncated: rows.length >= MATCH_SCAN_CAP,
        })),
      );
    }

    return searchAllProjectsRows(request).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadSearchRepository.search:all")),
      Effect.map((rows) => {
        const threads = bestPerThread(rows);
        const inProject = threads.filter((row) => row.inProject === 1);
        const otherProject = threads.filter((row) => row.inProject !== 1);
        // `scope: "project"` still returns only in-project threads here; the
        // out-of-project rows were read solely to count them.
        const visible = input.scope === "project" ? inProject : [...inProject, ...otherProject];
        return {
          results: visible.slice(0, limit).map(toHit),
          otherProjectMatches: otherProject.length,
          truncated: rows.length >= MATCH_SCAN_CAP,
        };
      }),
    );
  };

  return { search } satisfies ProjectionThreadSearchRepositoryShape;
});

export const ProjectionThreadSearchRepositoryLive = Layer.effect(
  ProjectionThreadSearchRepository,
  makeProjectionThreadSearchRepository,
);
