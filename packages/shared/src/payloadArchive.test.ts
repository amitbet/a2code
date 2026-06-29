import { describe, expect, it } from "vite-plus/test";

import {
  createPayloadArchive,
  extractPayloadArchive,
  PayloadArchiveError,
  type PayloadArchiveEntry,
} from "./payloadArchive.ts";

const textEntry = (path: string, text: string): PayloadArchiveEntry => ({
  path,
  data: new TextEncoder().encode(text),
});

describe("payload archive codec", () => {
  it("round-trips file entries byte-for-byte", () => {
    const entries: PayloadArchiveEntry[] = [
      textEntry("bin.mjs", "console.log('server')\n"),
      textEntry("client/index.html", "<!doctype html><title>app</title>"),
      // A non-block-aligned size to exercise tar padding.
      textEntry("client/assets/app.js", "x".repeat(513)),
      { path: "client/assets/blob.bin", data: new Uint8Array([0, 1, 2, 255, 128, 0]) },
    ];

    const extracted = extractPayloadArchive(createPayloadArchive(entries));
    expect(extracted).toHaveLength(entries.length);
    for (const original of entries) {
      const found = extracted.find((entry) => entry.path === original.path);
      expect(found, original.path).toBeDefined();
      expect(Array.from(found!.data)).toEqual(Array.from(original.data));
    }
  });

  it("preserves deeply nested paths via the ustar prefix field", () => {
    const deepPath = `client/assets/${"nested/".repeat(20)}chunk.js`;
    const [extracted] = extractPayloadArchive(createPayloadArchive([textEntry(deepPath, "ok")]));
    expect(extracted?.path).toBe(deepPath);
    expect(new TextDecoder().decode(extracted?.data)).toBe("ok");
  });

  it("rejects path-traversing entries when building", () => {
    expect(() => createPayloadArchive([textEntry("../escape.js", "nope")])).toThrow(
      PayloadArchiveError,
    );
  });

  it("fails on a corrupt (truncated) archive", () => {
    const archive = createPayloadArchive([textEntry("bin.mjs", "ok")]);
    expect(() => extractPayloadArchive(archive.subarray(0, archive.byteLength - 4))).toThrow();
  });
});
