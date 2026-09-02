import { expect, it, vi } from "vite-plus/test";

const { getSharedHighlighter } = vi.hoisted(() => ({
  getSharedHighlighter: vi.fn(),
}));

vi.mock("@pierre/diffs", () => ({
  getSharedHighlighter,
}));

import { getOptionalSyntaxHighlighterPromise } from "./syntaxHighlighting";

it("reports a dead engine as no highlighter, and stops attempting it", async () => {
  // A renderer whose CSP withholds wasm-unsafe-eval cannot compile the engine,
  // and @pierre/diffs keeps the failed engine in a module singleton, so no
  // later attempt can do better.
  getSharedHighlighter.mockImplementation(() => Promise.reject(new Error("CompileError")));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  // One attempt for the language, one for the "text" it falls back to.
  await expect(getOptionalSyntaxHighlighterPromise("ts")).resolves.toBeNull();
  expect(getSharedHighlighter).toHaveBeenCalledTimes(2);

  await expect(getOptionalSyntaxHighlighterPromise("ts")).resolves.toBeNull();
  expect(getSharedHighlighter).toHaveBeenCalledTimes(2);

  // A second language reuses the cached "text" failure rather than retrying it.
  await expect(getOptionalSyntaxHighlighterPromise("py")).resolves.toBeNull();
  expect(getSharedHighlighter).toHaveBeenCalledTimes(3);

  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});
