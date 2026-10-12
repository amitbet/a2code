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
 * checkout until the thread is promoted. After promotion, each provider thread
 * is told once that those instructions no longer apply: dropping the note is
 * invisible to an agent whose native history still carries it.
 *
 * @module SideQuestion
 */
import type {
  ModelSelection,
  OrchestrationV2Actor,
  OrchestrationV2AppThread,
  OrchestrationV2CreationSource,
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

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

/** Prepended once per provider thread after a side question is promoted. */
export const SIDE_QUESTION_PROMOTED_INSTRUCTIONS =
  "This thread was a side question and has been promoted to a regular thread. The earlier instruction not to modify files or change state no longer applies; work on the user's requests as this thread's agent.";

/**
 * The promotion note for a provider turn on `providerThreadId`, or "". Owed
 * until a turn on that provider thread started after promotion and reached the
 * provider, so delivery is derived rather than cleared. Compactions carry no
 * notes and rolled-back runs leave native history, so neither counts; an
 * earlier attempt of the starting run (a steer) does.
 */
export function sideQuestionPromotedTurnNote(input: {
  readonly thread: Pick<OrchestrationV2AppThread, "sideQuestionOf" | "sideQuestionPromotedAt">;
  /** The provider thread the turn starts on. */
  readonly providerThreadId: ProviderThreadId;
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "status">>;
  readonly attempts: ReadonlyArray<Pick<OrchestrationV2RunAttempt, "id" | "runId">>;
  readonly providerTurns: ReadonlyArray<
    Pick<OrchestrationV2ProviderTurn, "providerThreadId" | "runAttemptId" | "status" | "startedAt">
  >;
  readonly compactionRunIds: ReadonlySet<RunId>;
}): string {
  const promotedAt = input.thread.sideQuestionPromotedAt ?? null;
  if (promotedAt === null || isSideQuestionThread(input.thread)) return "";
  const rolledBackRunIds = new Set(
    input.runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
  );
  const runIdByAttempt = new Map(input.attempts.map((attempt) => [attempt.id, attempt.runId]));
  const delivered = input.providerTurns.some((turn) => {
    if (turn.providerThreadId !== input.providerThreadId) return false;
    if (turn.status !== "completed" && turn.status !== "interrupted") return false;
    if (turn.startedAt === null || DateTime.isLessThan(turn.startedAt, promotedAt)) return false;
    const runId = turn.runAttemptId === null ? undefined : runIdByAttempt.get(turn.runAttemptId);
    return (
      runId !== undefined && !rolledBackRunIds.has(runId) && !input.compactionRunIds.has(runId)
    );
  });
  return delivered ? "" : SIDE_QUESTION_PROMOTED_INSTRUCTIONS;
}

/**
 * The promotion time a fork of `source` at `sourceRun` keeps. The fork copies
 * native history up to `sourceRun`, so a run that started after promotion
 * already carried the promotion note into it.
 */
export function forkSideQuestionPromotedAt(
  source: Pick<OrchestrationV2AppThread, "sideQuestionPromotedAt">,
  sourceRun: Pick<OrchestrationV2Run, "startedAt">,
): DateTime.Utc | null {
  const promotedAt = source.sideQuestionPromotedAt ?? null;
  return promotedAt !== null &&
    sourceRun.startedAt !== null &&
    !DateTime.isLessThan(sourceRun.startedAt, promotedAt)
    ? null
    : promotedAt;
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
