import {
  EventId,
  MessageId,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadTranscript } from "./threadTranscript.ts";

function message(input: {
  id: string;
  role: OrchestrationMessage["role"];
  text: string;
  attachments?: OrchestrationMessage["attachments"];
  turnId?: string;
  createdAt?: string;
}): OrchestrationMessage {
  return {
    id: MessageId.make(input.id),
    role: input.role,
    text: input.text,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    turnId: input.turnId !== undefined ? TurnId.make(input.turnId) : null,
    streaming: false,
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

function activity(input: {
  id: string;
  tone: OrchestrationThreadActivity["tone"];
  kind: string;
  summary: string;
  payload?: unknown;
  turnId?: string;
  createdAt?: string;
  sequence?: number;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(input.id),
    tone: input.tone,
    kind: input.kind,
    summary: input.summary,
    payload: input.payload ?? {},
    turnId: input.turnId !== undefined ? TurnId.make(input.turnId) : null,
    ...(input.sequence !== undefined ? { sequence: input.sequence } : {}),
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("buildThreadTranscript", () => {
  it("renders conversation text and attachment metadata in order", () => {
    const transcript = buildThreadTranscript(
      {
        messages: [
          message({
            id: "msg-1",
            role: "user",
            text: "Please inspect this config.",
            createdAt: "2026-01-01T00:00:01.000Z",
          }),
          message({
            id: "msg-2",
            role: "assistant",
            text: "I found the issue.",
            createdAt: "2026-01-01T00:00:02.000Z",
            attachments: [
              {
                type: "file",
                id: "attachment-1",
                name: "config.json",
                mimeType: "application/json",
                sizeBytes: 42,
              },
            ],
          }),
        ],
      },
      {
        sourceTitle: "Source Thread",
        intro: "Replay this into the fork.",
      },
    );

    expect(transcript).toContain("# Conversation transcript");
    expect(transcript).toContain("Replay this into the fork.");
    expect(transcript).toContain("**Source thread:** Source Thread");
    expect(transcript.indexOf("## User")).toBeLessThan(transcript.indexOf("## Assistant"));
    expect(transcript).toContain("Please inspect this config.");
    expect(transcript).toContain("- config.json (application/json, 42 bytes)");
  });

  it("includes original attachment paths when provided", () => {
    const transcript = buildThreadTranscript(
      {
        messages: [
          message({
            id: "msg-1",
            role: "user",
            text: "See the attachment.",
            attachments: [
              {
                type: "file",
                id: "attachment-1",
                name: "config.json",
                mimeType: "application/json",
                sizeBytes: 42,
              },
            ],
          }),
        ],
      },
      {
        attachmentDetailsById: new Map([
          ["attachment-1", { absolutePath: "/state/attachments/attachment-1.json" }],
        ]),
      },
    );

    expect(transcript).toContain(
      "- config.json (application/json, 42 bytes) — read /state/attachments/attachment-1.json if you need the original attachment bytes",
    );
  });

  it("skips empty messages without dropping later content", () => {
    const transcript = buildThreadTranscript({
      messages: [
        message({ id: "msg-empty", role: "user", text: "   " }),
        message({ id: "msg-system", role: "system", text: "System context" }),
      ],
    });

    expect(transcript).not.toContain("## User");
    expect(transcript).toContain("## System");
    expect(transcript).toContain("System context");
  });

  it("renders completed tool calls with their result and skips started/updated", () => {
    const transcript = buildThreadTranscript({
      messages: [
        message({
          id: "msg-1",
          role: "user",
          text: "run it",
          createdAt: "2026-01-01T00:00:01.000Z",
        }),
      ],
      activities: [
        activity({
          id: "act-started",
          tone: "tool",
          kind: "tool.started",
          summary: "Terminal started",
          createdAt: "2026-01-01T00:00:02.000Z",
        }),
        activity({
          id: "act-done",
          tone: "tool",
          kind: "tool.completed",
          summary: "Terminal",
          createdAt: "2026-01-01T00:00:03.000Z",
          payload: {
            itemType: "command_execution",
            data: { item: { command: "echo hi", result: { output: "hi" } } },
          },
        }),
      ],
    });

    expect(transcript).toContain("Ran command: `echo hi`");
    expect(transcript).toContain("hi");
    expect(transcript).not.toContain("started");
  });

  it("excludes the running turn so only completed work is serialized", () => {
    const latestTurn: OrchestrationLatestTurn = {
      turnId: TurnId.make("turn-2"),
      state: "running",
      requestedAt: "2026-01-01T00:00:05.000Z",
      startedAt: "2026-01-01T00:00:05.000Z",
      completedAt: null,
      assistantMessageId: null,
    };
    const transcript = buildThreadTranscript({
      messages: [
        message({
          id: "msg-done",
          role: "user",
          text: "completed work",
          turnId: "turn-1",
          createdAt: "2026-01-01T00:00:01.000Z",
        }),
        message({
          id: "msg-inflight",
          role: "user",
          text: "in-flight prompt",
          turnId: "turn-2",
          createdAt: "2026-01-01T00:00:05.000Z",
        }),
      ],
      activities: [
        activity({
          id: "act-inflight",
          tone: "tool",
          kind: "tool.completed",
          summary: "Terminal",
          turnId: "turn-2",
          createdAt: "2026-01-01T00:00:06.000Z",
          payload: { itemType: "command_execution", data: { item: { command: "rm -rf tmp" } } },
        }),
      ],
      latestTurn,
    });

    expect(transcript).toContain("completed work");
    expect(transcript).not.toContain("in-flight prompt");
    expect(transcript).not.toContain("rm -rf");
  });
});
