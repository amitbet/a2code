import { type MessagesTimelineRow } from "./MessagesTimeline.logic";

/**
 * In-chat text search (Cmd/Ctrl+F).
 *
 * The timeline is rendered through a virtualized list, so the browser's native
 * find-in-page only sees the handful of rows currently mounted in the DOM.
 * These helpers search the underlying row data instead, producing an ordered
 * list of occurrences that the UI can page through (scrolling each match into
 * view) and a per-row count the DOM highlighter uses to paint matches.
 */

/** A single match occurrence, in document order (top → bottom of the chat). */
export interface ChatSearchOccurrence {
  /** Stable row id (matches `data-timeline-row-id` in the DOM). */
  rowId: string;
  /** Index of the row in the rendered list — used for `scrollToIndex`. */
  rowIndex: number;
  /** 0-based ordinal of this occurrence within its row's text. */
  ordinalInRow: number;
}

export interface ChatSearchResult {
  /** Every occurrence across all rows, in document order. */
  occurrences: ChatSearchOccurrence[];
  /** Number of distinct rows that contain at least one match. */
  matchingRowCount: number;
}

const EMPTY_RESULT: ChatSearchResult = { occurrences: [], matchingRowCount: 0 };

/** Returns the searchable plain text for a timeline row. */
export function getRowSearchText(row: MessagesTimelineRow): string {
  switch (row.kind) {
    case "message":
      return row.message.text ?? "";
    case "proposed-plan":
      return row.proposedPlan.planMarkdown ?? "";
    case "turn-fold":
      return row.label;
    case "work": {
      const parts: string[] = [];
      for (const entry of row.groupedEntries) {
        if (entry.toolTitle) parts.push(entry.toolTitle);
        if (entry.label) parts.push(entry.label);
        if (entry.command) parts.push(entry.command);
        else if (entry.rawCommand) parts.push(entry.rawCommand);
        if (entry.detail) parts.push(entry.detail);
        if (entry.changedFiles?.length) parts.push(entry.changedFiles.join(" "));
      }
      return parts.join("\n");
    }
    case "user-input": {
      const parts: string[] = [];
      for (const answer of row.exchange.answers) {
        if (answer.header) parts.push(answer.header);
        parts.push(answer.question);
        if (answer.values.length) parts.push(answer.values.join(" "));
      }
      return parts.join("\n");
    }
    case "work-live": {
      const parts: string[] = [];
      const entry = row.entry;
      if (entry.toolTitle) parts.push(entry.toolTitle);
      if (entry.label) parts.push(entry.label);
      if (entry.command) parts.push(entry.command);
      else if (entry.rawCommand) parts.push(entry.rawCommand);
      if (entry.detail) parts.push(entry.detail);
      if (entry.changedFiles?.length) parts.push(entry.changedFiles.join(" "));
      return parts.join("\n");
    }
    case "work-toggle":
      return row.summary ?? "";
    // Live status rows carry no user-visible text to match against.
    case "working":
    case "thinking":
      return "";
  }
}

/** Counts non-overlapping, case-insensitive occurrences of `query` in `text`. */
export function countOccurrences(text: string, query: string): number {
  if (query.length === 0) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
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

/**
 * Builds the ordered occurrence list for `query` across `rows`. Matching is
 * case-insensitive and trims the query; an empty/whitespace query yields no
 * matches.
 */
export function computeChatSearchOccurrences(
  rows: ReadonlyArray<MessagesTimelineRow>,
  query: string,
): ChatSearchResult {
  const trimmed = query.trim();
  if (trimmed.length === 0) return EMPTY_RESULT;

  const occurrences: ChatSearchOccurrence[] = [];
  let matchingRowCount = 0;

  rows.forEach((row, rowIndex) => {
    const count = countOccurrences(getRowSearchText(row), trimmed);
    if (count === 0) return;
    matchingRowCount += 1;
    for (let ordinalInRow = 0; ordinalInRow < count; ordinalInRow += 1) {
      occurrences.push({ rowId: row.id, rowIndex, ordinalInRow });
    }
  });

  return { occurrences, matchingRowCount };
}

/**
 * Re-maps an active occurrence onto a freshly computed result so navigation
 * survives content/query changes: keeps the same ordinal where possible,
 * otherwise clamps into range. Returns -1 when there are no matches.
 */
export function clampActiveIndex(occurrenceCount: number, desiredIndex: number): number {
  if (occurrenceCount === 0) return -1;
  if (desiredIndex < 0) return 0;
  if (desiredIndex >= occurrenceCount) return occurrenceCount - 1;
  return desiredIndex;
}
