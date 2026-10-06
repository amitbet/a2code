import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { withoutNestedChildThreads, withoutNestedSubagents } from "./subagents.ts";

const lineage = (
  parentThreadId: string | null,
  relationshipToParent: "subagent" | "fork" | null,
) => ({
  rootThreadId: ThreadId.make("parent"),
  parentThreadId: parentThreadId === null ? null : ThreadId.make(parentThreadId),
  relationshipToParent,
});

describe("withoutNestedSubagents", () => {
  const parent = { id: ThreadId.make("parent"), lineage: lineage(null, null) };
  const agent = { id: ThreadId.make("agent"), lineage: lineage("parent", "subagent") };
  const orphan = { id: ThreadId.make("orphan"), lineage: lineage("gone", "subagent") };
  const fork = { id: ThreadId.make("fork"), lineage: lineage("parent", "fork") };

  it("drops subagents whose parent is listed and keeps orphans and forks", () => {
    expect(
      withoutNestedSubagents([parent, agent, orphan, fork]).map((thread) => thread.id),
    ).toEqual(["parent", "orphan", "fork"]);
  });

  it("returns the same array when nothing nests", () => {
    const plain = [parent, fork];
    expect(withoutNestedSubagents(plain)).toBe(plain);
  });

  it("also drops nested side questions", () => {
    const side = {
      id: ThreadId.make("side"),
      lineage: lineage("parent", null),
      sideQuestionOf: ThreadId.make("parent"),
    };
    expect(
      withoutNestedChildThreads([
        { ...parent, sideQuestionOf: null },
        { ...agent, sideQuestionOf: null },
        side,
      ]).map((thread) => thread.id),
    ).toEqual(["parent"]);
  });
});
