import type { ThreadPullRequestLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatThreadReference,
  parseThreadReferences,
  partitionThreadReferences,
  resolveThreadReferenceCopyTarget,
  THREAD_REFERENCE_PREFIX,
  threadReferenceKey,
} from "./threadReference.ts";

describe("threadReference", () => {
  it("formats an unqualified token from a thread id", () => {
    expect(formatThreadReference({ threadId: "abc-123" })).toBe(
      `${THREAD_REFERENCE_PREFIX}abc-123`,
    );
  });

  it("formats an environment-qualified token", () => {
    expect(formatThreadReference({ environmentId: "env-1", threadId: "abc-123" })).toBe(
      `${THREAD_REFERENCE_PREFIX}env-1/abc-123`,
    );
  });

  it("extracts references in order, de-duplicated", () => {
    const references = parseThreadReferences(
      "compare @thread_ref:thread-a with @thread_ref:thread-b (again @thread_ref:thread-a)",
    );
    expect(references).toEqual([{ threadId: "thread-a" }, { threadId: "thread-b" }]);
  });

  it("reads the environment out of a qualified token", () => {
    expect(parseThreadReferences("see @thread_ref:env-9/thread-a here")).toEqual([
      { environmentId: "env-9", threadId: "thread-a" },
    ]);
  });

  it("keeps the same thread on two machines apart", () => {
    expect(
      parseThreadReferences("@thread_ref:env-1/thread-a and @thread_ref:env-2/thread-a"),
    ).toEqual([
      { environmentId: "env-1", threadId: "thread-a" },
      { environmentId: "env-2", threadId: "thread-a" },
    ]);
  });

  it("returns nothing when there are no references", () => {
    expect(parseThreadReferences("no references here")).toEqual([]);
  });

  it("round-trips a uuid-style qualified token", () => {
    const reference = {
      environmentId: "5b6a1f0e-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
      threadId: "0b3f2c1e-1234-4abc-8def-1234567890ab",
    };
    expect(parseThreadReferences(`see ${formatThreadReference(reference)}`)).toEqual([reference]);
  });

  it("keys unqualified references apart from qualified ones", () => {
    expect(threadReferenceKey({ threadId: "thread-a" })).not.toBe(
      threadReferenceKey({ environmentId: "env-1", threadId: "thread-a" }),
    );
  });
});

describe("partitionThreadReferences", () => {
  it("treats unqualified references and self-references as local", () => {
    const { local, foreign } = partitionThreadReferences(
      [
        { threadId: "thread-a" },
        { environmentId: "env-1", threadId: "thread-b" },
        { environmentId: "env-2", threadId: "thread-c" },
      ],
      "env-1",
    );
    expect(local).toEqual([{ threadId: "thread-a" }, { threadId: "thread-b" }]);
    expect(foreign).toEqual([{ environmentId: "env-2", threadId: "thread-c" }]);
  });

  it("keeps every foreign reference, one per machine", () => {
    const { local, foreign } = partitionThreadReferences(
      [
        { environmentId: "env-2", threadId: "thread-a" },
        { environmentId: "env-3", threadId: "thread-a" },
      ],
      "env-1",
    );
    expect(local).toEqual([]);
    expect(foreign).toEqual([
      { environmentId: "env-2", threadId: "thread-a" },
      { environmentId: "env-3", threadId: "thread-a" },
    ]);
  });
});

const crossRepositoryPullRequest: ThreadPullRequestLink = {
  host: "github.com",
  repository: "other/repo",
  number: 42,
  url: "https://github.com/other/repo/pull/42",
  source: "manual",
  linkedAt: "2026-01-01T00:00:00.000Z",
  snapshot: null,
  stack: null,
};

describe("resolveThreadReferenceCopyTarget", () => {
  it("does not copy another reference while the open panel URL is unavailable", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        threadId: "thread-1",
        openPanelPullRequestUrl: null,
        pullRequests: [crossRepositoryPullRequest],
        linkedPullRequestUrl: "https://github.com/t3/pr/12",
      }),
    ).toBeNull();
  });

  it("prefers the open panel pull request over the thread pull request", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        threadId: "thread-1",
        openPanelPullRequestUrl: "https://github.com/t3/pr/14",
        pullRequests: [crossRepositoryPullRequest],
        linkedPullRequestUrl: "https://github.com/t3/pr/12",
      }),
    ).toMatchObject({
      kind: "pull-request",
      value: "https://github.com/t3/pr/14",
      successTitle: "PR link copied",
    });
  });

  it.each([null, "https://github.com/t3/pr/12"])(
    "copies a native cross-repository link before the fallback URL %s",
    (linkedPullRequestUrl) => {
      expect(
        resolveThreadReferenceCopyTarget({
          threadId: "thread-1",
          pullRequests: [crossRepositoryPullRequest],
          linkedPullRequestUrl,
        }),
      ).toMatchObject({
        kind: "pull-request",
        value: crossRepositoryPullRequest.url,
      });
    },
  );

  it("copies the highest open stack layer instead of the first link", () => {
    const stack: NonNullable<ThreadPullRequestLink["stack"]> = {
      kind: "native",
      id: "stack-1",
      number: 1,
      url: "https://github.com/other/repo/stacks/1",
      base: "main",
      layers: [
        { number: 42, headBranch: "first", state: "open" },
        { number: 43, headBranch: "second", state: "open" },
      ],
    };
    const top = {
      ...crossRepositoryPullRequest,
      number: 43,
      url: "https://github.com/other/repo/pull/43",
      stack,
    };
    expect(
      resolveThreadReferenceCopyTarget({
        threadId: "thread-1",
        pullRequests: [{ ...crossRepositoryPullRequest, stack }, top],
      }),
    ).toMatchObject({ kind: "pull-request", value: top.url });
  });

  it("uses the fallback URL when native links are dismissed", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        threadId: "thread-1",
        pullRequests: [{ ...crossRepositoryPullRequest, source: "stack-dismissed" }],
        linkedPullRequestUrl: "https://github.com/t3/pr/12",
      }),
    ).toMatchObject({ kind: "pull-request", value: "https://github.com/t3/pr/12" });
  });

  it("uses the thread pull request when no panel is open", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        threadId: "thread-1",
        linkedPullRequestUrl: "https://github.com/t3/pr/12",
      }),
    ).toMatchObject({
      kind: "pull-request",
      value: "https://github.com/t3/pr/12",
      successTitle: "PR link copied",
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
