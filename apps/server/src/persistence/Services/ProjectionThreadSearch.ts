/**
 * ProjectionThreadSearchRepository - Full-text search over projected thread history.
 *
 * Backs the MCP `thread_search` tool: given an FTS5 query, returns the best
 * matching threads with a highlighted snippet, so an agent can find prior work
 * without the user having to name the thread up front.
 *
 * Scope is a privacy boundary, not a filter applied to a shared result set.
 * `"project"` pushes the project predicate into SQL, so rows outside the
 * calling thread's project are never read; `"all"` reads across projects and is
 * only reachable when the server setting allows it. See
 * `ProjectionThreadSearch` (Layers) for the query shape.
 *
 * @module ProjectionThreadSearchRepository
 */
import { IsoDateTime, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

/**
 * Widest set of threads a search may read.
 *
 * - `project`: only the project the search is scoped to.
 * - `all`: every project. Gated by `enableCrossProjectThreadSearch`.
 */
export const ThreadSearchScope = Schema.Literals(["project", "all"]);
export type ThreadSearchScope = typeof ThreadSearchScope.Type;

export const SearchProjectionThreadsInput = Schema.Struct({
  /** Free-form search text; sanitized into an FTS5 expression by the layer. */
  query: Schema.String,
  /** Project the search is scoped to, and the project results are ranked into. */
  projectId: ProjectId,
  /** Calling thread, always excluded: an agent re-reading its own thread is noise. */
  excludeThreadId: Schema.optional(ThreadId),
  /** Which threads may appear in `results`. */
  scope: ThreadSearchScope,
  /**
   * Whether to count matches outside `projectId`.
   *
   * Counting requires reading those rows, so this is what actually decides
   * whether the query crosses the project boundary — `scope` only decides what
   * comes back. Must be false unless the user has enabled cross-project search:
   * even a bare count reveals that something elsewhere matched.
   *
   * With `scope: "project"` this is the escalation hint, letting an agent learn
   * that widening would help without seeing any of it.
   */
  reportOtherProjectMatches: Schema.Boolean,
  /** Maximum threads to return. */
  limit: Schema.Number,
});
export type SearchProjectionThreadsInput = typeof SearchProjectionThreadsInput.Type;

export const ThreadSearchHit = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  projectId: ProjectId,
  /** Project title, so widened results show which project they came from. */
  projectTitle: Schema.String,
  updatedAt: IsoDateTime,
  /** Matching excerpt with hit terms wrapped in the FTS5 highlight markers. */
  snippet: Schema.String,
});
export type ThreadSearchHit = typeof ThreadSearchHit.Type;

export const ThreadSearchResult = Schema.Struct({
  results: Schema.Array(ThreadSearchHit),
  /**
   * Threads matching the query outside `projectId`, as a count only. Lets an
   * agent decide whether widening is worth it without leaking titles or text.
   * Always 0 when `reportOtherProjectMatches` is false, because those rows are
   * never read.
   */
  otherProjectMatches: Schema.Number,
  /**
   * True when the match set hit the internal scan cap, so `otherProjectMatches`
   * undercounts. In-project threads are retained ahead of the cap, so this
   * never costs in-project recall.
   */
  truncated: Schema.Boolean,
});
export type ThreadSearchResult = typeof ThreadSearchResult.Type;

/**
 * ProjectionThreadSearchRepositoryShape - Service API for thread history search.
 */
export interface ProjectionThreadSearchRepositoryShape {
  /**
   * Rank threads by best-matching message, most relevant first.
   *
   * Soft-deleted threads and projects are excluded. Returns an empty result for
   * a query with no usable search terms rather than failing.
   */
  readonly search: (
    input: SearchProjectionThreadsInput,
  ) => Effect.Effect<ThreadSearchResult, ProjectionRepositoryError>;
}

/**
 * ProjectionThreadSearchRepository - Service tag for thread history search.
 */
export class ProjectionThreadSearchRepository extends Context.Service<
  ProjectionThreadSearchRepository,
  ProjectionThreadSearchRepositoryShape
>()("t3/persistence/Services/ProjectionThreadSearch/ProjectionThreadSearchRepository") {}
