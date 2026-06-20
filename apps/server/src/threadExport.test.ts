import type { OrchestrationThread } from "@t3tools/contracts";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadExportZip, THREAD_EXPORT_TRANSCRIPT_ENTRY } from "./threadExport.ts";

const thread = {
  title: "My thread",
  messages: [
    {
      id: "m1",
      role: "user",
      text: "hello world",
      attachments: [
        { type: "file", id: "att-1", name: "log.txt", mimeType: "text/plain", sizeBytes: 11 },
      ],
      turnId: null,
      streaming: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  activities: [],
} as unknown as OrchestrationThread;

describe("buildThreadExportZip", () => {
  it("packages the transcript and attachments into a zip", () => {
    const zip = buildThreadExportZip({
      thread,
      attachmentBytesById: new Map([["att-1", new TextEncoder().encode("hello-bytes")]]),
    });
    const entries = unzipSync(zip);

    expect(Object.keys(entries)).toContain(THREAD_EXPORT_TRANSCRIPT_ENTRY);
    expect(strFromU8(entries[THREAD_EXPORT_TRANSCRIPT_ENTRY]!)).toContain("hello world");
    expect(Object.keys(entries)).toContain("attachments/log.txt");
    expect(strFromU8(entries["attachments/log.txt"]!)).toBe("hello-bytes");
  });

  it("skips attachments whose bytes are unavailable", () => {
    const zip = buildThreadExportZip({ thread, attachmentBytesById: new Map() });
    const entries = unzipSync(zip);

    expect(Object.keys(entries)).toEqual([THREAD_EXPORT_TRANSCRIPT_ENTRY]);
  });
});
