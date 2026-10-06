/**
 * Client rules for nesting subagent threads under their parent in thread lists.
 *
 * A subagent is a thread whose lineage says `relationshipToParent: "subagent"`:
 * a provider-native subagent (Claude's Agent tool, Codex or Cursor native
 * subagents) or a T3 `delegate_task` child. Lists hide it at the top level
 * while its parent is known (even archived, so archiving a parent takes its
 * agents with it) and show it under the parent instead. A subagent whose
 * parent is gone is listed like any other thread so it never becomes
 * unreachable.
 *
 * List a parent's subagents with `subagentShellsAtom` (`threadShell.ts`).
 *
 * @module subagents
 */
import type { OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";

import { withoutNestedSideQuestions, type SideQuestionCandidate } from "./sideQuestions.ts";

type SubagentCandidate = Pick<OrchestrationV2ThreadShell, "id" | "lineage">;

/** The thread a subagent belongs under, or `null` when `thread` is not a subagent. */
export function subagentParentId(thread: SubagentCandidate): ThreadId | null {
  return thread.lineage.relationshipToParent === "subagent" ? thread.lineage.parentThreadId : null;
}

/** True when `thread` belongs under a parent that `isKnownThread` recognizes. */
export function isNestedSubagent(
  thread: SubagentCandidate,
  isKnownThread: (threadId: ThreadId) => boolean,
): boolean {
  const parentId = subagentParentId(thread);
  return parentId !== null && parentId !== thread.id && isKnownThread(parentId);
}

/**
 * `threads` without the subagents that nest under a parent in the same list.
 * Returns the input array unchanged when nothing nests, so memoized consumers
 * keep their identity.
 */
export function withoutNestedSubagents<T extends SubagentCandidate>(
  threads: ReadonlyArray<T>,
): ReadonlyArray<T> {
  if (!threads.some((thread) => subagentParentId(thread) !== null)) {
    return threads;
  }
  const knownIds = new Set(threads.map((thread) => thread.id));
  return threads.filter((thread) => !isNestedSubagent(thread, (id) => knownIds.has(id)));
}

/** `threads` without the side questions and subagents that nest under a listed parent. */
export function withoutNestedChildThreads<T extends SubagentCandidate & SideQuestionCandidate>(
  threads: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return withoutNestedSubagents(withoutNestedSideQuestions(threads));
}
