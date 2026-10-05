import {
  liveWorkEntryLabel,
  workEntryDisplayLabel,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";

/**
 * In-chat text search (Cmd/Ctrl+F).
 *
 * The timeline is rendered through a virtualized list, so the browser's native
 * find-in-page only sees the handful of rows currently mounted in the DOM.
 * These helpers search the underlying row data instead, producing an ordered
 * list of occurrences the UI can page through (opening the folds that hide a
 * match and scrolling it into view) while the DOM highlighter paints matches.
 *
 * Search runs over rows derived with every disclosure open, so matches inside
 * folded turns and collapsed tool groups count too; each such row carries the
 * `searchReveal` the user's view must open to show it.
 */

/** A single match occurrence, in document order (top → bottom of the chat). */
export interface ChatSearchOccurrence {
  /** Stable row id (matches `data-timeline-row-id` in the DOM). */
  readonly rowId: string;
  /** 0-based ordinal of this occurrence within its row's text. */
  readonly ordinalInRow: number;
}

export interface ChatSearchResult {
  /** Every occurrence across all rows, in document order. */
  readonly occurrences: ReadonlyArray<ChatSearchOccurrence>;
  /** Number of distinct rows that contain at least one match. */
  readonly matchingRowCount: number;
}

export const EMPTY_CHAT_SEARCH_RESULT: ChatSearchResult = { occurrences: [], matchingRowCount: 0 };

/** Search queries match case-insensitively on their trimmed text; "" means no search. */
export function normalizeChatSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Returns the searchable plain text a timeline row renders. */
export function getRowSearchText(
  row: MessagesTimelineRow,
  workspaceRoot: string | undefined,
): string {
  switch (row.kind) {
    case "message":
      return row.message.text;
    case "proposed-plan":
      return row.proposedPlan.planMarkdown;
    case "turn-fold":
    case "attempt-fold":
    case "context-compaction":
      return row.label;
    case "work-toggle":
      return row.summary;
    case "work":
      return row.displayLabel !== undefined && row.groupedEntries.length === 1
        ? row.displayLabel
        : row.groupedEntries.map((entry) => workEntryDisplayLabel(entry, workspaceRoot)).join("\n");
    case "work-live":
      return liveWorkEntryLabel(row.entry, workspaceRoot, row.active);
    case "user-input":
      return row.exchange.answers
        .flatMap((answer) => [
          ...(answer.header ? [answer.header] : []),
          answer.question,
          ...answer.values,
          ...answer.attachments.map((attachment) => attachment.name),
        ])
        .join("\n");
    // The assistant-meta row is the copy/action footer for a message row that
    // is already indexed; matching it too would double-count the same text.
    case "assistant-meta":
    // Live status, setup progress, and lifecycle event cards carry no
    // conversation text worth matching.
    case "worktree-setup":
    case "working":
    case "thinking":
    case "event":
      return "";
  }
}

/** Counts non-overlapping occurrences of an already-normalized `needle` in `text`. */
export function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  const haystack = text.toLowerCase();
  let count = 0;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    count += 1;
    from = index + needle.length;
  }
  return count;
}

/** Builds the ordered occurrence list for `query` across `rows`. */
export function computeChatSearchOccurrences(
  rows: ReadonlyArray<MessagesTimelineRow>,
  query: string,
  workspaceRoot: string | undefined,
): ChatSearchResult {
  const needle = normalizeChatSearchQuery(query);
  if (needle.length === 0) return EMPTY_CHAT_SEARCH_RESULT;

  const occurrences: ChatSearchOccurrence[] = [];
  let matchingRowCount = 0;
  for (const row of rows) {
    const count = countOccurrences(getRowSearchText(row, workspaceRoot), needle);
    if (count === 0) continue;
    matchingRowCount += 1;
    for (let ordinalInRow = 0; ordinalInRow < count; ordinalInRow += 1) {
      occurrences.push({ rowId: row.id, ordinalInRow });
    }
  }
  return { occurrences, matchingRowCount };
}

/** Clamps a stored active index into range. Returns -1 when there are no matches. */
export function clampActiveIndex(occurrenceCount: number, desiredIndex: number): number {
  if (occurrenceCount === 0) return -1;
  if (desiredIndex < 0) return 0;
  if (desiredIndex >= occurrenceCount) return occurrenceCount - 1;
  return desiredIndex;
}

/**
 * The user's expanded set plus the one disclosure find opened for the active
 * match. Returns `expanded` itself when nothing changes, so memoized row
 * derivation keeps its input identity.
 */
export function withSearchDisclosure<T>(
  expanded: ReadonlySet<T>,
  revealed: T | undefined,
): ReadonlySet<T> {
  if (revealed === undefined || expanded.has(revealed)) return expanded;
  return new Set([...expanded, revealed]);
}
