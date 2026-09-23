/**
 * Client rules for `/btw` side questions: parsing the composer command and
 * nesting side-question threads under their parent in thread lists.
 *
 * A side question is an ordinary thread whose shell carries `sideQuestionOf`.
 * Lists hide it at the top level while its parent is known (even archived,
 * so archiving a parent takes its asides with it) and show it under the
 * parent instead. A side question whose parent is gone is listed like any
 * other thread so it never becomes unreachable.
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

interface SideQuestionCandidate {
  readonly id: ThreadId;
  readonly sideQuestionOf?: ThreadId | null | undefined;
}

/** True when `thread` belongs under a parent that `isKnownThread` recognizes. */
function isNestedSideQuestion(
  thread: SideQuestionCandidate,
  isKnownThread: (threadId: ThreadId) => boolean,
): boolean {
  const parentId = thread.sideQuestionOf ?? null;
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
  if (!threads.some((thread) => (thread.sideQuestionOf ?? null) !== null)) {
    return threads;
  }
  const knownIds = new Set(threads.map((thread) => thread.id));
  return threads.filter((thread) => !isNestedSideQuestion(thread, (id) => knownIds.has(id)));
}
