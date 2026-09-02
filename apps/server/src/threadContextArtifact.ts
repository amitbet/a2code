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
  type ChatFileAttachment,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { buildThreadTranscript } from "@t3tools/shared/threadTranscript";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

import {
  attachmentFileExtension,
  createAttachmentId,
  resolveAttachmentPath,
} from "./attachmentStore.ts";

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

  // The id carries the file extension so resolveAttachmentPathById can find the
  // transcript again; non-image extensions are not probed by fallback.
  const attachmentId = createAttachmentId(input.threadId, attachmentFileExtension(input.fileName));
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
    // The transcript is a generic file attachment; only the path layout needs
    // the discriminator, so it stays off ThreadContextArtifact itself.
    attachment: { ...artifact, type: "file" },
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

/**
 * Locate a transcript that was persisted elsewhere — a client-uploaded
 * cross-environment thread reference — and describe it the same way
 * {@link createThreadContextArtifact} describes one it just wrote, so both
 * kinds of reference reach the provider through one code path.
 *
 * Returns `undefined` when the file is missing: the upload expired, the id was
 * never claimed, or it does not belong to this environment's attachment store.
 */
export const resolveThreadContextArtifact = Effect.fn("resolveThreadContextArtifact")(
  function* (input: {
    readonly attachmentsDir: string;
    readonly attachment: ChatFileAttachment;
    readonly fileSystem: FileSystem.FileSystem;
  }) {
    const absolutePath = resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment: input.attachment,
    });
    if (!absolutePath) {
      return undefined;
    }
    const info = yield* input.fileSystem
      .stat(absolutePath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (info === undefined || info.type !== "File") {
      return undefined;
    }
    return {
      id: input.attachment.id,
      name: input.attachment.name,
      mimeType: input.attachment.mimeType,
      // Trust the file over the claim: the transcript the provider reads is the
      // one on disk.
      sizeBytes: Number(info.size),
      absolutePath,
    } satisfies ThreadContextArtifact;
  },
);
