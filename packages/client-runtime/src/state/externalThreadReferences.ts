/**
 * Client half of `@thread_ref:` resolution: turning a reference to a thread on
 * another machine into a transcript the target environment can read.
 *
 * A T3 server only knows its own threads, and known environments are
 * client-local — no server holds another environment's endpoint or credential.
 * The client is the only party connected to both, so it resolves the reference
 * before the turn starts: read the thread from its owning environment, render
 * the transcript with the same serializer the server uses, upload it to the
 * target environment through the ordinary pending-attachment channel, and hand
 * the turn the resulting attachment. Same-machine references are left alone;
 * the server reads those out of its own read model.
 *
 * This runs inside the thread commands (see `threadCommands.ts`), so every
 * client and every send path gets it without repeating the plumbing.
 *
 * @module externalThreadReferences
 */
import {
  type AttachmentCreateUploadUrlResult,
  type EnvironmentId,
  type ExternalThreadReference,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
  ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import {
  formatThreadReference,
  parseThreadReferences,
  partitionThreadReferences,
  THREAD_REFERENCE_INTRO,
} from "@t3tools/shared/threadReference";
import { buildThreadTranscript } from "@t3tools/shared/threadTranscript";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/unstable/http";

import type { PreparedConnection } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { request } from "../rpc/client.ts";
import { resolveAssetUrl } from "./assets.ts";
import { buildEnvironmentAuthHeaders, withEnvironmentCredentials } from "./environmentHttpAuth.ts";
import { ThreadSnapshotLoader } from "./threadSnapshotHttp.ts";

const TRANSCRIPT_MIME_TYPE = "text/markdown";
// A transcript is small next to a user's file attachments and nobody is
// watching a progress bar for it, so one bounded request is enough.
const TRANSCRIPT_UPLOAD_TIMEOUT_MS = 30_000;

const ThreadReferenceFailure = Schema.Struct({
  /** The token as written, so the message names what the user typed. */
  token: Schema.String,
  environmentId: Schema.String,
  threadId: Schema.String,
  reason: Schema.String,
});
export type ThreadReferenceFailure = typeof ThreadReferenceFailure.Type;

/**
 * At least one `@thread_ref:` pointing at another machine could not be
 * resolved, so the turn was never dispatched. Blocking beats sending: the user
 * attached that history on purpose, and an agent that never sees it answers
 * confidently from a hole.
 */
export class ThreadReferencesUnresolvedError extends Schema.TaggedErrorClass<ThreadReferencesUnresolvedError>()(
  "ThreadReferencesUnresolvedError",
  { failures: Schema.Array(ThreadReferenceFailure) },
) {
  override get message(): string {
    return describeThreadReferenceFailures(this.failures);
  }
}

/** One-line, user-facing summary of why a send was blocked. */
export function describeThreadReferenceFailures(
  failures: ReadonlyArray<ThreadReferenceFailure>,
): string {
  return failures
    .map((failure) => `${failure.token} could not be read: ${failure.reason}.`)
    .join(" ");
}

/**
 * File name for a reference transcript. Matches the name the server gives a
 * same-environment transcript, so the prompt reads the same either way.
 */
export function referenceTranscriptFileName(threadId: string): string {
  return `referenced-thread-${threadId}.md`;
}

/** The prepared connection for an environment, if it is connected right now. */
const preparedConnectionFor = (
  registry: EnvironmentRegistry["Service"],
  environmentId: EnvironmentId,
) =>
  registry
    .run(
      environmentId,
      Effect.flatMap(EnvironmentSupervisor, (supervisor) =>
        SubscriptionRef.get(supervisor.prepared),
      ),
    )
    .pipe(Effect.orElseSucceed(() => Option.none<PreparedConnection>()));

class TranscriptUploadError extends Schema.TaggedErrorClass<TranscriptUploadError>()(
  "TranscriptUploadError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.detail;
  }
}

/** Mint a pending upload on the target environment and push the bytes to it. */
const uploadTranscript = Effect.fnUntraced(function* (input: {
  readonly registry: EnvironmentRegistry["Service"];
  readonly httpClient: HttpClient.HttpClient;
  readonly signer: Option.Option<ManagedRelayDpopSigner["Service"]>;
  readonly targetEnvironmentId: EnvironmentId;
  readonly prepared: PreparedConnection;
  readonly name: string;
  readonly bytes: Uint8Array;
}) {
  const minted: AttachmentCreateUploadUrlResult = yield* input.registry.run(
    input.targetEnvironmentId,
    request(WS_METHODS.attachmentsCreateUploadUrl, {
      type: "file",
      name: input.name,
      mimeType: TRANSCRIPT_MIME_TYPE,
      sizeBytes: input.bytes.byteLength,
    }),
  );

  const requestUrl = resolveAssetUrl(input.prepared.httpBaseUrl, minted.relativeUrl);
  if (!requestUrl) {
    return yield* new TranscriptUploadError({
      detail: "Could not resolve the attachment upload URL.",
    });
  }
  const headers = yield* buildEnvironmentAuthHeaders(
    input.prepared.httpAuthorization,
    "POST",
    requestUrl,
    input.signer,
  );
  yield* withEnvironmentCredentials(
    input.prepared.httpAuthorization,
    input.httpClient
      .post(requestUrl, {
        headers: { ...headers, "content-type": TRANSCRIPT_MIME_TYPE },
        body: HttpBody.uint8Array(input.bytes, TRANSCRIPT_MIME_TYPE),
      })
      .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk)),
  ).pipe(
    Effect.timeoutOrElse({
      duration: `${TRANSCRIPT_UPLOAD_TIMEOUT_MS} millis`,
      orElse: () => new TranscriptUploadError({ detail: "The transcript upload timed out." }),
    }),
  );

  return {
    type: "file" as const,
    id: minted.attachmentId,
    name: input.name,
    mimeType: TRANSCRIPT_MIME_TYPE,
    sizeBytes: input.bytes.byteLength,
  } satisfies ExternalThreadReference["attachment"];
});

/** The referenced thread, as read from the environment that owns it. */
export interface ReferencedThreadSnapshot {
  readonly title?: string;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities?: ReadonlyArray<OrchestrationThreadActivity>;
  readonly latestTurn?: OrchestrationLatestTurn | null;
}

/**
 * Reference resolution with reading and uploading injected. The capabilities
 * report "could not" rather than failing so that one unreachable machine turns
 * into a named failure instead of aborting the whole pass; the real ones are
 * wired in {@link resolveExternalThreadReferences}.
 */
export const resolveExternalThreadReferencesWith = Effect.fnUntraced(function* (input: {
  readonly text: string;
  readonly targetEnvironmentId: EnvironmentId;
  readonly loadThread: (reference: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  }) => Effect.Effect<Option.Option<ReferencedThreadSnapshot>>;
  readonly uploadTranscript: (upload: {
    readonly name: string;
    readonly bytes: Uint8Array;
  }) => Effect.Effect<Option.Option<ExternalThreadReference["attachment"]>>;
}) {
  const { foreign } = partitionThreadReferences(
    parseThreadReferences(input.text),
    input.targetEnvironmentId,
  );
  if (foreign.length === 0) {
    return [] as ReadonlyArray<ExternalThreadReference>;
  }

  const references: ExternalThreadReference[] = [];
  const failures: ThreadReferenceFailure[] = [];
  const fail = (
    reference: { readonly environmentId: string; readonly threadId: string },
    reason: string,
  ) => {
    failures.push({
      token: formatThreadReference(reference),
      environmentId: reference.environmentId,
      threadId: reference.threadId,
      reason,
    });
  };

  // Serial: each reference pulls a whole transcript across the network, and the
  // machines involved are usually the same one or two.
  for (const reference of foreign) {
    const environmentId = reference.environmentId as EnvironmentId;
    const threadId = ThreadId.make(reference.threadId);
    const snapshot = yield* input.loadThread({ environmentId, threadId });
    if (Option.isNone(snapshot)) {
      fail(reference, "that machine is not reachable from this client, or the thread is gone");
      continue;
    }

    const thread = snapshot.value;
    const transcript = buildThreadTranscript(
      {
        messages: thread.messages,
        ...(thread.activities !== undefined ? { activities: thread.activities } : {}),
        ...(thread.latestTurn !== undefined ? { latestTurn: thread.latestTurn } : {}),
      },
      {
        ...(thread.title !== undefined ? { sourceTitle: thread.title } : {}),
        intro: THREAD_REFERENCE_INTRO,
        // Tool results keep the serializer's default cap rather than the
        // server's unbounded one: these bytes cross the network twice, and the
        // other machine's attachment paths would not resolve here anyway.
      },
    );

    const attachment = yield* input.uploadTranscript({
      name: referenceTranscriptFileName(threadId),
      bytes: new TextEncoder().encode(transcript),
    });
    if (Option.isNone(attachment)) {
      fail(reference, "its transcript could not be uploaded to this machine");
      continue;
    }

    references.push({
      environmentId,
      threadId,
      ...(thread.title !== undefined ? { sourceTitle: thread.title } : {}),
      attachment: attachment.value,
    });
  }

  if (failures.length > 0) {
    return yield* new ThreadReferencesUnresolvedError({ failures });
  }
  return references as ReadonlyArray<ExternalThreadReference>;
});

/**
 * Resolve every cross-environment reference in `text` against the connected
 * environments. Fails with {@link ThreadReferencesUnresolvedError} listing each
 * reference that could not be resolved; succeeds with an empty array when the
 * message only references threads on the target environment.
 */
export const resolveExternalThreadReferences = Effect.fnUntraced(function* (input: {
  readonly text: string;
  readonly targetEnvironmentId: EnvironmentId;
}) {
  const snapshotLoader = yield* ThreadSnapshotLoader;
  const registry = yield* EnvironmentRegistry;
  const httpClient = yield* HttpClient.HttpClient;
  // Resolved here rather than inside the upload: stripping the context to run
  // the injected capability would hide the signer, and relay connections
  // cannot authorize a request without it.
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const targetPrepared = yield* preparedConnectionFor(registry, input.targetEnvironmentId);

  return yield* resolveExternalThreadReferencesWith({
    text: input.text,
    targetEnvironmentId: input.targetEnvironmentId,
    loadThread: (reference) =>
      preparedConnectionFor(registry, reference.environmentId).pipe(
        Effect.flatMap((prepared) =>
          Option.isNone(prepared)
            ? Effect.succeed(Option.none<ReferencedThreadSnapshot>())
            : snapshotLoader.load(prepared.value, reference.threadId).pipe(
                Effect.map(
                  Option.map((snapshot): ReferencedThreadSnapshot => ({
                    title: snapshot.thread.title,
                    messages: snapshot.thread.messages,
                    activities: snapshot.thread.activities,
                    latestTurn: snapshot.thread.latestTurn,
                  })),
                ),
              ),
        ),
      ),
    uploadTranscript: (upload) =>
      Option.isNone(targetPrepared)
        ? Effect.succeed(Option.none())
        : uploadTranscript({
            registry,
            httpClient,
            signer,
            targetEnvironmentId: input.targetEnvironmentId,
            prepared: targetPrepared.value,
            name: upload.name,
            bytes: upload.bytes,
          }).pipe(
            Effect.map(Option.some),
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not upload a referenced thread transcript.", {
                targetEnvironmentId: input.targetEnvironmentId,
                name: upload.name,
                cause,
              }).pipe(Effect.as(Option.none())),
            ),
          ),
  });
});
