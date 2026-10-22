import type { DiffsHighlighter } from "@pierre/diffs";
import { useMemo } from "react";
import { Check, Copy } from "lucide";
import { PlayIcon, WrapTextIcon } from "lucide-react";
import { toHtml } from "hast-util-to-html";
import React, { use, useEffect, useRef, useState, type ReactNode } from "react";

import { getClientSettings } from "../../hooks/useSettings";
import type { DiffThemeName } from "../../lib/diffRendering";
import { createIncrementalHighlightedDocument } from "../../lib/incrementalHighlighting";
import { LRUCache } from "../../lib/lruCache";
import { getOptionalSyntaxHighlighterPromise } from "../../lib/syntaxHighlighting";
import { cn } from "../../lib/utils";
import {
  hasSpecificPierreIconForFileName,
  syntheticFileNameForLanguageId,
} from "../../pierre-icons";
import { MorphIcon } from "../MorphIcon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { HighlightedCodeLines } from "./HighlightedCodeLines";
import {
  createHighlightCacheKey,
  estimateHighlightedSize,
  extractFenceLanguage,
} from "./MarkdownCodeBlock.logic";
import { reportMarkdownActionFailure } from "./markdownActionFailure";
import { PierreEntryIcon } from "./PierreEntryIcon";

const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;

const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);

const THREAD_FIND_IGNORE_PROPS = {
  "data-thread-find-ignore": "",
} as React.HTMLAttributes<HTMLDivElement>;

export function MarkdownCodeBlockFrame({
  as: Wrapper = "div",
  language,
  fenceTitle,
  theme,
  wrapped = true,
  title,
  actions,
  headerProps,
  children,
}: {
  as?: React.ElementType;
  language: string;
  fenceTitle: string | null;
  theme: "light" | "dark";
  wrapped?: boolean;
  title?: React.ReactNode;
  actions?: React.ReactNode;
  headerProps?: React.HTMLAttributes<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <Wrapper
      dir="ltr"
      className="chat-markdown-codeblock my-[0.65rem] overflow-hidden rounded-lg border border-border/70 bg-secondary leading-snug dark:border-transparent dark:bg-input/32"
      data-language={language}
      data-wrap={wrapped ? "true" : "false"}
    >
      <div
        {...headerProps}
        className={cn(
          "chat-markdown-codeblock-header flex items-center justify-between gap-2 pt-1.5 pr-1.5 pb-0 pl-3 select-none",
          headerProps?.className,
        )}
      >
        {title ?? (
          <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-2xs">
            <MarkdownCodeBlockTitleContent
              fenceTitle={fenceTitle}
              language={language}
              theme={theme}
            />
          </span>
        )}
        {actions}
      </div>
      {children}
    </Wrapper>
  );
}

function MarkdownCodeBlockTitleContent({
  fenceTitle,
  language,
  theme,
}: {
  fenceTitle: string | null;
  language: string;
  theme: "light" | "dark";
}) {
  if (fenceTitle) {
    return (
      <>
        <PierreEntryIcon pathValue={fenceTitle} kind="file" theme={theme} className="size-3.5" />
        <span className="truncate">{fenceTitle}</span>
      </>
    );
  }

  const fileName = syntheticFileNameForLanguageId(language);
  if (!hasSpecificPierreIconForFileName(fileName)) {
    return <span className="truncate">{language}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0 rounded-sm" aria-label={`Language: ${language}`} />
        }
      >
        <PierreEntryIcon pathValue={fileName} kind="file" theme={theme} className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{language}</TooltipPopup>
    </Tooltip>
  );
}

export function MarkdownCodeBlock({
  code,
  language,
  fenceTitle,
  theme,
  onRunShellCommand,
  isStreaming,
  viewToggle,
  canWrap = true,
  diagram = false,
  children,
}: {
  code: string;
  language: string;
  fenceTitle: string | null;
  theme: "light" | "dark";
  onRunShellCommand?: ((command: string) => void) | undefined;
  isStreaming: boolean;
  viewToggle?: ReactNode;
  canWrap?: boolean;
  diagram?: boolean;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [wrapped, setWrapped] = useState(() => getClientSettings().wordWrap);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapLabel = wrapped ? "Disable line wrap" : "Wrap lines";
  const copyLabel = copied ? "Copied" : "Copy code";
  const command = code.trim();
  const canRun =
    onRunShellCommand !== undefined &&
    !isStreaming &&
    /^(?:sh|bash|zsh|fish|shell|powershell|pwsh)$/.test(language) &&
    code.endsWith("\n") &&
    command.length > 0 &&
    !command.endsWith("\\") &&
    // Control and invisible format characters (bidi overrides, zero-width) can
    // make the rendered command differ from what the terminal would receive.
    !/[\p{Cc}\p{Cf}]/u.test(code.slice(0, -1));

  const handleCopy = () => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch((cause) => {
        reportMarkdownActionFailure(
          {
            operation: "copy-code-block",
            language,
            ...(fenceTitle ? { fenceTitle } : {}),
          },
          cause,
        );
      });
  };

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  const copyButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost-muted"
            size="icon-xs"
            onClick={handleCopy}
            aria-label={copyLabel}
          />
        }
      >
        <MorphIcon className="size-3" icon={copied ? Check : Copy} />
      </TooltipTrigger>
      <TooltipPopup side="top">{copyLabel}</TooltipPopup>
    </Tooltip>
  );

  if (diagram) {
    return (
      <div className="my-[0.65rem] border border-transparent" data-language={language}>
        <div className="flex items-center justify-end gap-0.5 pt-1.5 pr-1.5 select-none">
          {viewToggle}
          {copyButton}
        </div>
        {children}
      </div>
    );
  }

  return (
    <MarkdownCodeBlockFrame
      language={language}
      fenceTitle={fenceTitle}
      theme={theme}
      wrapped={wrapped}
      headerProps={THREAD_FIND_IGNORE_PROPS}
      actions={
        <span className="flex items-center gap-0.5" role="toolbar" aria-label="Code block actions">
          {canWrap ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant={wrapped ? "secondary" : "ghost-muted"}
                    size="icon-xs"
                    aria-pressed={wrapped}
                    onClick={() => setWrapped((value) => !value)}
                    aria-label={wrapLabel}
                  />
                }
              >
                <WrapTextIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">{wrapLabel}</TooltipPopup>
            </Tooltip>
          ) : null}
          {canRun ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="icon-xs"
                    onClick={() => onRunShellCommand(command)}
                    aria-label="Run in terminal"
                  />
                }
              >
                <PlayIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">Run in terminal</TooltipPopup>
            </Tooltip>
          ) : null}
          {viewToggle}
          {copyButton}
        </span>
      }
    >
      {children}
    </MarkdownCodeBlockFrame>
  );
}

function selectionIntersectsElement(element: HTMLElement | null): boolean {
  if (!element || typeof window === "undefined" || typeof window.getSelection !== "function") {
    return false;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    try {
      if (selection.getRangeAt(index).intersectsNode(element)) {
        return true;
      }
    } catch {
      // Ignore stale ranges from DOM that was removed while React was updating.
    }
  }

  return false;
}

function waitForSelectionOutsideElement(shouldWait: () => boolean): Promise<void> {
  if (!shouldWait()) {
    return Promise.resolve();
  }

  if (typeof document === "undefined") {
    return Promise.resolve();
  }

  const doc = document;
  const win = typeof window === "undefined" ? null : window;
  if (typeof doc.addEventListener !== "function") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let frame = 0;
    let settled = false;

    const cleanup = () => {
      if (frame !== 0 && win && typeof win.cancelAnimationFrame === "function") {
        win.cancelAnimationFrame(frame);
      }
      frame = 0;
      doc.removeEventListener("selectionchange", scheduleCheck);
      win?.removeEventListener("pointerup", scheduleCheck);
      win?.removeEventListener("keyup", scheduleCheck);
      win?.removeEventListener("blur", scheduleCheck);
    };

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const check = () => {
      frame = 0;
      if (!shouldWait()) {
        finish();
      }
    };

    function scheduleCheck() {
      if (settled || frame !== 0) {
        return;
      }
      if (win && typeof win.requestAnimationFrame === "function") {
        frame = win.requestAnimationFrame(check);
        return;
      }
      queueMicrotask(check);
    }

    doc.addEventListener("selectionchange", scheduleCheck);
    win?.addEventListener("pointerup", scheduleCheck);
    win?.addEventListener("keyup", scheduleCheck);
    win?.addEventListener("blur", scheduleCheck);
    scheduleCheck();
  });
}

interface SuspenseShikiCodeBlockProps {
  className: string | undefined;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
  shouldDeferAsyncHighlight: () => boolean;
  /** Unhighlighted rendering of this fence, shown until highlighting can land. */
  plain: ReactNode;
}

export function SuspenseShikiCodeBlock({
  className,
  code,
  themeName,
  isStreaming,
  shouldDeferAsyncHighlight,
  plain,
}: SuspenseShikiCodeBlockProps) {
  const [hasStreamed, setHasStreamed] = useState(isStreaming);
  if (isStreaming && !hasStreamed) setHasStreamed(true);
  const language = extractFenceLanguage(className);
  const cacheKey = createHighlightCacheKey(code, language, themeName);
  // Once lines are mounted individually, keep that renderer when streaming
  // finishes so switching to cached HTML cannot clear an existing selection.
  const cachedHighlightedHtml =
    !isStreaming && !hasStreamed ? highlightedCodeCache.get(cacheKey) : null;

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  return (
    <UncachedShikiCodeBlock
      code={code}
      language={language}
      themeName={themeName}
      cacheKey={cacheKey}
      isStreaming={isStreaming}
      shouldDeferAsyncHighlight={shouldDeferAsyncHighlight}
      plain={plain}
      preserveLines={isStreaming || hasStreamed}
    />
  );
}

type HighlightedRoot = ReturnType<DiffsHighlighter["codeToHast"]>;

interface UncachedShikiCodeBlockProps {
  code: string;
  language: string;
  themeName: DiffThemeName;
  cacheKey: string;
  isStreaming: boolean;
  shouldDeferAsyncHighlight: () => boolean;
  plain: ReactNode;
  preserveLines: boolean;
}

function UncachedShikiCodeBlock({
  code,
  language,
  themeName,
  cacheKey,
  isStreaming,
  shouldDeferAsyncHighlight,
  plain,
  preserveLines,
}: UncachedShikiCodeBlockProps) {
  // Resolves to null rather than rejecting: a rejection during render reaches
  // the enclosing boundary, and every catch replaces this block's live DOM.
  const highlighter = use(getOptionalSyntaxHighlighterPromise(language));
  const incrementalHighlight = (() =>
    highlighter !== null && preserveLines
      ? createIncrementalHighlightedDocument(highlighter, language, themeName)
      : null)();
  const highlighted = ((): string | HighlightedRoot | null => {
    if (highlighter === null) return null;
    try {
      if (incrementalHighlight) return incrementalHighlight(code);
      return preserveLines
        ? highlighter.codeToHast(code, { lang: language, theme: themeName })
        : highlighter.codeToHtml(code, { lang: language, theme: themeName });
    } catch (error) {
      // Log highlighting failures for debugging while falling back to plain text
      console.warn(
        `Code highlighting failed for language "${language}", falling back to plain text.`,
        error instanceof Error ? error.message : error,
      );
      // If highlighting fails for this language, render as plain text
      return preserveLines
        ? highlighter.codeToHast(code, { lang: "text", theme: themeName })
        : highlighter.codeToHtml(code, { lang: "text", theme: themeName });
    }
  })();

  // Replacing this block's markup destroys any selection inside it, so the swap
  // waits for the selection to leave. Waiting cannot suspend: a boundary that
  // falls back hides the very nodes the selection points at, which is the loss
  // the wait exists to prevent.
  const [shown, setShown] = useState(() => (shouldDeferAsyncHighlight() ? null : highlighted));
  if (
    shown !== highlighted &&
    shown !== null &&
    typeof shown !== "string" &&
    typeof highlighted !== "string"
  )
    setShown(highlighted);
  useEffect(() => {
    if (shown === highlighted) return;
    // Keyed line rendering preserves the completed lines' DOM, so once lines
    // are mounted a newer line document can land without waiting for the
    // selection to leave. Only a swap that replaces markup wholesale waits.
    if (shown !== null && typeof shown !== "string" && typeof highlighted !== "string") return;
    let cancelled = false;
    void waitForSelectionOutsideElement(shouldDeferAsyncHighlight).then(() => {
      if (!cancelled) setShown(highlighted);
    });
    return () => {
      cancelled = true;
    };
  }, [highlighted, shouldDeferAsyncHighlight, shown]);

  useEffect(() => {
    if (!isStreaming && highlighted !== null) {
      const highlightedHtml = typeof highlighted === "string" ? highlighted : toHtml(highlighted);
      highlightedCodeCache.set(
        cacheKey,
        highlightedHtml,
        estimateHighlightedSize(highlightedHtml, code),
      );
    }
  }, [cacheKey, code, highlighted, isStreaming]);

  if (shown === null) return plain;
  return typeof shown === "string" ? (
    <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: shown }} />
  ) : (
    <div className="chat-markdown-shiki">
      <HighlightedCodeLines root={shown} />
    </div>
  );
}
