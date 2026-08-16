/**
 * Handlers for the MCP `threads` toolkit.
 *
 * Project scoping is the load-bearing behaviour here. The calling thread's
 * project is resolved from the invocation scope — never from tool input — so an
 * agent cannot widen its own reach by claiming a different project. Whether the
 * search may read outside that project is decided by
 * `enableCrossProjectThreadSearch`, not by the model.
 *
 * @module threadsToolkitHandlers
 */
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { ServerConfig } from "../../../config.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionThreadSearchRepository } from "../../../persistence/Services/ProjectionThreadSearch.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";
import { createThreadContextArtifact } from "../../../threadContextArtifact.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  CrossProjectSearchDisabledError,
  ThreadHistoryUnavailableError,
  ThreadNotFoundError,
  ThreadsToolkit,
} from "./tools.ts";

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;

const THREAD_READ_INTRO =
  "Transcript of an earlier thread, retrieved from conversation history. Treat it as " +
  "background context: it describes work that already happened, and may be out of date " +
  "with the current state of the repository.";

/**
 * Resolve the calling thread from the invocation scope.
 *
 * The scope is minted server-side when the provider session starts, so this is
 * the trustworthy source of the caller's project.
 */
const requireCallingThread = Effect.fn("ThreadsToolkit.requireCallingThread")(function* () {
  // Checked here rather than via `requireMcpCapability`, whose failure type is
  // preview-specific; the capability set is the same one either way.
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  if (!invocation.capabilities.has("threads")) {
    return yield* new ThreadHistoryUnavailableError({ reason: "capability not granted" });
  }
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const thread = yield* snapshotQuery
    .getThreadDetailById(invocation.threadId)
    .pipe(
      Effect.mapError(
        () => new ThreadHistoryUnavailableError({ reason: "thread read model unavailable" }),
      ),
    );
  if (Option.isNone(thread)) {
    return yield* new ThreadHistoryUnavailableError({ reason: "calling thread is not projected" });
  }
  return { invocation, thread: thread.value };
});

const crossProjectSearchEnabled = Effect.fn("ThreadsToolkit.crossProjectSearchEnabled")(
  function* () {
    const settings = yield* ServerSettingsService;
    // A settings read failure must not silently widen the boundary.
    return yield* settings.getSettings.pipe(
      Effect.map((resolved) => resolved.enableCrossProjectThreadSearch),
      Effect.orElseSucceed(() => false),
    );
  },
);

const handlers = {
  thread_search: Effect.fn("ThreadsToolkit.thread_search")(function* (input) {
    const { thread } = yield* requireCallingThread();
    const searchRepository = yield* ProjectionThreadSearchRepository;
    const crossProjectAllowed = yield* crossProjectSearchEnabled();

    const requestedScope = input.scope ?? "project";
    if (requestedScope === "all" && !crossProjectAllowed) {
      return yield* new CrossProjectSearchDisabledError();
    }

    const limit = Math.min(
      MAX_SEARCH_LIMIT,
      Math.max(1, Math.trunc(input.limit ?? DEFAULT_SEARCH_LIMIT)),
    );

    const result = yield* searchRepository
      .search({
        query: input.query,
        projectId: thread.projectId,
        excludeThreadId: thread.id,
        scope: requestedScope,
        // Counting out-of-project matches means reading them, so it is gated on
        // the same setting that gates widening. When disabled, the query itself
        // stays inside the project.
        reportOtherProjectMatches: crossProjectAllowed,
        limit,
      })
      .pipe(
        Effect.mapError(
          () => new ThreadHistoryUnavailableError({ reason: "thread history search failed" }),
        ),
      );

    return {
      results: result.results,
      otherProjectMatches: result.otherProjectMatches,
      truncated: result.truncated,
      scope: requestedScope,
    };
  }),

  thread_read: Effect.fn("ThreadsToolkit.thread_read")(function* (input) {
    const { thread: callingThread } = yield* requireCallingThread();
    const snapshotQuery = yield* ProjectionSnapshotQuery;
    const config = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const targetId = ThreadId.make(input.threadId);
    const targetOption = yield* snapshotQuery
      .getThreadDetailById(targetId)
      .pipe(
        Effect.mapError(
          () => new ThreadHistoryUnavailableError({ reason: "thread read model unavailable" }),
        ),
      );
    if (Option.isNone(targetOption)) {
      return yield* new ThreadNotFoundError({ threadId: input.threadId });
    }
    const target = targetOption.value;

    // The same boundary as search. Without this an agent could skip search and
    // read any thread whose id it happened to learn.
    const crossProjectAllowed = yield* crossProjectSearchEnabled();
    if (!crossProjectAllowed && target.projectId !== callingThread.projectId) {
      return yield* new ThreadNotFoundError({ threadId: input.threadId });
    }

    const artifact = yield* createThreadContextArtifact({
      attachmentsDir: config.attachmentsDir,
      threadId: callingThread.id,
      messages: target.messages,
      activities: target.activities,
      latestTurn: target.latestTurn,
      fileName: `thread-history-${targetId}.md`,
      sourceTitle: target.title,
      intro: THREAD_READ_INTRO,
      fileSystem,
      path,
    }).pipe(
      Effect.mapError(
        () => new ThreadHistoryUnavailableError({ reason: "failed to write thread transcript" }),
      ),
    );
    if (artifact === undefined) {
      return yield* new ThreadHistoryUnavailableError({
        reason: "failed to write thread transcript",
      });
    }

    return {
      threadId: target.id,
      title: target.title,
      projectId: target.projectId,
      path: artifact.absolutePath,
      sizeBytes: artifact.sizeBytes,
      messageCount: target.messages.length,
    };
  }),
} satisfies Parameters<typeof ThreadsToolkit.toLayer>[0];

export const ThreadsToolkitHandlersLive = ThreadsToolkit.toLayer(handlers);
