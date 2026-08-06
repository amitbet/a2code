import { describe, expect, it } from "vite-plus/test";
import { isTimelineScrollKey, isUserUpwardScroll } from "./timelineManualScroll";

const keyEvent = (overrides: Partial<Parameters<typeof isTimelineScrollKey>[0]> = {}) => ({
  key: "PageUp",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isEditableTarget: false,
  isActivatableTarget: false,
  ...overrides,
});

describe("isTimelineScrollKey", () => {
  it("accepts paging and arrow keys", () => {
    for (const key of ["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"]) {
      expect(isTimelineScrollKey(keyEvent({ key }))).toBe(true);
    }
  });

  it("ignores keys typed into editable targets", () => {
    expect(isTimelineScrollKey(keyEvent({ key: "ArrowUp", isEditableTarget: true }))).toBe(false);
  });

  it("ignores modified keys and non-scrolling keys", () => {
    expect(isTimelineScrollKey(keyEvent({ key: "ArrowUp", metaKey: true }))).toBe(false);
    expect(isTimelineScrollKey(keyEvent({ key: "a" }))).toBe(false);
  });

  it("treats space on a focused control as activation, not scrolling", () => {
    expect(isTimelineScrollKey(keyEvent({ key: " " }))).toBe(true);
    expect(isTimelineScrollKey(keyEvent({ key: " ", isActivatableTarget: true }))).toBe(false);
  });
});

describe("isUserUpwardScroll", () => {
  const base = { offset: 1000, contentLength: 5000, scrollLength: 800 };

  it("has nothing to compare on the first sample", () => {
    expect(isUserUpwardScroll(null, base)).toBe(false);
  });

  it("detects a meaningful upward move", () => {
    expect(isUserUpwardScroll(base, { ...base, offset: 900 })).toBe(true);
  });

  it("ignores sub-threshold jitter and downward movement", () => {
    expect(isUserUpwardScroll(base, { ...base, offset: 996 })).toBe(false);
    expect(isUserUpwardScroll(base, { ...base, offset: 1200 })).toBe(false);
  });

  it("ignores offsets clamped by shrinking content", () => {
    expect(isUserUpwardScroll(base, { ...base, offset: 500, contentLength: 4000 })).toBe(false);
  });

  it("ignores offsets shifted by a viewport resize", () => {
    expect(isUserUpwardScroll(base, { ...base, offset: 500, scrollLength: 600 })).toBe(false);
  });
});
