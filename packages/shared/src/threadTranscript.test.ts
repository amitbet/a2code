import {
  type ChatAttachment,
  MessageId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadTranscript, collectThreadTranscriptAttachments } from "./threadTranscript.ts";

const now = DateTime.makeUnsafe("2026-10-01T00:00:00.000Z");
const threadId = ThreadId.make("thread-1");

const itemBase = (id: string, status: OrchestrationV2TurnItem["status"] = "completed") => ({
  id: TurnItemId.make(id),
  threadId,
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 0,
  status,
  title: null,
  startedAt: null,
  completedAt: null,
  updatedAt: now,
});

const message = (
  id: string,
  role: OrchestrationV2ConversationMessage["role"],
  text: string,
  attachments: ReadonlyArray<ChatAttachment> = [],
): OrchestrationV2ConversationMessage => ({
  createdBy: role === "user" ? "user" : "agent",
  creationSource: "web",
  id: MessageId.make(id),
  threadId,
  runId: null,
  nodeId: null,
  role,
  text,
  attachments: [...attachments],
  streaming: false,
  createdAt: now,
  updatedAt: now,
});

const userItem = (msg: OrchestrationV2ConversationMessage): OrchestrationV2TurnItem => ({
  ...itemBase(`item-${msg.id}`),
  createdBy: "user",
  creationSource: "web",
  type: "user_message",
  messageId: msg.id,
  inputIntent: "turn_start",
  text: msg.text,
  attachments: msg.attachments,
});

const assistantItem = (
  msg: OrchestrationV2ConversationMessage,
  text = msg.text,
): OrchestrationV2TurnItem => ({
  ...itemBase(`item-${msg.id}`),
  type: "assistant_message",
  messageId: msg.id,
  text,
  streaming: false,
});

const visible = (
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): Array<OrchestrationV2ProjectedTurnItem> =>
  items.map((item, position) => ({
    position,
    visibility: "local",
    sourceThreadId: item.threadId,
    sourceItemId: item.id,
    item,
  }));

const screenshot: ChatAttachment = {
  type: "image",
  id: "thread-1-11111111-1111-4111-8111-111111111111",
  name: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 2048,
};

describe("buildThreadTranscript", () => {
  it("renders messages and finished tool work in timeline order", () => {
    const question = message("m-1", "user", "Why does the build fail?", [screenshot]);
    const answer = message("m-2", "assistant", "The lockfile is stale.");
    const transcript = buildThreadTranscript(
      {
        messages: [question, answer],
        visibleTurnItems: visible([
          userItem(question),
          {
            ...itemBase("reasoning-1"),
            type: "reasoning",
            text: "private chain of thought",
            streaming: false,
          },
          {
            ...itemBase("cmd-1"),
            type: "command_execution",
            input: "bun install",
            output: "error: lockfile had changes",
            exitCode: 1,
          },
          {
            ...itemBase("cmd-running", "running"),
            type: "command_execution",
            input: "bun test",
          },
          {
            ...itemBase("edit-1"),
            type: "file_change",
            fileName: "package.json",
            additions: 1,
            deletions: 1,
            diffStr: "-a\n+b",
          },
          {
            ...itemBase("tool-1"),
            type: "dynamic_tool",
            toolName: "t3_thread_read",
            input: { threadId: "thread-2" },
            output: "ok",
          },
          assistantItem(answer),
        ]),
      },
      {
        heading: "# Build failure",
        attachmentPathsById: new Map([[screenshot.id, "attachments/screenshot.png"]]),
      },
    );

    expect(transcript.startsWith("# Build failure\n")).toBe(true);
    expect(transcript).toContain("## User\n\nWhy does the build fail?");
    expect(transcript).toContain(
      "- screenshot.png (image/png, 2.0 KB) — `attachments/screenshot.png`",
    );
    expect(transcript).toContain("### Command\n\nInput:\n\n```sh\nbun install\n```");
    expect(transcript).toContain("Output:\n\n```\nerror: lockfile had changes\n```");
    expect(transcript).toContain("Exit code: 1");
    expect(transcript).toContain("### File change: package.json (+1 -1)");
    expect(transcript).toContain('### Tool: t3_thread_read\n\nInput:\n\n```json\n{\n  "threadId"');
    expect(transcript).not.toContain("private chain of thought");
    expect(transcript).not.toContain("bun test");

    const order = ["## User", "bun install", "package.json", "t3_thread_read", "## Assistant"].map(
      (needle) => transcript.indexOf(needle),
    );
    expect(order).toEqual(order.toSorted((left, right) => left - right));
  });

  it("prefers the message record's final text over the turn item", () => {
    const answer = message("m-1", "assistant", "Final answer.");
    const transcript = buildThreadTranscript({
      messages: [answer],
      visibleTurnItems: visible([assistantItem(answer, "Final ans")]),
    });
    expect(transcript).toContain("Final answer.");
  });

  it("renders inherited messages from their turn items", () => {
    const parentMessage = message("parent-m", "user", "Inherited question");
    const transcript = buildThreadTranscript({
      messages: [],
      visibleTurnItems: visible([userItem(parentMessage)]),
    });
    expect(transcript).toContain("## User\n\nInherited question");
  });

  it("falls back to message records when the timeline has no messages", () => {
    // Threads imported from v1 before their turn items exist.
    const transcript = buildThreadTranscript({
      messages: [message("m-1", "user", "hello"), message("m-2", "assistant", "hi")],
      visibleTurnItems: [],
    });
    expect(transcript).toContain("## User\n\nhello");
    expect(transcript).toContain("## Assistant\n\nhi");
  });

  it("fences output that itself contains a code fence", () => {
    const transcript = buildThreadTranscript({
      messages: [],
      visibleTurnItems: visible([
        {
          ...itemBase("cmd-1"),
          type: "command_execution",
          input: "cat README.md",
          output: "```ts\nconst a = 1;\n```",
        },
      ]),
    });
    expect(transcript).toContain("````\n```ts\nconst a = 1;\n```\n````");
  });
});

describe("collectThreadTranscriptAttachments", () => {
  it("returns each rendered attachment once and skips messages off the timeline", () => {
    const shown = message("m-1", "user", "see attached", [screenshot]);
    const rolledBack = message("m-2", "user", "rolled back", [
      { ...screenshot, id: "thread-1-22222222-2222-4222-8222-222222222222", name: "old.png" },
    ]);
    const attachments = collectThreadTranscriptAttachments({
      messages: [shown, rolledBack],
      visibleTurnItems: visible([userItem(shown), userItem(shown)]),
    });
    expect(attachments.map((attachment) => attachment.name)).toEqual(["screenshot.png"]);
  });
});
