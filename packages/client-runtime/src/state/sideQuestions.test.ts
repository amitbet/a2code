import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  parseSideQuestionCommand,
  resolveSideQuestionSubmission,
  sideQuestionFromComposerText,
  sideQuestionParentId,
  sideQuestionTitle,
  withoutNestedSideQuestions,
} from "./sideQuestions.ts";

describe("parseSideQuestionCommand", () => {
  it("extracts the question, including multi-line text", () => {
    expect(parseSideQuestionCommand("/btw why is CI red?")).toEqual({
      question: "why is CI red?",
    });
    expect(parseSideQuestionCommand("  /BTW first\nsecond  ")).toEqual({
      question: "first\nsecond",
    });
  });

  it("treats a bare command as an empty question and ignores other text", () => {
    expect(parseSideQuestionCommand("/btw")).toEqual({ question: "" });
    expect(parseSideQuestionCommand("/btwx question")).toBeNull();
    expect(parseSideQuestionCommand("ask /btw later")).toBeNull();
  });
});

describe("sideQuestionTitle", () => {
  it("uses the first line and truncates long questions", () => {
    expect(sideQuestionTitle("short\nmore detail")).toBe("short");
    const title = sideQuestionTitle("x".repeat(200));
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
    expect(sideQuestionTitle("   ")).toBe("Side question");
  });
});

describe("withoutNestedSideQuestions", () => {
  const parent = { id: ThreadId.make("parent"), sideQuestionOf: null };
  const child = { id: ThreadId.make("child"), sideQuestionOf: ThreadId.make("parent") };
  const orphan = { id: ThreadId.make("orphan"), sideQuestionOf: ThreadId.make("gone") };

  it("drops side questions whose parent is listed and keeps orphans", () => {
    expect(withoutNestedSideQuestions([parent, child, orphan]).map((thread) => thread.id)).toEqual([
      "parent",
      "orphan",
    ]);
  });

  it("reads the marker from a presented shell's source", () => {
    const presentedParent = { id: ThreadId.make("parent"), source: {} };
    const presentedChild = {
      id: ThreadId.make("child"),
      source: { sideQuestionOf: ThreadId.make("parent") },
    };
    expect(sideQuestionParentId(presentedChild)).toBe("parent");
    expect(
      withoutNestedSideQuestions([presentedParent, presentedChild]).map((thread) => thread.id),
    ).toEqual(["parent"]);
  });

  it("returns the same array when nothing nests", () => {
    const plain = [parent];
    expect(withoutNestedSideQuestions(plain)).toBe(plain);
  });
});

describe("sideQuestionFromComposerText", () => {
  it("strips a typed /btw and otherwise sends the text as is", () => {
    expect(sideQuestionFromComposerText("/btw why?")).toBe("why?");
    expect(sideQuestionFromComposerText("  why is CI red?  ")).toBe("why is CI red?");
    expect(sideQuestionFromComposerText("/btw")).toBe("");
  });
});

describe("resolveSideQuestionSubmission", () => {
  const latest = ThreadId.make("side-latest");
  const base = {
    question: "why?",
    hasThread: true,
    supported: true,
    hasNonTextContent: false,
    latestSideQuestionId: latest,
  };

  it("asks the trimmed question", () => {
    expect(resolveSideQuestionSubmission({ ...base, question: "  why?  " })).toEqual({
      type: "ask",
      question: "why?",
    });
  });

  it("reopens the latest side question for a bare /btw", () => {
    expect(resolveSideQuestionSubmission({ ...base, question: " " })).toEqual({
      type: "open",
      threadId: latest,
    });
    expect(
      resolveSideQuestionSubmission({ ...base, question: "", latestSideQuestionId: null }),
    ).toEqual({ type: "rejected", reason: "nothing-to-open" });
  });

  it("refuses without a started thread, before checking the server", () => {
    expect(resolveSideQuestionSubmission({ ...base, hasThread: false, supported: false })).toEqual({
      type: "rejected",
      reason: "no-thread",
    });
    expect(resolveSideQuestionSubmission({ ...base, supported: false })).toEqual({
      type: "rejected",
      reason: "unsupported",
    });
  });

  it("refuses attachments for a new question but still reopens with them", () => {
    expect(resolveSideQuestionSubmission({ ...base, hasNonTextContent: true })).toEqual({
      type: "rejected",
      reason: "text-only",
    });
    expect(
      resolveSideQuestionSubmission({ ...base, question: "", hasNonTextContent: true }),
    ).toEqual({ type: "open", threadId: latest });
  });
});
