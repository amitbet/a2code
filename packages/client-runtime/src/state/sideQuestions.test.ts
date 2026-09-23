import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  parseSideQuestionCommand,
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

  it("returns the same array when nothing nests", () => {
    const plain = [parent];
    expect(withoutNestedSideQuestions(plain)).toBe(plain);
  });
});
