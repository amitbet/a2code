/**
 * MCP `threads` toolkit — lets an agent find and read prior conversation
 * history instead of relying on the user to name the relevant thread up front.
 *
 * Two tools, deliberately split: `thread_search` returns titles and snippets
 * cheaply, and `thread_read` materializes one full transcript on demand. The
 * transcript is returned as a path rather than inlined, matching
 * `threadContextArtifact` — inlining a large transcript makes agents skim it and
 * burns context window for history that may not be relevant.
 *
 * Both tools are project-scoped. See `handlers.ts` for how the boundary is
 * enforced and when it may be widened.
 *
 * @module threadsToolkit
 */
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import { ServerConfig } from "../../../config.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionThreadSearchRepository } from "../../../persistence/Services/ProjectionThreadSearch.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ProjectionThreadSearchRepository,
  ProjectionSnapshotQuery,
  ServerSettingsService,
  ServerConfig,
  FileSystem.FileSystem,
  Path.Path,
];

export class ThreadHistoryUnavailableError extends Schema.TaggedErrorClass<ThreadHistoryUnavailableError>()(
  "ThreadHistoryUnavailableError",
  { reason: Schema.String },
) {
  override get message(): string {
    return `Thread history is unavailable: ${this.reason}`;
  }
}

export class ThreadNotFoundError extends Schema.TaggedErrorClass<ThreadNotFoundError>()(
  "ThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread '${this.threadId}' was not found, or is outside this project.`;
  }
}

export class CrossProjectSearchDisabledError extends Schema.TaggedErrorClass<CrossProjectSearchDisabledError>()(
  "CrossProjectSearchDisabledError",
  {},
) {
  override get message(): string {
    return "Cross-project thread search is disabled by server settings. Only this project's history is available.";
  }
}

export const ThreadHistoryError = Schema.Union([
  ThreadHistoryUnavailableError,
  ThreadNotFoundError,
  CrossProjectSearchDisabledError,
]);
export type ThreadHistoryError = typeof ThreadHistoryError.Type;

export const ThreadSearchToolInput = Schema.Struct({
  /** Free-form search terms. Matching is conjunctive over whole words. */
  query: Schema.String,
  scope: Schema.optional(Schema.Literals(["project", "all"])),
  limit: Schema.optional(Schema.Number),
});

export const ThreadSearchToolResultHit = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  projectId: ProjectId,
  projectTitle: Schema.String,
  updatedAt: Schema.String,
  snippet: Schema.String,
});

export const ThreadSearchToolResult = Schema.Struct({
  results: Schema.Array(ThreadSearchToolResultHit),
  otherProjectMatches: Schema.Number,
  truncated: Schema.Boolean,
  scope: Schema.Literals(["project", "all"]),
});

export const ThreadReadToolInput = Schema.Struct({
  threadId: ThreadId,
});

export const ThreadReadToolResult = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  projectId: ProjectId,
  /** Absolute path to the generated Markdown transcript. */
  path: Schema.String,
  sizeBytes: Schema.Number,
  messageCount: Schema.Number,
});

export const ThreadSearchTool = Tool.make("thread_search", {
  description:
    "Search this project's earlier conversation threads by keyword, newest-relevant first. Use it before deep exploration when the request refers to prior work, past decisions, or something that was 'done before'; skip it for self-contained requests. Returns thread titles with matching excerpts — call thread_read for the full transcript of a promising hit. If otherProjectMatches is greater than zero and this project's results do not answer the question, you may retry with scope='all' to search other projects. Prefer results from the current project.",
  parameters: ThreadSearchToolInput,
  success: ThreadSearchToolResult,
  failure: ThreadHistoryError,
  dependencies,
})
  .annotate(Tool.Title, "Search thread history")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ThreadReadTool = Tool.make("thread_read", {
  description:
    "Write another thread's full conversation transcript (messages plus tool calls and results) to a Markdown file and return its path. Read that file with your file-reading tools; the content is intentionally not inlined. Use after thread_search identifies a relevant thread.",
  parameters: ThreadReadToolInput,
  success: ThreadReadToolResult,
  failure: ThreadHistoryError,
  dependencies,
})
  .annotate(Tool.Title, "Read thread transcript")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ThreadsToolkit = Toolkit.make(ThreadSearchTool, ThreadReadTool);
