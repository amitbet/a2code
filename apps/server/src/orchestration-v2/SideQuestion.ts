/**
 * Fork-only `/btw` side questions on orchestration v2.
 *
 * A side question is an ordinary app thread created beside a parent thread
 * while the parent's agent may still be working. It carries
 * `sideQuestionOf = parent` and a lineage naming the parent with a null
 * relationship, so upstream's fork (merge-back, fork nesting) and subagent
 * (wake routing, read-only) paths never apply to it. Its first run receives
 * the parent's visible history, including the run still in flight, as a
 * context handoff, and every turn is told to answer without changing the
 * checkout until the thread is promoted.
 *
 * @module SideQuestion
 */
import type {
  ModelSelection,
  OrchestrationV2Actor,
  OrchestrationV2AppThread,
  OrchestrationV2CreationSource,
  ThreadId,
} from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";

/** Unarchived side questions a parent keeps; asking another archives the oldest. */
export const SIDE_QUESTION_MAX_UNARCHIVED_PER_PARENT = 5;

const SIDE_QUESTION_DEFAULT_TITLE = "Side question";
const SIDE_QUESTION_COVERAGE_TITLE_MAX_CHARS = 200;

/** Prepended to every provider turn while the thread is still a side question. */
export const SIDE_QUESTION_INSTRUCTIONS = [
  "This is a side question about another thread, whose history was provided as context. Its agent may still be working in the same checkout.",
  "Answer the question directly and concisely. Read files if you need to, but do not modify files, run commands that change state, or continue that thread's task.",
].join("\n");

export function isSideQuestionThread(
  thread: Pick<OrchestrationV2AppThread, "sideQuestionOf">,
): boolean {
  return (thread.sideQuestionOf ?? null) !== null;
}

/** The side-question note for a provider turn on `thread`, or "" for a regular thread. */
export function sideQuestionTurnNote(
  thread: Pick<OrchestrationV2AppThread, "sideQuestionOf">,
): string {
  return isSideQuestionThread(thread) ? SIDE_QUESTION_INSTRUCTIONS : "";
}

/**
 * The side-question thread for `parent`: same project and checkout, the
 * parent's model unless overridden, the parent's runtime mode (permissions)
 * and the default interaction mode.
 */
export function makeSideQuestionThread(input: {
  readonly parent: OrchestrationV2AppThread;
  readonly threadId: ThreadId;
  readonly title: string | undefined;
  readonly modelSelection: ModelSelection;
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
  readonly now: DateTime.Utc;
}): OrchestrationV2AppThread {
  return {
    createdBy: input.createdBy,
    creationSource: input.creationSource,
    id: input.threadId,
    projectId: input.parent.projectId,
    title: input.title ?? SIDE_QUESTION_DEFAULT_TITLE,
    providerInstanceId: input.modelSelection.instanceId,
    modelSelection: input.modelSelection,
    runtimeMode: input.parent.runtimeMode,
    interactionMode: "default",
    branch: input.parent.branch,
    worktreePath: input.parent.worktreePath,
    activeProviderThreadId: null,
    lineage: {
      parentThreadId: input.parent.id,
      relationshipToParent: null,
      rootThreadId: input.parent.lineage.rootThreadId,
    },
    sideQuestionOf: input.parent.id,
    forkedFrom: null,
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

/** Coverage line of the side question's handoff: whose history it is and how to read more. */
export function sideQuestionHandoffCoverage(
  parent: Pick<OrchestrationV2AppThread, "id" | "title">,
): string {
  const title =
    parent.title.length > SIDE_QUESTION_COVERAGE_TITLE_MAX_CHARS
      ? `${parent.title.slice(0, SIDE_QUESTION_COVERAGE_TITLE_MAX_CHARS - 3)}...`
      : parent.title;
  return [
    `Side question context. The user is asking about thread ${parent.id} (${JSON.stringify(title)}) while its agent may still be working; history below includes any turn still in progress (run-status=running).`,
    `Recover omitted history using t3_thread_read({threadId:"${parent.id}",view:"activity",limit:20,maxCharsPerItem:4000}); paginate with afterPosition=nextPosition.`,
  ].join("\n");
}

/**
 * Side questions to archive so the parent keeps at most the cap, given its
 * unarchived side questions oldest first.
 */
export function sideQuestionsOverCap<T>(
  oldestFirst: ReadonlyArray<T>,
  max = SIDE_QUESTION_MAX_UNARCHIVED_PER_PARENT,
): ReadonlyArray<T> {
  return oldestFirst.slice(0, Math.max(0, oldestFirst.length - max));
}
