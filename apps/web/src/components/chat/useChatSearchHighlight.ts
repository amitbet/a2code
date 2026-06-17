import { useEffect } from "react";

/**
 * Paints in-chat search matches onto the live DOM using the CSS Custom
 * Highlight API, so we never mutate the (React-owned) timeline markup. Two
 * highlight registrations are maintained: `chat-search` for every visible
 * match and `chat-search-active` for the currently focused occurrence. The
 * matching styles live in `index.css` under `::highlight(...)`.
 *
 * Only currently-rendered rows are painted — the virtualized list mounts a
 * window of rows — so the hook re-runs whenever that window changes (scroll,
 * resize, DOM mutations) and whenever the query/active match changes.
 */

interface ActiveOccurrence {
  rowId: string;
  ordinalInRow: number;
}

const ALL_HIGHLIGHT_NAME = "chat-search";
const ACTIVE_HIGHLIGHT_NAME = "chat-search-active";

type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

function highlightRegistry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const HighlightCtor = (globalThis as { Highlight?: unknown }).Highlight;
  if (!css?.highlights || typeof HighlightCtor !== "function") return null;
  return css.highlights;
}

function buildHighlight(ranges: Range[]): unknown {
  const HighlightCtor = (
    globalThis as unknown as { Highlight: new (...ranges: Range[]) => unknown }
  ).Highlight;
  return new HighlightCtor(...ranges);
}

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

function collectTextSegments(root: HTMLElement): { text: string; segments: TextSegment[] } {
  const segments: TextSegment[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent && node.textContent.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    const content = node.textContent ?? "";
    if (content.length > 0) {
      const start = text.length;
      text += content;
      segments.push({ node: node as Text, start, end: start + content.length });
    }
    node = walker.nextNode();
  }
  return { text, segments };
}

function resolveSegmentPosition(
  segments: ReadonlyArray<TextSegment>,
  absoluteOffset: number,
): { node: Text; offset: number } | null {
  for (const segment of segments) {
    if (absoluteOffset < segment.end) {
      return { node: segment.node, offset: absoluteOffset - segment.start };
    }
    if (absoluteOffset === segment.end) {
      return { node: segment.node, offset: segment.node.textContent?.length ?? 0 };
    }
  }

  const lastSegment = segments.at(-1);
  if (!lastSegment) return null;
  return { node: lastSegment.node, offset: lastSegment.node.textContent?.length ?? 0 };
}

/** Collects match ranges within `root`, grouped by their owning timeline row. */
function collectRowRanges(root: HTMLElement, needle: string): Map<string, Range[]> {
  const byRow = new Map<string, Range[]>();
  if (needle.length === 0) return byRow;
  const lowerNeedle = needle.toLowerCase();

  const rowElements = root.querySelectorAll<HTMLElement>("[data-timeline-row-id]");
  for (const rowElement of rowElements) {
    const rowId = rowElement.dataset.timelineRowId;
    if (!rowId) continue;
    const ranges: Range[] = [];
    const { text, segments } = collectTextSegments(rowElement);
    const lowerText = text.toLowerCase();
    let from = 0;
    for (;;) {
      const index = lowerText.indexOf(lowerNeedle, from);
      if (index === -1) break;
      const start = resolveSegmentPosition(segments, index);
      const end = resolveSegmentPosition(segments, index + needle.length);
      if (start && end) {
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        ranges.push(range);
      }
      from = index + needle.length;
    }
    if (ranges.length > 0) byRow.set(rowId, ranges);
  }

  return byRow;
}

/** Scrolls `range` into view within `scroller` when it sits outside the viewport. */
function scrollRangeIntoView(scroller: HTMLElement, range: Range): void {
  const rangeRect = range.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const margin = 48;
  if (rangeRect.top < scrollerRect.top + margin) {
    scroller.scrollTop -= scrollerRect.top + margin - rangeRect.top;
  } else if (rangeRect.bottom > scrollerRect.bottom - margin) {
    scroller.scrollTop += rangeRect.bottom - (scrollerRect.bottom - margin);
  }
}

export function useChatSearchHighlight(options: {
  enabled: boolean;
  query: string;
  active: ActiveOccurrence | null;
  getScroller: () => HTMLElement | null;
}): void {
  const { enabled, query, active, getScroller } = options;
  const trimmedQuery = query.trim();
  const activeRowId = active?.rowId ?? null;
  const activeOrdinal = active?.ordinalInRow ?? -1;

  useEffect(() => {
    const registry = highlightRegistry();
    if (!registry) return;

    if (!enabled || trimmedQuery.length === 0) {
      registry.delete(ALL_HIGHLIGHT_NAME);
      registry.delete(ACTIVE_HIGHLIGHT_NAME);
      return;
    }

    const scroller = getScroller();
    if (!scroller) return;

    let frame = 0;
    let didScrollActiveIntoView = false;

    const paint = () => {
      const byRow = collectRowRanges(scroller, trimmedQuery);
      const allRanges: Range[] = [];
      for (const ranges of byRow.values()) allRanges.push(...ranges);

      const activeRanges = byRow.get(activeRowId ?? "");
      const activeRange =
        activeRanges && activeRanges.length > 0
          ? activeRanges[Math.min(Math.max(activeOrdinal, 0), activeRanges.length - 1)]
          : null;

      if (allRanges.length > 0) {
        registry.set(ALL_HIGHLIGHT_NAME, buildHighlight(allRanges));
      } else {
        registry.delete(ALL_HIGHLIGHT_NAME);
      }
      if (activeRange) {
        registry.set(ACTIVE_HIGHLIGHT_NAME, buildHighlight([activeRange]));
        if (!didScrollActiveIntoView) {
          didScrollActiveIntoView = true;
          scrollRangeIntoView(scroller, activeRange);
        }
      } else {
        registry.delete(ACTIVE_HIGHLIGHT_NAME);
      }
    };

    const schedulePaint = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        paint();
      });
    };

    // Initial paint plus a second pass on the next frame: scrollToIndex mounts
    // the target row asynchronously, so the active match may not exist yet.
    paint();
    schedulePaint();

    scroller.addEventListener("scroll", schedulePaint, { passive: true });
    const mutationObserver = new MutationObserver(schedulePaint);
    mutationObserver.observe(scroller, { childList: true, subtree: true, characterData: true });
    const resizeObserver = new ResizeObserver(schedulePaint);
    resizeObserver.observe(scroller);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedulePaint);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      registry.delete(ALL_HIGHLIGHT_NAME);
      registry.delete(ACTIVE_HIGHLIGHT_NAME);
    };
  }, [enabled, trimmedQuery, activeRowId, activeOrdinal, getScroller]);
}
