import {
  getSharedHighlighter,
  type DiffsHighlighter,
  type HighlighterTypes,
  type SupportedLanguages,
} from "@pierre/diffs";

import { resolveDiffThemeName } from "./diffRendering";

/**
 * Always highlight with the Oniguruma WASM engine — the JS regex engine can
 * backtrack catastrophically and hang the tokenizing thread. The shared
 * highlighter is a first-caller-wins singleton, so every creation site must
 * pass this value.
 */
export const PREFERRED_HIGHLIGHTER: HighlighterTypes = "shiki-wasm";

const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

export function getSyntaxHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: PREFERRED_HIGHLIGHTER,
  }).catch((error) => {
    if (language === "text") {
      // "text" itself failed — Shiki cannot initialize at all, surface the
      // error. The rejection stays cached: getSharedHighlighter keeps its
      // failed engine in a module singleton, so every later call awaits that
      // same rejection. Dropping the entry only bought a retry that cannot
      // succeed, at the cost of one more attempt per language and per mount.
      throw error;
    }
    // Language not supported by Shiki — fall back to "text"
    return getSyntaxHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}

const optionalHighlighterPromiseCache = new Map<string, Promise<DiffsHighlighter | null>>();
let reportedHighlighterFailure = false;

/**
 * The highlighter, or null when this client cannot run one at all — a renderer
 * whose Content-Security-Policy withholds `wasm-unsafe-eval` cannot compile the
 * Oniguruma engine, and no later attempt will do better.
 *
 * Never rejects. A rejection here reaches React during render, and every catch
 * swaps a mounted code block for its plain-text fallback; callers render that
 * fallback directly instead, leaving the DOM alone.
 */
export function getOptionalSyntaxHighlighterPromise(
  language: string,
): Promise<DiffsHighlighter | null> {
  const cached = optionalHighlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSyntaxHighlighterPromise(language).catch((error: unknown) => {
    if (!reportedHighlighterFailure) {
      reportedHighlighterFailure = true;
      console.warn(
        "[syntax-highlighting] Falling back to plain code: the highlighter engine failed to load.",
        error,
      );
    }
    return null;
  });
  optionalHighlighterPromiseCache.set(language, promise);
  return promise;
}
