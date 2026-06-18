import { describe, expect, it } from "vite-plus/test";

import {
  ATTACHMENT_INLINE_MAX_BYTES,
  classifyAttachment,
  fenceLanguageForAttachment,
  formatTextAttachmentBlock,
} from "./attachmentContent.ts";

describe("classifyAttachment", () => {
  it("classifies raster images as image", () => {
    expect(classifyAttachment({ mimeType: "image/png" })).toBe("image");
    expect(classifyAttachment({ mimeType: "image/JPEG" })).toBe("image");
  });

  it("classifies pdf as pdf", () => {
    expect(classifyAttachment({ mimeType: "application/pdf" })).toBe("pdf");
  });

  it("classifies json/text/yaml as text by mime type", () => {
    expect(classifyAttachment({ mimeType: "application/json" })).toBe("text");
    expect(classifyAttachment({ mimeType: "text/plain" })).toBe("text");
    expect(classifyAttachment({ mimeType: "application/yaml" })).toBe("text");
  });

  it("treats svg as text, not image (it is not a supported raster image)", () => {
    expect(classifyAttachment({ mimeType: "image/svg+xml" })).toBe("text");
  });

  it("falls back to the file extension when the mime type is generic", () => {
    expect(
      classifyAttachment({ mimeType: "application/octet-stream", fileName: "data.json" }),
    ).toBe("text");
    expect(classifyAttachment({ mimeType: "application/octet-stream", fileName: "notes.md" })).toBe(
      "text",
    );
  });

  it("classifies unknown binary as binary", () => {
    expect(classifyAttachment({ mimeType: "application/zip", fileName: "bundle.zip" })).toBe(
      "binary",
    );
    expect(classifyAttachment({ mimeType: "application/octet-stream" })).toBe("binary");
  });
});

describe("fenceLanguageForAttachment", () => {
  it("derives the fence language from the extension", () => {
    expect(fenceLanguageForAttachment({ mimeType: "application/json", fileName: "x.json" })).toBe(
      "json",
    );
    expect(fenceLanguageForAttachment({ mimeType: "text/plain", fileName: "x.yaml" })).toBe("yaml");
  });

  it("falls back to the mime type when the extension is unknown", () => {
    expect(fenceLanguageForAttachment({ mimeType: "application/json" })).toBe("json");
  });
});

describe("formatTextAttachmentBlock", () => {
  it("inlines small files whole with a labelled header and fence", () => {
    const block = formatTextAttachmentBlock({
      name: "config.json",
      mimeType: "application/json",
      bytes: new TextEncoder().encode('{"a":1}'),
      absolutePath: "/state/attachments/thread-id.json",
    });
    expect(block).toBe(
      ["Attached file: config.json (application/json)", "", "```json", '{"a":1}', "```"].join("\n"),
    );
  });

  it("truncates large files to a head preview and points at the on-disk path", () => {
    const big = "x".repeat(ATTACHMENT_INLINE_MAX_BYTES + 1024);
    const block = formatTextAttachmentBlock({
      name: "huge.log",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode(big),
      absolutePath: "/state/attachments/thread-id.log",
    });
    expect(block).toContain(`${ATTACHMENT_INLINE_MAX_BYTES + 1024} bytes`);
    expect(block).toContain("/state/attachments/thread-id.log");
    // Only the head is inlined, not the whole file.
    expect(block.length).toBeLessThan(big.length);
    expect(block).toContain("x".repeat(100));
  });
});
