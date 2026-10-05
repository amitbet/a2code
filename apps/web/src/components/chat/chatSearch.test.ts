import { describe, expect, it } from "vite-plus/test";

import { type TimelineEntry } from "../../session-logic";
import {
  clampActiveIndex,
  computeChatSearchOccurrences,
  countOccurrences,
  getRowSearchText,
  withSearchDisclosure,
} from "./chatSearch";
import { deriveMessagesTimelineRows, type MessagesTimelineRow } from "./MessagesTimeline.logic";

const at = (second: number) => `2026-01-01T00:00:${String(second).padStart(2, "0")}Z`;

function message(
  id: string,
  role: "user" | "assistant",
  text: string,
  second: number,
): TimelineEntry {
  return {
    id: `${id}-entry`,
    kind: "message",
    createdAt: at(second),
    message: {
      id: id as never,
      role,
      text,
      runId: (role === "assistant" ? "run-1" : null) as never,
      createdAt: at(second),
      updatedAt: at(second),
      streaming: false,
    },
  };
}

function work(id: string, label: string, second: number): TimelineEntry {
  return {
    id,
    kind: "work",
    createdAt: at(second),
    entry: {
      id,
      createdAt: at(second),
      runId: "run-1" as never,
      label,
      command: label,
      tone: "tool",
      itemType: "command_execution",
      toolLifecycleStatus: "completed",
    },
  };
}

// A settled turn: its two commands fold behind "Worked for ...".
const settledTurn: TimelineEntry[] = [
  message("prompt", "user", "Run the deploy checks", 0),
  work("check-a", "vp run deploy-check", 1),
  work("check-b", "vp run smoke", 2),
  message("final", "assistant", "Deploy checks passed", 5),
];

function rowsFor(input: {
  readonly expandAllDisclosures?: boolean;
  readonly expandedRunIds?: ReadonlySet<never>;
  readonly expandedWorkGroupIds?: ReadonlySet<string>;
}): MessagesTimelineRow[] {
  return deriveMessagesTimelineRows({
    timelineEntries: settledTurn,
    isWorking: false,
    latestRun: {
      runId: "run-1" as never,
      status: "completed",
      startedAt: at(0),
      completedAt: at(5),
    },
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    ...input,
  });
}

describe("countOccurrences", () => {
  it("counts non-overlapping matches of a normalized needle, ignoring case", () => {
    expect(countOccurrences("Foo foo FOO bar", "foo")).toBe(3);
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences("anything", "")).toBe(0);
  });
});

describe("getRowSearchText", () => {
  it("indexes the full question and the chosen answers of an answered exchange", () => {
    const row = {
      kind: "user-input",
      id: "question",
      createdAt: at(0),
      exchange: {
        requestId: "request",
        runId: null,
        answers: [
          {
            questionId: "db",
            header: "Database",
            question: "Which database should the service use?",
            values: ["Postgres"],
            custom: false,
            attachments: [],
          },
        ],
      },
    } as unknown as MessagesTimelineRow;
    const text = getRowSearchText(row, undefined);
    expect(text).toContain("Which database should the service use?");
    expect(text).toContain("Postgres");
    expect(text).toContain("Database");
  });
});

describe("computeChatSearchOccurrences", () => {
  it("finds matches hidden in a folded turn, in document order", () => {
    const visible = rowsFor({});
    // The user's view folds both commands away.
    expect(computeChatSearchOccurrences(visible, "vp run", undefined).occurrences).toEqual([]);

    const searchRows = rowsFor({ expandAllDisclosures: true });
    const result = computeChatSearchOccurrences(searchRows, "  VP RUN ", undefined);
    expect(result.occurrences.length).toBeGreaterThanOrEqual(2);
    const firstRow = searchRows.find((row) => row.id === result.occurrences[0]!.rowId)!;
    // The row says what to open: the turn fold and, for a collapsed group, the group.
    expect(firstRow.searchReveal?.runId).toBe("run-1");
  });

  it("reveals exactly the hidden row once its disclosures are applied", () => {
    const searchRows = rowsFor({ expandAllDisclosures: true });
    const [match] = computeChatSearchOccurrences(searchRows, "smoke", undefined).occurrences;
    const reveal = searchRows.find((row) => row.id === match!.rowId)!.searchReveal!;
    const revealed = rowsFor({
      expandedRunIds: withSearchDisclosure(new Set<never>(), reveal.runId as never),
      expandedWorkGroupIds: withSearchDisclosure(new Set<string>(), reveal.workGroupId),
    });
    expect(revealed.some((row) => row.id === match!.rowId)).toBe(true);
    // Rows the user can already see need nothing opened.
    const final = searchRows.find((row) => row.id === "final-entry");
    expect(final?.searchReveal).toBeUndefined();
  });

  it("returns no matches for a blank query", () => {
    expect(computeChatSearchOccurrences(rowsFor({}), "   ", undefined)).toEqual({
      occurrences: [],
      matchingRowCount: 0,
    });
  });
});

describe("withSearchDisclosure", () => {
  it("keeps the user's set when nothing new opens", () => {
    const expanded = new Set(["a"]);
    expect(withSearchDisclosure(expanded, undefined)).toBe(expanded);
    expect(withSearchDisclosure(expanded, "a")).toBe(expanded);
    expect([...withSearchDisclosure(expanded, "b")]).toEqual(["a", "b"]);
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
