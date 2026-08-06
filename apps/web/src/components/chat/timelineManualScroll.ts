/**
 * Detection helpers for "the user took over scrolling" in the chat timeline.
 *
 * Live-follow (auto scrolling to the newest output) must stop the moment the
 * user navigates away from the live edge, no matter which input path they used.
 * Pointer/wheel/touch listeners cover most gestures, but keyboard paging and
 * any gesture the listeners miss (list remounted after the listeners attached,
 * scrollbar interactions synthesized without pointer events) still have to be
 * caught, so scroll offsets are sampled as a backstop.
 */

/** Keys that scroll a scroll container natively. */
const TIMELINE_SCROLL_KEYS: ReadonlySet<string> = new Set([
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "ArrowUp",
  "ArrowDown",
  " ",
  "Spacebar",
]);

export interface TimelineScrollKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly isEditableTarget: boolean;
  /** Space activates a focused control instead of scrolling. */
  readonly isActivatableTarget: boolean;
}

/** True when a keydown inside the timeline would scroll it. */
export function isTimelineScrollKey(event: TimelineScrollKeyEvent): boolean {
  if (event.isEditableTarget || event.altKey || event.metaKey || event.ctrlKey) {
    return false;
  }
  if (!TIMELINE_SCROLL_KEYS.has(event.key)) {
    return false;
  }
  const isSpace = event.key === " " || event.key === "Spacebar";
  return !(isSpace && event.isActivatableTarget);
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function isActivatableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.closest("button, a, [role='button'], summary") !== null;
}

export interface TimelineScrollSample {
  readonly offset: number;
  readonly contentLength: number;
  readonly scrollLength: number;
}

/**
 * Upward movement smaller than this is treated as layout noise (sub-pixel
 * rounding, measurement corrections) rather than a deliberate scroll.
 */
export const TIMELINE_UPWARD_SCROLL_EPSILON = 8;

/**
 * True when the offset moved up in a way only a user gesture explains.
 *
 * Content shrinking (a collapsed tool block, a streaming row replaced by a
 * shorter final row) and viewport resizes clamp the offset upward on their own,
 * so those samples are ignored instead of being read as user navigation.
 */
export function isUserUpwardScroll(
  previous: TimelineScrollSample | null,
  next: TimelineScrollSample,
): boolean {
  if (!previous) {
    return false;
  }
  if (next.contentLength < previous.contentLength) {
    return false;
  }
  if (next.scrollLength !== previous.scrollLength) {
    return false;
  }
  return previous.offset - next.offset > TIMELINE_UPWARD_SCROLL_EPSILON;
}
