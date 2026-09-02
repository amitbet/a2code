/**
 * Inline reference to another thread's context: `thread_ref:<threadId>`.
 *
 * The token is `@thread_ref:<threadId>`. A user can drop it into a message
 * (via the "Copy thread ref" action)
 * to pull another thread's transcript in as context. The server detects the
 * token on send and attaches the referenced thread's serialized transcript
 * (see `buildThreadTranscript` / `createThreadContextArtifact`) — the same
 * primitive that powers cross-provider forking.
 *
 * This module is pure and shared so the web client and server agree on the
 * exact token format.
 *
 * @module threadReference
 */

export const THREAD_REFERENCE_PREFIX = "@thread_ref:";

// Thread ids are UUIDs today, but slug-style ids are allowed too; keep the
// accepted id charset permissive and let the resolver drop unknown ids. The
// leading `@` matches the composer's other mention tokens.
const THREAD_REFERENCE_PATTERN = /@thread_ref:([A-Za-z0-9][A-Za-z0-9_-]*)/g;

/** Render the inline token for a thread id. */
export function formatThreadReference(threadId: string): string {
  return `${THREAD_REFERENCE_PREFIX}${threadId}`;
}

/**
 * Extract referenced thread ids from message text, in first-seen order and
 * de-duplicated. Returns an empty array when there are no references.
 */
export function parseThreadReferenceIds(text: string): ReadonlyArray<string> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(THREAD_REFERENCE_PATTERN)) {
    const id = match[1];
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/*
 * Below: upstream's "copy active thread reference" target resolution (the
 * keyboard shortcut / menu action picks the linked PR link over the raw thread
 * id). Unrelated to the `@thread_ref:` token above, but both are "thread
 * reference" concerns and both consumers import from this module path.
 */

export interface ThreadReferenceCopyTarget {
  readonly kind: "pull-request" | "thread";
  readonly value: string;
  readonly clipboardTarget: string;
  readonly successTitle: string;
  readonly failureTitle: string;
}

export function resolveThreadReferenceCopyTarget(input: {
  readonly threadId: string;
  readonly linkedPullRequestUrl?: string | null;
  readonly detectedPullRequestUrl?: string | null;
}): ThreadReferenceCopyTarget {
  const pullRequestUrl = input.linkedPullRequestUrl ?? input.detectedPullRequestUrl;
  return pullRequestUrl
    ? {
        kind: "pull-request",
        value: pullRequestUrl,
        clipboardTarget: "pull request link",
        successTitle: "PR link copied",
        failureTitle: "Failed to copy PR link",
      }
    : {
        kind: "thread",
        value: input.threadId,
        clipboardTarget: "thread ID",
        successTitle: "Thread ID copied",
        failureTitle: "Failed to copy thread ID",
      };
}
