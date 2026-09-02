import { describe, expect, it } from "vite-plus/test";

import {
  formatThreadReference,
  parseThreadReferenceIds,
  resolveThreadReferenceCopyTarget,
  THREAD_REFERENCE_PREFIX,
} from "./threadReference.ts";

describe("threadReference", () => {
  it("formats a token from a thread id", () => {
    expect(formatThreadReference("abc-123")).toBe(`${THREAD_REFERENCE_PREFIX}abc-123`);
  });

  it("extracts referenced ids in order, de-duplicated", () => {
    const ids = parseThreadReferenceIds(
      "compare @thread_ref:thread-a with @thread_ref:thread-b (again @thread_ref:thread-a)",
    );
    expect(ids).toEqual(["thread-a", "thread-b"]);
  });

  it("returns nothing when there are no references", () => {
    expect(parseThreadReferenceIds("no references here")).toEqual([]);
  });

  it("matches a uuid-style id", () => {
    const id = "0b3f2c1e-1234-4abc-8def-1234567890ab";
    expect(parseThreadReferenceIds(`see ${formatThreadReference(id)}`)).toEqual([id]);
  });
});

describe("resolveThreadReferenceCopyTarget", () => {
  it("prefers a durable linked pull request", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        threadId: "thread-1",
        linkedPullRequestUrl: "https://github.com/t3/pr/12",
        detectedPullRequestUrl: "https://github.com/t3/pr/13",
      }),
    ).toMatchObject({
      kind: "pull-request",
      value: "https://github.com/t3/pr/12",
      successTitle: "PR link copied",
    });
  });

  it("uses a pull request detected from the active branch", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        threadId: "thread-1",
        detectedPullRequestUrl: "https://github.com/t3/pr/13",
      }),
    ).toMatchObject({
      kind: "pull-request",
      value: "https://github.com/t3/pr/13",
    });
  });

  it("falls back to the thread ID", () => {
    expect(resolveThreadReferenceCopyTarget({ threadId: "thread-1" })).toEqual({
      kind: "thread",
      value: "thread-1",
      clipboardTarget: "thread ID",
      successTitle: "Thread ID copied",
      failureTitle: "Failed to copy thread ID",
    });
  });
});
