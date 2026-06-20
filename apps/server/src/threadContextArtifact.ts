/**
 * Server helper that turns a thread's message history into a persisted
 * attachment artifact.
 *
 * It pairs the pure {@link buildThreadTranscript} serializer with the
 * attachment store: the transcript is written to the attachments directory and
 * returned as a {@link ChatAttachment} so it can ride the normal attachment
 * pipeline (the provider adapters already inline text attachments for every
 * provider).
 *
 * Current consumer: cross-provider thread forking (the source context is
 * replayed into the fork's first message). The same helper is intended to back
 * future features such as referencing one thread from another or exporting a
 * conversation, since it has no fork-specific coupling.
 *
 * @module threadContextArtifact
 */
import {
  type ChatAttachment,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
  PROVIDER_SEND_TURN_MAX_ATTACHMENT_BYTES,
} from "@t3tools/contracts";
import { buildThreadTranscript } from "@t3tools/shared/threadTranscript";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

import { createAttachmentId, resolveAttachmentPath } from "./attachmentStore.ts";

const TRANSCRIPT_MIME_TYPE = "text/markdown";

/**
 * Truncate the transcript so the persisted artifact stays within the attachment
 * size contract. Large transcripts are rare; when they do occur the adapter's
 * own inline-preview truncation keeps the prompt bounded, but the on-disk file
 * must still satisfy {@link PROVIDER_SEND_TURN_MAX_ATTACHMENT_BYTES}.
 */
function clampTranscriptBytes(transcript: string): Uint8Array {
  const bytes = new TextEncoder().encode(transcript);
  if (bytes.byteLength <= PROVIDER_SEND_TURN_MAX_ATTACHMENT_BYTES) {
    return bytes;
  }
  const notice = "\n\n[Transcript truncated to fit the attachment size limit.]\n";
  const noticeBytes = new TextEncoder().encode(notice);
  const head = bytes.subarray(0, PROVIDER_SEND_TURN_MAX_ATTACHMENT_BYTES - noticeBytes.byteLength);
  const combined = new Uint8Array(head.byteLength + noticeBytes.byteLength);
  combined.set(head, 0);
  combined.set(noticeBytes, head.byteLength);
  return combined;
}

export interface CreateThreadContextArtifactInput {
  /** Directory where attachment files are stored. */
  readonly attachmentsDir: string;
  /** Thread the artifact is attached to (namespaces the generated id). */
  readonly threadId: string;
  /** Messages to serialize, in chronological order. */
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  /** Work-log activities (tool calls/results, errors) to interleave. */
  readonly activities?: ReadonlyArray<OrchestrationThreadActivity>;
  /** Latest turn state; a running turn is excluded as in-flight work. */
  readonly latestTurn?: OrchestrationLatestTurn | null;
  /** File name for the artifact (defaults to a generic transcript name). */
  readonly fileName: string;
  /** Title of the source thread, surfaced in the transcript header. */
  readonly sourceTitle?: string;
  /** Intro paragraph rendered under the transcript heading. */
  readonly intro?: string;
  /** File-system service used to persist the artifact. */
  readonly fileSystem: FileSystem.FileSystem;
  /** Path service used to resolve the attachment directory. */
  readonly path: Path.Path;
}

/**
 * Build a transcript artifact for `messages`, persist it under
 * `attachmentsDir`, and return the {@link ChatAttachment} reference. Returns
 * `undefined` when a safe attachment id or path cannot be derived (the caller
 * should proceed without the artifact rather than fail the turn).
 */
export const createThreadContextArtifact = (input: CreateThreadContextArtifactInput) =>
  Effect.gen(function* () {
    const { fileSystem, path } = input;

    const transcript = buildThreadTranscript(
      {
        messages: input.messages,
        ...(input.activities !== undefined ? { activities: input.activities } : {}),
        ...(input.latestTurn !== undefined ? { latestTurn: input.latestTurn } : {}),
      },
      {
        ...(input.sourceTitle !== undefined ? { sourceTitle: input.sourceTitle } : {}),
        ...(input.intro !== undefined ? { intro: input.intro } : {}),
      },
    );
    const bytes = clampTranscriptBytes(transcript);

    const attachmentId = createAttachmentId(input.threadId);
    if (!attachmentId) {
      return undefined;
    }
    const attachment: ChatAttachment = {
      type: "file",
      id: attachmentId,
      name: input.fileName,
      mimeType: TRANSCRIPT_MIME_TYPE,
      sizeBytes: bytes.byteLength,
    };
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return undefined;
    }
    yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true });
    yield* fileSystem.writeFile(attachmentPath, bytes);
    return attachment;
  });
