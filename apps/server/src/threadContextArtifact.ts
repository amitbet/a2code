/**
 * Server helper that turns a thread's message history into a persisted
 * attachment artifact.
 *
 * It pairs the pure {@link buildThreadTranscript} serializer with the
 * attachment store: the transcript is written to the attachments directory and
 * returned with its absolute path so the provider can be told to read it on
 * demand. Generated context deliberately does not ride the normal attachment
 * pipeline: inlining a large preview makes agents likely to ignore the complete
 * file and wastes context-window space.
 *
 * Consumers include cross-provider thread forking and references from one
 * thread to another. The helper has no fork-specific coupling and can also back
 * exports or other context handoffs.
 *
 * @module threadContextArtifact
 */
import {
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { buildThreadTranscript } from "@t3tools/shared/threadTranscript";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

import { createAttachmentId, resolveAttachmentPath } from "./attachmentStore.ts";

const TRANSCRIPT_MIME_TYPE = "text/markdown";

export interface ThreadContextArtifact {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly absolutePath: string;
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
 * `attachmentsDir`, and return its path metadata. Unlike user attachments,
 * context artifacts are not constrained by the provider attachment-size
 * contract because only their path is sent to the provider. Returns `undefined`
 * when a safe artifact id or path cannot be derived (the caller should proceed
 * without the artifact rather than fail the turn).
 */
export const createThreadContextArtifact = Effect.fn("createThreadContextArtifact")(function* (
  input: CreateThreadContextArtifactInput,
) {
  const { fileSystem, path } = input;
  const attachmentDetailsById = new Map<string, { absolutePath: string }>();
  for (const message of input.messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachmentDetailsById.has(attachment.id)) {
        continue;
      }
      const absolutePath = resolveAttachmentPath({
        attachmentsDir: input.attachmentsDir,
        attachment,
      });
      if (absolutePath) {
        attachmentDetailsById.set(attachment.id, { absolutePath });
      }
    }
  }

  const transcript = buildThreadTranscript(
    {
      messages: input.messages,
      ...(input.activities !== undefined ? { activities: input.activities } : {}),
      ...(input.latestTurn !== undefined ? { latestTurn: input.latestTurn } : {}),
    },
    {
      ...(input.sourceTitle !== undefined ? { sourceTitle: input.sourceTitle } : {}),
      ...(input.intro !== undefined ? { intro: input.intro } : {}),
      ...(attachmentDetailsById.size > 0 ? { attachmentDetailsById } : {}),
      maxToolResultChars: Number.MAX_SAFE_INTEGER,
    },
  );
  const bytes = new TextEncoder().encode(transcript);

  const attachmentId = createAttachmentId(input.threadId);
  if (!attachmentId) {
    return undefined;
  }
  const artifact = {
    id: attachmentId,
    name: input.fileName,
    mimeType: TRANSCRIPT_MIME_TYPE,
    sizeBytes: bytes.byteLength,
  };
  const attachmentPath = resolveAttachmentPath({
    attachmentsDir: input.attachmentsDir,
    attachment: artifact,
  });
  if (!attachmentPath) {
    return undefined;
  }
  yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true });
  yield* fileSystem.writeFile(attachmentPath, bytes);
  return {
    ...artifact,
    absolutePath: attachmentPath,
  } satisfies ThreadContextArtifact;
});
