import { describe, expect, it } from "@effect/vitest";
import type {
  EnvironmentId,
  ExternalThreadReference,
  OrchestrationMessage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  describeThreadReferenceFailures,
  referenceTranscriptFileName,
  resolveExternalThreadReferencesWith,
  ThreadReferencesUnresolvedError,
  type ReferencedThreadSnapshot,
} from "./externalThreadReferences.ts";

const TARGET = "env-local" as EnvironmentId;

function message(text: string): OrchestrationMessage {
  return {
    id: `message-${text.length}` as OrchestrationMessage["id"],
    role: "user",
    text,
    turnId: null,
    streaming: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const remoteThread: ReferencedThreadSnapshot = {
  title: "Staging rollout",
  messages: [message("The staging cluster is us-east-2.")],
};

/** Records what would have been uploaded and hands back a pending attachment. */
function recordingUploader(uploads: Array<{ name: string; text: string }>) {
  return (upload: { readonly name: string; readonly bytes: Uint8Array }) => {
    uploads.push({ name: upload.name, text: new TextDecoder().decode(upload.bytes) });
    return Effect.succeed(
      Option.some<ExternalThreadReference["attachment"]>({
        type: "file",
        id: `pending_${upload.name}`,
        name: upload.name,
        mimeType: "text/markdown",
        sizeBytes: upload.bytes.byteLength,
      }),
    );
  };
}

const neverReads = () =>
  Effect.die(new Error("should not read another machine for a same-machine reference"));

describe("resolveExternalThreadReferencesWith", () => {
  it.effect("leaves a message with no cross-environment references alone", () =>
    Effect.gen(function* () {
      const uploads: Array<{ name: string; text: string }> = [];
      const references = yield* resolveExternalThreadReferencesWith({
        // Unqualified, and qualified with the target itself: both are the
        // server's to resolve out of its own read model.
        text: "See @thread_ref:thread-local and @thread_ref:env-local/thread-other.",
        targetEnvironmentId: TARGET,
        loadThread: neverReads,
        uploadTranscript: recordingUploader(uploads),
      });

      expect(references).toEqual([]);
      expect(uploads).toEqual([]);
    }),
  );

  it.effect("uploads a transcript for a thread on another machine", () =>
    Effect.gen(function* () {
      const uploads: Array<{ name: string; text: string }> = [];
      const references = yield* resolveExternalThreadReferencesWith({
        text: "See @thread_ref:env-remote/thread-remote for context.",
        targetEnvironmentId: TARGET,
        loadThread: () => Effect.succeed(Option.some(remoteThread)),
        uploadTranscript: recordingUploader(uploads),
      });

      expect(references).toEqual([
        {
          environmentId: "env-remote",
          threadId: "thread-remote",
          sourceTitle: "Staging rollout",
          attachment: {
            type: "file",
            id: "pending_referenced-thread-thread-remote.md",
            name: referenceTranscriptFileName("thread-remote"),
            mimeType: "text/markdown",
            sizeBytes: new TextEncoder().encode(uploads[0]?.text ?? "").byteLength,
          },
        },
      ]);
      // The uploaded bytes are the transcript, headed so the agent reads it as
      // background rather than instructions.
      expect(uploads[0]?.text).toContain("The staging cluster is us-east-2.");
      expect(uploads[0]?.text).toContain("treat it as background context");
      expect(uploads[0]?.text).toContain("Staging rollout");
    }),
  );

  it.effect("reads each referenced thread from the machine that owns it", () =>
    Effect.gen(function* () {
      const read: Array<{ environmentId: string; threadId: string }> = [];
      yield* resolveExternalThreadReferencesWith({
        text: "@thread_ref:env-a/thread-1 and @thread_ref:env-b/thread-2",
        targetEnvironmentId: TARGET,
        loadThread: (reference) => {
          read.push({ environmentId: reference.environmentId, threadId: reference.threadId });
          return Effect.succeed(Option.some(remoteThread));
        },
        uploadTranscript: recordingUploader([]),
      });

      expect(read).toEqual([
        { environmentId: "env-a", threadId: "thread-1" },
        { environmentId: "env-b", threadId: "thread-2" },
      ]);
    }),
  );

  it.effect("fails, naming the reference, when the owning machine cannot be read", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveExternalThreadReferencesWith({
          text: "@thread_ref:env-offline/thread-remote",
          targetEnvironmentId: TARGET,
          loadThread: () => Effect.succeed(Option.none()),
          uploadTranscript: recordingUploader([]),
        }),
      );

      expect(error).toBeInstanceOf(ThreadReferencesUnresolvedError);
      expect(error.failures).toHaveLength(1);
      expect(error.failures[0]).toMatchObject({
        token: "@thread_ref:env-offline/thread-remote",
        environmentId: "env-offline",
        threadId: "thread-remote",
      });
      // The message is what the client surfaces, so it has to name the token.
      expect(error.message).toContain("@thread_ref:env-offline/thread-remote could not be read");
    }),
  );

  it.effect("fails when the transcript cannot be uploaded", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveExternalThreadReferencesWith({
          text: "@thread_ref:env-remote/thread-remote",
          targetEnvironmentId: TARGET,
          loadThread: () => Effect.succeed(Option.some(remoteThread)),
          uploadTranscript: () => Effect.succeed(Option.none()),
        }),
      );

      expect(error.failures[0]?.reason).toContain("could not be uploaded");
    }),
  );

  it.effect("reports every unreadable reference, not just the first", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveExternalThreadReferencesWith({
          text: "@thread_ref:env-a/thread-1 and @thread_ref:env-b/thread-2",
          targetEnvironmentId: TARGET,
          loadThread: () => Effect.succeed(Option.none()),
          uploadTranscript: recordingUploader([]),
        }),
      );

      expect(error.failures.map((failure) => failure.environmentId)).toEqual(["env-a", "env-b"]);
      expect(describeThreadReferenceFailures(error.failures)).toContain("env-b/thread-2");
    }),
  );

  it.effect("sends no partial context when one of several references fails", () =>
    Effect.gen(function* () {
      const uploads: Array<{ name: string; text: string }> = [];
      const error = yield* Effect.flip(
        resolveExternalThreadReferencesWith({
          text: "@thread_ref:env-remote/thread-ok and @thread_ref:env-remote/thread-gone",
          targetEnvironmentId: TARGET,
          loadThread: (reference) =>
            Effect.succeed(
              reference.threadId === "thread-ok" ? Option.some(remoteThread) : Option.none(),
            ),
          uploadTranscript: recordingUploader(uploads),
        }),
      );

      // The readable one was still uploaded, but the turn is blocked, so the
      // agent never sees half the context the user attached.
      expect(uploads).toHaveLength(1);
      expect(error.failures.map((failure) => failure.threadId)).toEqual(["thread-gone"]);
    }),
  );
});
