/**
 * Inline reference to another thread's context: `@thread_ref:<threadId>` for a
 * thread on the same environment, `@thread_ref:<environmentId>/<threadId>` for
 * one that lives on another machine.
 *
 * A user drops the token into a message (via the "Copy thread ref" action) to
 * pull another thread's transcript in as context. Resolution splits by owner:
 *
 * - Same-environment references are resolved by the server, which reads the
 *   thread out of its own read model and writes a transcript artifact
 *   (`createThreadContextArtifact`) — the same primitive that powers
 *   cross-provider forking.
 * - Cross-environment references are resolved by the client, which is the only
 *   party connected to both machines. It fetches the referenced thread from its
 *   owning environment, renders the transcript, and uploads it to the target
 *   environment before the turn starts.
 *
 * Either way the provider is handed a file path, never an inlined transcript.
 *
 * This module is pure and shared so clients and server agree on the exact token
 * format and on which references each side owns.
 *
 * @module threadReference
 */

export const THREAD_REFERENCE_PREFIX = "@thread_ref:";

/**
 * Header the referenced thread's transcript opens with, so the agent knows the
 * Markdown it is about to read is background rather than instructions. Shared
 * because either side may render the transcript: the server for a
 * same-environment reference, the client for a cross-environment one.
 */
export const THREAD_REFERENCE_INTRO =
  "The user referenced another thread. The Markdown below is that thread's transcript — " +
  "treat it as background context for the request that follows.";

/**
 * A parsed token. `environmentId` is absent for the legacy unqualified form,
 * which always means "the environment this message is sent to".
 */
export interface ThreadReference {
  readonly environmentId?: string;
  readonly threadId: string;
}

// Thread and environment ids are UUIDs today, but slug-style ids are allowed
// too; keep the accepted charset permissive and let the resolver reject unknown
// ids. The leading `@` matches the composer's other mention tokens.
const THREAD_REFERENCE_PATTERN =
  /@thread_ref:([A-Za-z0-9][A-Za-z0-9_-]*)(?:\/([A-Za-z0-9][A-Za-z0-9_-]*))?/g;

/**
 * Render the inline token for a thread. Always pass the owning environment:
 * copy happens before the paste target is known, so an unqualified token only
 * resolves by luck once more than one machine is connected.
 */
export function formatThreadReference(reference: ThreadReference): string {
  return reference.environmentId === undefined
    ? `${THREAD_REFERENCE_PREFIX}${reference.threadId}`
    : `${THREAD_REFERENCE_PREFIX}${reference.environmentId}/${reference.threadId}`;
}

/** Stable identity for de-duplication; unqualified and qualified forms of the
    same thread on the same machine collapse once `environmentId` is known. */
export function threadReferenceKey(reference: ThreadReference): string {
  return `${reference.environmentId ?? ""}/${reference.threadId}`;
}

/**
 * Extract references from message text, in first-seen order and de-duplicated.
 * Returns an empty array when there are no references.
 */
export function parseThreadReferences(text: string): ReadonlyArray<ThreadReference> {
  const references: ThreadReference[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(THREAD_REFERENCE_PATTERN)) {
    const first = match[1];
    if (first === undefined) {
      continue;
    }
    const second = match[2];
    const reference: ThreadReference =
      second === undefined ? { threadId: first } : { environmentId: first, threadId: second };
    const key = threadReferenceKey(reference);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push(reference);
  }
  return references;
}

/**
 * Split parsed references by who can resolve them, from the point of view of
 * the environment the message is being sent to. Unqualified references and
 * references naming that environment are `local`; everything else is `foreign`
 * and needs a client-supplied transcript.
 *
 * Both sides call this so they agree on the split: the client resolves exactly
 * the references the server will expect to be handed.
 */
export function partitionThreadReferences(
  references: ReadonlyArray<ThreadReference>,
  targetEnvironmentId: string,
): {
  readonly local: ReadonlyArray<ThreadReference>;
  readonly foreign: ReadonlyArray<Required<ThreadReference>>;
} {
  const local: ThreadReference[] = [];
  const foreign: Required<ThreadReference>[] = [];
  for (const reference of references) {
    if (reference.environmentId === undefined || reference.environmentId === targetEnvironmentId) {
      local.push({ threadId: reference.threadId });
      continue;
    }
    foreign.push({ environmentId: reference.environmentId, threadId: reference.threadId });
  }
  return { local, foreign };
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
