import {
  type ChatAttachment,
  MessageId,
  type OrchestrationV2ConversationMessage,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadExportZip, THREAD_EXPORT_TRANSCRIPT_ENTRY } from "./threadExport.ts";

const now = DateTime.makeUnsafe("2026-10-01T00:00:00.000Z");
const threadId = ThreadId.make("thread-1");

const attachment = (id: string, name: string): ChatAttachment => ({
  type: "file",
  id,
  name,
  mimeType: "text/plain",
  sizeBytes: 5,
});

const userMessage = (
  id: string,
  text: string,
  attachments: ReadonlyArray<ChatAttachment>,
): OrchestrationV2ConversationMessage => ({
  createdBy: "user",
  creationSource: "web",
  id: MessageId.make(id),
  threadId,
  runId: null,
  nodeId: null,
  role: "user",
  text,
  attachments: [...attachments],
  streaming: false,
  createdAt: now,
  updatedAt: now,
});

describe("buildThreadExportZip", () => {
  it("bundles the transcript and attachment bytes, skipping attachments without bytes", () => {
    const notes = attachment("thread-1-aaaa", "notes.txt");
    const duplicateName = attachment("thread-1-bbbb", "notes.txt");
    const missing = attachment("thread-1-cccc", "gone.txt");
    const unsafe = attachment("thread-1-dddd", "../../etc/passwd");
    const zip = buildThreadExportZip({
      title: "Export me",
      source: {
        messages: [
          userMessage("m-1", "first", [notes, missing]),
          userMessage("m-2", "second", [duplicateName, unsafe]),
        ],
        visibleTurnItems: [],
      },
      attachmentBytesById: new Map([
        [notes.id, new TextEncoder().encode("one")],
        [duplicateName.id, new TextEncoder().encode("two")],
        [unsafe.id, new TextEncoder().encode("three")],
      ]),
    });

    const entries = unzipSync(zip);
    expect(Object.keys(entries).toSorted()).toEqual([
      "attachments/_.._etc_passwd",
      "attachments/notes.txt",
      "attachments/thread-1-bbbb-notes.txt",
      THREAD_EXPORT_TRANSCRIPT_ENTRY,
    ]);
    expect(strFromU8(entries["attachments/notes.txt"]!)).toBe("one");
    expect(strFromU8(entries["attachments/thread-1-bbbb-notes.txt"]!)).toBe("two");

    const transcript = strFromU8(entries[THREAD_EXPORT_TRANSCRIPT_ENTRY]!);
    expect(transcript.startsWith("# Export me\n")).toBe(true);
    expect(transcript).toContain("- notes.txt (text/plain, 5 B) — `attachments/notes.txt`");
    // Listed without a path: its bytes were not available.
    expect(transcript).toContain("- gone.txt (text/plain, 5 B)\n");
  });
});
