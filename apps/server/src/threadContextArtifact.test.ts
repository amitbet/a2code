import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { MessageId, PROVIDER_SEND_TURN_MAX_ATTACHMENT_BYTES } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { createThreadContextArtifact } from "./threadContextArtifact.ts";

it.layer(NodeServices.layer)("createThreadContextArtifact", (it) => {
  it.effect("persists complete transcripts beyond the provider attachment size limit", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const attachmentsDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-thread-context-artifact-",
      });
      const messageText = "x".repeat(PROVIDER_SEND_TURN_MAX_ATTACHMENT_BYTES + 1024);

      const artifact = yield* createThreadContextArtifact({
        attachmentsDir,
        threadId: "thread-large-context",
        messages: [
          {
            id: MessageId.make("message-large-context"),
            role: "user",
            text: messageText,
            turnId: null,
            streaming: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        fileName: "large-context.md",
        fileSystem,
        path,
      });

      expect(artifact).toBeDefined();
      expect(artifact!.sizeBytes).toBeGreaterThan(PROVIDER_SEND_TURN_MAX_ATTACHMENT_BYTES);
      const transcript = yield* fileSystem.readFileString(artifact!.absolutePath);
      expect(transcript).toContain(messageText);
      expect(transcript).not.toContain("Transcript truncated to fit the attachment size limit");
    }),
  );
});
