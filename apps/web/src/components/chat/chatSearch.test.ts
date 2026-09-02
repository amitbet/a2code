import { describe, expect, it } from "vite-plus/test";

import {
  clampActiveIndex,
  computeChatSearchOccurrences,
  countOccurrences,
  getRowSearchText,
} from "./chatSearch";
import { type MessagesTimelineRow } from "./MessagesTimeline.logic";

function messageRow(id: string, text: string): MessagesTimelineRow {
  return {
    kind: "message",
    id,
    createdAt: "2024-01-01T00:00:00.000Z",
    message: {
      id,
      role: "assistant",
      text,
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    durationStart: "2024-01-01T00:00:00.000Z",
    showAssistantMeta: false,
    showAssistantCopyButton: false,
    assistantCopyStreaming: false,
  } as unknown as MessagesTimelineRow;
}

describe("countOccurrences", () => {
  it("counts non-overlapping, case-insensitive matches", () => {
    expect(countOccurrences("Foo foo FOO bar", "foo")).toBe(3);
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences("nothing here", "xyz")).toBe(0);
  });

  it("returns 0 for an empty query", () => {
    expect(countOccurrences("anything", "")).toBe(0);
  });
});

describe("getRowSearchText", () => {
  it("reads work-entry labels, commands, and details", () => {
    const row: MessagesTimelineRow = {
      kind: "work",
      id: "work-1",
      createdAt: "2024-01-01T00:00:00.000Z",
      isExpandedToolGroup: false,
      groupedEntries: [
        {
          id: "entry-1",
          createdAt: "2024-01-01T00:00:00.000Z",
          label: "Ran command",
          command: "pnpm test",
          detail: "all green",
          tone: "tool",
        },
      ],
    };
    expect(getRowSearchText(row)).toContain("pnpm test");
    expect(getRowSearchText(row)).toContain("all green");
  });
});

describe("computeChatSearchOccurrences", () => {
  const rows = [
    messageRow("a", "the quick brown fox"),
    messageRow("b", "the lazy dog"),
    messageRow("c", "fox fox"),
  ];

  it("returns occurrences in document order with row indices", () => {
    const result = computeChatSearchOccurrences(rows, "fox");
    expect(result.matchingRowCount).toBe(2);
    expect(result.occurrences).toEqual([
      { rowId: "a", rowIndex: 0, ordinalInRow: 0 },
      { rowId: "c", rowIndex: 2, ordinalInRow: 0 },
      { rowId: "c", rowIndex: 2, ordinalInRow: 1 },
    ]);
  });

  it("is case-insensitive and trims the query", () => {
    expect(computeChatSearchOccurrences(rows, "  THE  ").occurrences).toHaveLength(2);
  });

  it("returns no matches for an empty query", () => {
    expect(computeChatSearchOccurrences(rows, "   ")).toEqual({
      occurrences: [],
      matchingRowCount: 0,
    });
  });
});

describe("clampActiveIndex", () => {
  it("clamps into range and reports -1 when empty", () => {
    expect(clampActiveIndex(0, 3)).toBe(-1);
    expect(clampActiveIndex(5, -2)).toBe(0);
    expect(clampActiveIndex(5, 9)).toBe(4);
    expect(clampActiveIndex(5, 2)).toBe(2);
  });
});
