import { describe, expect, it } from "vite-plus/test";

import {
  formatThreadReference,
  parseThreadReferenceIds,
  THREAD_REFERENCE_PREFIX,
} from "./threadReference.ts";

describe("threadReference", () => {
  it("formats a token from a thread id", () => {
    expect(formatThreadReference("abc-123")).toBe(`${THREAD_REFERENCE_PREFIX}abc-123`);
  });

  it("extracts referenced ids in order, de-duplicated", () => {
    const ids = parseThreadReferenceIds(
      "compare @thread_ref:thread-a with @thread_ref:thread-b (again @thread_ref:thread-a)",
    );
    expect(ids).toEqual(["thread-a", "thread-b"]);
  });

  it("returns nothing when there are no references", () => {
    expect(parseThreadReferenceIds("no references here")).toEqual([]);
  });

  it("matches a uuid-style id", () => {
    const id = "0b3f2c1e-1234-4abc-8def-1234567890ab";
    expect(parseThreadReferenceIds(`see ${formatThreadReference(id)}`)).toEqual([id]);
  });
});
