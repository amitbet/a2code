import { assert, it } from "@effect/vitest";
import {
  MessageId,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodePath from "node:path";

import * as ServerConfig from "../config.ts";
import * as ContextHandoffService from "./ContextHandoffService.ts";
import * as IdAllocator from "./IdAllocator.ts";

const TestLayer = ContextHandoffService.layer.pipe(
  Layer.provide(IdAllocator.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-context-handoff-" })),
  Layer.provide(NodeServices.layer),
);

function importedItem(
  input:
    | {
        readonly role: "user";
        readonly id: string;
        readonly text: string;
        readonly ordinal: number;
      }
    | {
        readonly role: "assistant";
        readonly id: string;
        readonly text: string;
        readonly ordinal: number;
      },
): OrchestrationV2TurnItem {
  const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
  const base = {
    id: TurnItemId.make(`turn-item:${input.id}`),
    threadId: ThreadId.make("thread:legacy-context"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: input.ordinal,
    status: "completed" as const,
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    messageId: MessageId.make(`message:${input.id}`),
    text: input.text,
  };
  return input.role === "user"
    ? {
        ...base,
        createdBy: "user",
        creationSource: "server",
        type: "user_message",
        inputIntent: "turn_start",
        attachments: [],
      }
    : {
        ...base,
        type: "assistant_message",
        streaming: false,
      };
}

it.layer(TestLayer)("ContextHandoffService legacy import", (it) => {
  it.effect("prepares imported history for the first native v2 turn", () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareLegacyImport({
        threadId: ThreadId.make("thread:legacy-context"),
        targetRunId: RunId.make("run:first-v2"),
        toProviderThreadId: ProviderThreadId.make("provider-thread:first-v2"),
        toProviderInstanceId: ProviderInstanceId.make("codex"),
        items: [
          importedItem({ role: "user", id: "one", text: "What did we decide?", ordinal: 1 }),
          importedItem({
            role: "assistant",
            id: "two",
            text: "We decided to keep the migration lightweight.",
            ordinal: 2,
          }),
        ],
        createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });

      assert.equal(handoff.strategy, "manual_context");
      assert.deepStrictEqual(handoff.fromProviderThreadIds, []);
      assert.include(handoff.summaryText, "What did we decide?");
      assert.include(handoff.summaryText, "keep the migration lightweight");
      const providerMessage = ContextHandoffService.providerMessageWithContextHandoff({
        handoff,
        userText: "Continue from there.",
      });
      assert.include(providerMessage, handoff.summaryText);
      assert.include(providerMessage, "User message:\nContinue from there.");
    }),
  );

  it.effect("preserves role attribution when truncating imported history", () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareLegacyImport({
        threadId: ThreadId.make("thread:legacy-context"),
        targetRunId: RunId.make("run:first-v2"),
        toProviderThreadId: ProviderThreadId.make("provider-thread:first-v2"),
        toProviderInstanceId: ProviderInstanceId.make("codex"),
        items: [
          importedItem({
            role: "user",
            id: "long",
            text: `${"x".repeat(35_000)} retained final words`,
            ordinal: 1,
          }),
        ],
        createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });

      assert.isAtMost(handoff.summaryText.length, 32_000);
      assert.include(handoff.summaryText, "User:\n... retained final words");
      assert.notMatch(handoff.summaryText, /\n+x+ retained final words/);
    }),
  );

  it.effect("retains the newest oversized import even when it has no whitespace", () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareLegacyImport({
        threadId: ThreadId.make("thread:legacy-context"),
        targetRunId: RunId.make("run:first-v2"),
        toProviderThreadId: ProviderThreadId.make("provider-thread:first-v2"),
        toProviderInstanceId: ProviderInstanceId.make("codex"),
        items: [
          importedItem({
            role: "assistant",
            id: "older",
            text: "older message",
            ordinal: 1,
          }),
          importedItem({
            role: "user",
            id: "long-single-token",
            text: `${"🧪".repeat(20_000)}LATEST_SINGLE_TOKEN`,
            ordinal: 2,
          }),
        ],
        createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });

      assert.include(
        handoff.history?.omittedItemIds ?? [],
        TurnItemId.make("turn-item:long-single-token"),
      );
      assert.isAtMost(handoff.summaryText.length, 32_000);
      assert.include(handoff.summaryText, "User:\n... ");
      assert.include(handoff.summaryText, "LATEST_SINGLE_TOKEN");
      assert.notInclude(handoff.summaryText, "\ufffd");
    }),
  );
});

const sourceThreadId = ThreadId.make("thread:handoff-source");
const screenshot = {
  type: "image",
  id: "handoff-source-00000000-0000-4000-8000-000000000001-png",
  name: "shot.png",
  mimeType: "image/png",
  sizeBytes: 1024,
} as const;

function sourceItem(
  input:
    | {
        readonly role: "user";
        readonly id: string;
        readonly text: string;
        readonly ordinal: number;
      }
    | {
        readonly role: "assistant";
        readonly id: string;
        readonly text: string;
        readonly ordinal: number;
      },
  attachments: ReadonlyArray<typeof screenshot> = [],
): OrchestrationV2TurnItem {
  const item = importedItem(input);
  return item.type === "user_message"
    ? { ...item, threadId: sourceThreadId, runId: RunId.make("run:source-1"), attachments }
    : { ...item, threadId: sourceThreadId, runId: RunId.make("run:source-1") };
}

const sourceItems = [
  sourceItem(
    { role: "user", id: "with-image", text: `Look at this ${"layout ".repeat(60)}`, ordinal: 1 },
    [screenshot],
  ),
  sourceItem({ role: "assistant", id: "answer", text: "The header overlaps.", ordinal: 2 }),
  sourceItem({ role: "user", id: "follow-up", text: "Fix it.", ordinal: 3 }),
];

it.layer(TestLayer)("ContextHandoffService attachments", (it) => {
  it.effect("names earlier attachments with their on-disk paths on a provider switch", () =>
    Effect.gen(function* () {
      const { attachmentsDir } = yield* ServerConfig.ServerConfig;
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareProviderHandoff({
        threadId: sourceThreadId,
        targetRunId: RunId.make("run:source-2"),
        transferId: null,
        fromProviderThreadIds: [ProviderThreadId.make("provider-thread:codex")],
        toProviderThreadId: ProviderThreadId.make("provider-thread:claude"),
        fromProviderInstanceId: ProviderInstanceId.make("codex"),
        toProviderInstanceId: ProviderInstanceId.make("claudeAgent"),
        coveredRunOrdinals: { from: 1, to: 1 },
        strategy: "full_thread_summary",
        items: sourceItems,
        createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });

      const imageMessage = handoff.history?.messages.find(
        (message) => message.itemId === TurnItemId.make("turn-item:with-image"),
      );
      assert.include(
        imageMessage?.text ?? "",
        `[Attachments: shot.png (image/png, id ${screenshot.id}) at ${NodePath.join(attachmentsDir, `${screenshot.id}.png`)}]`,
      );
      assert.include(handoff.summaryText, NodePath.join(attachmentsDir, `${screenshot.id}.png`));
      assert.include(
        handoff.history?.coverage ?? "",
        `t3_thread_read({threadId:"${sourceThreadId}"`,
      );
    }),
  );

  it.effect("points a portable fork at its source thread", () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const forkThreadId = ThreadId.make("thread:handoff-fork");
      const handoff = yield* service.prepareProviderHandoff({
        threadId: forkThreadId,
        targetRunId: RunId.make("run:fork-1"),
        transferId: null,
        fromProviderThreadIds: [],
        toProviderThreadId: ProviderThreadId.make("provider-thread:fork-claude"),
        fromProviderInstanceId: ProviderInstanceId.make("codex"),
        toProviderInstanceId: ProviderInstanceId.make("claudeAgent"),
        coveredRunOrdinals: { from: 1, to: 1 },
        strategy: "full_thread_summary",
        items: sourceItems,
        createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });

      assert.include(
        handoff.history?.coverage ?? "",
        `This history comes from source thread ${sourceThreadId}; read its full history with t3_thread_read({threadId:"${sourceThreadId}"`,
      );
    }),
  );

  it.effect("keeps attachments on a merge-back line past the text compaction", () =>
    Effect.gen(function* () {
      const { attachmentsDir } = yield* ServerConfig.ServerConfig;
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareForkDelta({
        sourceThreadId,
        targetThreadId: ThreadId.make("thread:merge-target"),
        targetRunId: RunId.make("run:merge-target"),
        transferId: null,
        fromProviderThreadIds: [],
        toProviderThreadId: ProviderThreadId.make("provider-thread:merge-target"),
        fromProviderInstanceId: ProviderInstanceId.make("codex"),
        toProviderInstanceId: ProviderInstanceId.make("codex"),
        coveredRunOrdinals: { from: 1, to: 1 },
        deltaItems: sourceItems,
        createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });

      const userLine = handoff.summaryText
        .split("\n")
        .find((line) => line.startsWith("- User: Look at this"));
      assert.match(userLine ?? "", /\.\.\. \[Attachments: shot\.png/);
      assert.include(userLine ?? "", NodePath.join(attachmentsDir, `${screenshot.id}.png`));
    }),
  );
});
