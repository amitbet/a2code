/**
 * Client rules for `/btw` side questions: parsing the composer command and
 * nesting side-question threads under their parent in thread lists.
 *
 * A side question is an ordinary thread whose v2 shell carries `sideQuestionOf`
 * (the server also records the parent in `lineage.parentThreadId`, with a null
 * relationship, so fork and subagent rules never apply to it). Lists hide it at
 * the top level while its parent is known (even archived, so archiving a parent
 * takes its asides with it) and show it under the parent instead. A side
 * question whose parent is gone is listed like any other thread so it never
 * becomes unreachable.
 *
 * Ask with `askSideQuestion` and keep one as a regular thread with
 * `promoteSideQuestion` (`operations/commands.ts`, also on the thread command
 * atoms); list a parent's side questions with `sideQuestionShellsAtom`
 * (`threadShell.ts`). Offer `/btw` only when the environment advertises the
 * `threadSideQuestions` capability.
 *
 * @module sideQuestions
 */
import type { ThreadId } from "@t3tools/contracts";

const SIDE_QUESTION_COMMAND_PATTERN = /^\/btw(?:\s+([\s\S]*))?$/i;
const SIDE_QUESTION_TITLE_MAX_LENGTH = 80;

/**
 * Parse `/btw <question>` from composer text. Returns `null` when the text is
 * not the command, and an empty question for a bare `/btw`.
 */
export function parseSideQuestionCommand(text: string): { readonly question: string } | null {
  const match = SIDE_QUESTION_COMMAND_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }
  return { question: (match[1] ?? "").trim() };
}

/** Thread title for a side question: its first line, truncated. */
export function sideQuestionTitle(question: string): string {
  const firstLine = question.trim().split("\n", 1)[0]?.trim() ?? "";
  const title =
    firstLine.length > SIDE_QUESTION_TITLE_MAX_LENGTH
      ? `${firstLine.slice(0, SIDE_QUESTION_TITLE_MAX_LENGTH - 1).trimEnd()}…`
      : firstLine;
  return title.length > 0 ? title : "Side question";
}

/**
 * A raw v2 thread shell (`sideQuestionOf`) or a presented
 * `EnvironmentThreadShell`, whose raw shell is its `source`.
 */
export interface SideQuestionCandidate {
  readonly id: ThreadId;
  readonly sideQuestionOf?: ThreadId | null | undefined;
  readonly source?: { readonly sideQuestionOf?: ThreadId | null | undefined };
}

/** The thread `thread` was asked about, or null when it is not a side question. */
export function sideQuestionParentId(thread: SideQuestionCandidate): ThreadId | null {
  return thread.sideQuestionOf ?? thread.source?.sideQuestionOf ?? null;
}

export function isSideQuestion(thread: SideQuestionCandidate): boolean {
  return sideQuestionParentId(thread) !== null;
}

/** True when `thread` belongs under a parent that `isKnownThread` recognizes. */
function isNestedSideQuestion(
  thread: SideQuestionCandidate,
  isKnownThread: (threadId: ThreadId) => boolean,
): boolean {
  const parentId = sideQuestionParentId(thread);
  return parentId !== null && parentId !== thread.id && isKnownThread(parentId);
}

/**
 * `threads` without the side questions that nest under a parent in the same
 * list. Returns the input array unchanged when nothing nests, so memoized
 * consumers keep their identity.
 */
export function withoutNestedSideQuestions<T extends SideQuestionCandidate>(
  threads: ReadonlyArray<T>,
): ReadonlyArray<T> {
  if (!threads.some(isSideQuestion)) {
    return threads;
  }
  const knownIds = new Set(threads.map((thread) => thread.id));
  return threads.filter((thread) => !isNestedSideQuestion(thread, (id) => knownIds.has(id)));
}
