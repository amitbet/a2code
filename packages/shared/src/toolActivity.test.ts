import { describe, expect, it } from "vite-plus/test";

import { deriveToolActivityPresentation } from "./toolActivity.ts";

describe("toolActivity", () => {
  it("normalizes command tools to a stable ran-command label", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "command_execution",
        title: "Terminal",
        detail: "Terminal",
        data: {
          command: "bun run lint",
        },
        fallbackSummary: "Terminal",
      }),
    ).toEqual({
      summary: "Ran command",
      detail: "bun run lint",
    });
  });

  it("uses structured file paths for read-file tools when available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          locations: [{ path: "/tmp/app.ts" }],
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
      detail: "/tmp/app.ts",
    });
  });

  // Cursor (ACP) leaves `rawInput` empty and sends no `locations`; the edited
  // file's path is only present on the diff content block.
  it("uses the diff content block path for file changes", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "file_change",
        title: "Edit",
        data: {
          kind: "edit",
          rawInput: {},
          content: [
            {
              type: "diff",
              path: "/Users/dev/app/src/index.ts",
              oldText: "a",
              newText: "b",
            },
          ],
        },
        fallbackSummary: "Edit",
      }),
    ).toEqual({
      summary: "Changed files",
      detail: "/Users/dev/app/src/index.ts",
    });
  });

  it("drops duplicated generic read-file detail when no path is available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          rawInput: {},
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
    });
  });
});
