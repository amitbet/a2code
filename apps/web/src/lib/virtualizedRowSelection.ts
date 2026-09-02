import { useEffect, useRef, useState } from "react";

/**
 * Marks a virtualized row with the list key it currently renders, so a live
 * text selection can name the rows it depends on.
 */
export const VIRTUAL_ROW_KEY_ATTRIBUTE = "data-virtual-row-key";

/** Spread onto the outermost element a virtualized list renders for one item. */
export function virtualRowKeyProps(key: string) {
  return { [VIRTUAL_ROW_KEY_ATTRIBUTE]: key };
}

const NO_KEYS: readonly string[] = [];

/**
 * Row keys the selection currently spans, in DOM order. Nested lists each mark
 * their own rows, so an inner row contributes its key alongside the outer row
 * containing it; a list ignores keys that are not in its own data.
 */
export function readSelectionRowKeys(
  viewport: HTMLElement,
  selection: Selection | null,
): readonly string[] {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return NO_KEYS;
  const ranges: Range[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    ranges.push(selection.getRangeAt(index));
  }
  const keys: string[] = [];
  for (const row of viewport.querySelectorAll<HTMLElement>(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}]`)) {
    const key = row.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE);
    if (key === null || key === "") continue;
    const spanned = ranges.some((range) => {
      try {
        return range.intersectsNode(row);
      } catch {
        // A range can outlive the nodes it was captured from.
        return false;
      }
    });
    if (spanned) keys.push(key);
  }
  return keys.length === 0 ? NO_KEYS : keys;
}

function sameKeys(previous: readonly string[], next: readonly string[]) {
  return previous.length === next.length && previous.every((key, index) => key === next[index]);
}

/**
 * Keys to pass to a virtualized list's `alwaysRender` while the user has text
 * selected inside `viewport`.
 *
 * Row containers are pooled: recycling one that holds a selection endpoint
 * destroys the nodes the native selection points at, so the browser reseats
 * the endpoint on the container itself. Because pooled containers sit in
 * allocation order rather than visual order, the selection then paints across
 * unrelated rows above before collapsing entirely. Pinning the spanned rows
 * holds their containers until the selection is gone.
 */
export function useSelectionPinnedRowKeys(viewport: HTMLElement | null): readonly string[] {
  const [keys, setKeys] = useState<readonly string[]>(NO_KEYS);
  const keysRef = useRef(keys);

  useEffect(() => {
    if (!viewport) return;
    const document = viewport.ownerDocument;
    const apply = (next: readonly string[]) => {
      if (sameKeys(keysRef.current, next)) return;
      keysRef.current = next;
      setKeys(next);
    };
    // Read synchronously: a data change between the selection and its pin can
    // already have recycled the row the user just selected.
    const read = () => apply(readSelectionRowKeys(viewport, document.getSelection()));
    read();
    document.addEventListener("selectionchange", read);
    return () => {
      document.removeEventListener("selectionchange", read);
      apply(NO_KEYS);
    };
  }, [viewport]);

  return keys;
}
