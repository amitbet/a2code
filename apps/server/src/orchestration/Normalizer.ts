import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  type ChatAttachment,
  type ClientOrchestrationCommand,
  type IsoDateTime,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  PROVIDER_SEND_TURN_MAX_ATTACHMENT_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";

import {
  attachmentFileExtension,
  createAttachmentId,
  planAttachmentClaim,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPath,
} from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { inferImageExtension, parseBase64DataUrl } from "../imageMime.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

export const canonicalizeClientCommandTimestamps = (
  command: ClientOrchestrationCommand,
  receivedAt: IsoDateTime,
): ClientOrchestrationCommand => {
  const canonicalCommand =
    "createdAt" in command
      ? {
          ...command,
          createdAt: receivedAt,
        }
      : command;

  if (canonicalCommand.type !== "thread.turn.start" || !canonicalCommand.bootstrap?.createThread) {
    return canonicalCommand;
  }

  return {
    ...canonicalCommand,
    bootstrap: {
      ...canonicalCommand.bootstrap,
      createThread: {
        ...canonicalCommand.bootstrap.createThread,
        createdAt: receivedAt,
      },
    },
  };
};

const removeClaimedAttachmentPaths = Effect.fn("Normalizer.removeClaimedAttachmentPaths")(
  function* (attachmentPaths: ReadonlyArray<string>) {
    if (attachmentPaths.length === 0) {
      return;
    }
    const fileSystem = yield* FileSystem.FileSystem;
    yield* Effect.forEach(
      attachmentPaths,
      (attachmentPath) =>
        fileSystem.remove(attachmentPath, { force: true }).pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("Failed to remove an unclaimed attachment copy.", {
              attachmentPath,
              cause,
            }),
          ),
          Effect.orElseSucceed(() => undefined),
        ),
      { concurrency: 1 },
    );
  },
);

export const normalizeDispatchCommand = (command: ClientOrchestrationCommand) =>
  Effect.gen(function* () {
    const receivedAt = DateTime.formatIso(yield* DateTime.now);
    const canonicalCommand = canonicalizeClientCommandTimestamps(command, receivedAt);
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const workspacePaths = yield* WorkspacePaths.WorkspacePaths;

    const normalizeProjectWorkspaceRoot = (workspaceRoot: string) =>
      workspacePaths.normalizeWorkspaceRoot(workspaceRoot).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: cause.message,
            }),
        ),
      );

    const normalizeProjectWorkspaceRootForCreate = (
      workspaceRoot: string,
      createIfMissing: boolean | undefined,
    ) =>
      workspacePaths
        .normalizeWorkspaceRoot(workspaceRoot, {
          createIfMissing: createIfMissing === true,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationDispatchCommandError({
                message: cause.message,
              }),
          ),
        );

    if (canonicalCommand.type === "project.create") {
      return {
        ...canonicalCommand,
        workspaceRoot: yield* normalizeProjectWorkspaceRootForCreate(
          canonicalCommand.workspaceRoot,
          canonicalCommand.createWorkspaceRootIfMissing,
        ),
        createWorkspaceRootIfMissing: canonicalCommand.createWorkspaceRootIfMissing === true,
      } satisfies OrchestrationCommand;
    }

    if (
      canonicalCommand.type === "project.meta.update" &&
      canonicalCommand.workspaceRoot !== undefined
    ) {
      return {
        ...canonicalCommand,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(canonicalCommand.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (
      canonicalCommand.type !== "thread.turn.start" &&
      canonicalCommand.type !== "thread.prompt.queue"
    ) {
      return canonicalCommand as OrchestrationCommand;
    }

    const claimedAttachmentPaths: string[] = [];

    /**
     * Move an already-uploaded attachment from the pending namespace into this
     * thread's, validating that the bytes exist and match what the client
     * claimed. Shared by user attachments and cross-environment thread
     * reference transcripts: both arrive through the upload channel, so both
     * have to be claimed the same way or a reference could point at a pending
     * file that the sweeper is free to delete.
     */
    const claimUploadedAttachment = Effect.fnUntraced(function* <A extends ChatAttachment>(
      attachment: A,
    ) {
      const claim = planAttachmentClaim({
        attachmentsDir: serverConfig.attachmentsDir,
        threadId: canonicalCommand.threadId,
        attachmentId: attachment.id,
      });
      if (!claim.ok) {
        return yield* new OrchestrationDispatchCommandError({
          message: `Attachment '${attachment.name}' cannot be sent: ${claim.reason}.`,
        });
      }

      const info = yield* fileSystem.stat(claim.currentPath).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: `Attachment '${attachment.name}' cannot be sent: attachment not found.`,
              cause,
            }),
        ),
      );
      if (Number(info.size) !== attachment.sizeBytes) {
        return yield* new OrchestrationDispatchCommandError({
          message: `Attachment '${attachment.name}' cannot be sent: stored size does not match.`,
        });
      }

      const normalizedAttachment = {
        ...attachment,
        id: claim.finalId,
        mimeType: attachment.mimeType.toLowerCase(),
      };
      const expectedPath = resolveAttachmentPath({
        attachmentsDir: serverConfig.attachmentsDir,
        attachment: normalizedAttachment,
      });
      if (expectedPath !== claim.finalPath) {
        return yield* new OrchestrationDispatchCommandError({
          message: `Attachment '${attachment.name}' cannot be sent: attachment type does not match the upload.`,
        });
      }

      // Keep the pending copy until the turn succeeds. A failed thread
      // bootstrap can then retry with a fresh thread id. A copy, not a
      // hard link: an agent editing the delivered file in place must not
      // mutate the retry source.
      yield* fileSystem.copyFile(claim.currentPath, claim.finalPath).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: `Failed to claim attachment '${attachment.name}' for this thread.`,
              cause,
            }),
        ),
      );
      claimedAttachmentPaths.push(claim.finalPath);

      return normalizedAttachment;
    });

    const normalizedAttachments = yield* Effect.forEach(
      canonicalCommand.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          if (!("dataUrl" in attachment)) {
            return yield* claimUploadedAttachment(attachment);
          }

          const parsed = parseBase64DataUrl(attachment.dataUrl);
          if (!parsed) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Invalid attachment payload for '${attachment.name}'.`,
            });
          }

          const bytes = Buffer.from(parsed.base64, "base64");
          const maxBytes = parsed.mimeType.startsWith("image/")
            ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
            : PROVIDER_SEND_TURN_MAX_ATTACHMENT_BYTES;
          if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Attachment '${attachment.name}' is empty or too large.`,
            });
          }

          // Mint the id with the stored file's extension: resolveAttachmentPathById
          // reads it back off the id and only probes image extensions otherwise.
          const attachmentId = createAttachmentId(
            canonicalCommand.threadId,
            parsed.mimeType.startsWith("image/")
              ? inferImageExtension({ mimeType: parsed.mimeType, fileName: attachment.name })
              : attachmentFileExtension(attachment.name),
          );
          if (!attachmentId) {
            return yield* new OrchestrationDispatchCommandError({
              message: "Failed to create a safe attachment id.",
            });
          }

          const persistedAttachment = {
            type: parsed.mimeType.startsWith("image/") ? ("image" as const) : ("file" as const),
            id: attachmentId,
            name: attachment.name,
            mimeType: parsed.mimeType.toLowerCase(),
            sizeBytes: bytes.byteLength,
          };

          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment: persistedAttachment,
          });
          if (!attachmentPath) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Failed to resolve persisted path for '${attachment.name}'.`,
            });
          }

          yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
            Effect.mapError(
              () =>
                new OrchestrationDispatchCommandError({
                  message: `Failed to create attachment directory for '${attachment.name}'.`,
                }),
            ),
          );
          yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
            Effect.mapError(
              () =>
                new OrchestrationDispatchCommandError({
                  message: `Failed to persist attachment '${attachment.name}'.`,
                }),
            ),
          );

          return persistedAttachment;
        }),
      { concurrency: 1 },
    ).pipe(Effect.tapError(() => removeClaimedAttachmentPaths(claimedAttachmentPaths)));

    const normalizedThreadReferences =
      canonicalCommand.threadReferences === undefined
        ? undefined
        : yield* Effect.forEach(
            canonicalCommand.threadReferences,
            (reference) =>
              claimUploadedAttachment(reference.attachment).pipe(
                Effect.map((attachment) => ({ ...reference, attachment })),
              ),
            { concurrency: 1 },
          ).pipe(Effect.tapError(() => removeClaimedAttachmentPaths(claimedAttachmentPaths)));

    return {
      ...canonicalCommand,
      message: {
        ...canonicalCommand.message,
        attachments: normalizedAttachments,
      },
      ...(normalizedThreadReferences === undefined
        ? {}
        : { threadReferences: normalizedThreadReferences }),
    } satisfies OrchestrationCommand;
  });

export const cleanupFailedUploadedAttachments = Effect.fn(
  "Normalizer.cleanupFailedUploadedAttachments",
)(function* (command: ClientOrchestrationCommand, normalizedCommand: OrchestrationCommand) {
  if (command.type !== "thread.turn.start" || normalizedCommand.type !== "thread.turn.start") {
    return;
  }

  const serverConfig = yield* ServerConfig;
  const claimedPaths: string[] = [];
  const collectClaimedPath = (
    original: { readonly id: string } | undefined,
    attachment: Parameters<typeof resolveAttachmentPath>[0]["attachment"],
  ) => {
    if (
      !original ||
      parseThreadSegmentFromAttachmentId(original.id) !== PENDING_ATTACHMENT_THREAD_SEGMENT
    ) {
      return;
    }
    const claimedPath = resolveAttachmentPath({
      attachmentsDir: serverConfig.attachmentsDir,
      attachment,
    });
    if (claimedPath) {
      claimedPaths.push(claimedPath);
    }
  };
  for (const [index, attachment] of normalizedCommand.message.attachments.entries()) {
    const original = command.message.attachments[index];
    if (original && "dataUrl" in original) {
      continue;
    }
    collectClaimedPath(original, attachment);
  }
  // Reference transcripts are claimed the same way, so a failed turn has to
  // release their copies too or every retry leaks one.
  for (const [index, reference] of (normalizedCommand.threadReferences ?? []).entries()) {
    collectClaimedPath(command.threadReferences?.[index]?.attachment, reference.attachment);
  }
  yield* removeClaimedAttachmentPaths(claimedPaths);
});
