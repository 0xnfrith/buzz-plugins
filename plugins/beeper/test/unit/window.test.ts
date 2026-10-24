import { describe, expect, it } from "vitest";
import { OVERSCAN, PAD, ROW_HEIGHT, contentHeight, rowTop, scrollToReveal, visibleRange } from "../../src/ui/window";

describe("visibleRange", () => {
  it("draws the rows in view and a few beyond", () => {
    const [start, end] = visibleRange(0, 560, 200);
    expect(start).toBe(0);
    expect(end).toBe(Math.ceil((560 - PAD) / ROW_HEIGHT) + OVERSCAN);
    const [s2, e2] = visibleRange(100 * ROW_HEIGHT, 560, 200);
    expect(s2).toBe(Math.floor((100 * ROW_HEIGHT - PAD) / ROW_HEIGHT) - OVERSCAN);
    expect(e2 - s2).toBeLessThan(30);
  });
  it("stays inside the list", () => {
    expect(visibleRange(0, 560, 3)).toEqual([0, 3]);
    expect(visibleRange(0, 560, 0)).toEqual([0, 0]);
    const [start, end] = visibleRange(10_000_000, 560, 200);
    expect(start).toBe(200);
    expect(end).toBe(200);
    expect(visibleRange(-50, 560, 200)[0]).toBe(0);
  });
  it("draws every row that is at least partly in view", () => {
    for (const top of [0, 1, 55, 56, 57, 1234, 5000]) {
      const [start, end] = visibleRange(top, 600, 200);
      for (let i = 0; i < 200; i += 1) {
        const visible = rowTop(i) < top + 600 && rowTop(i) + ROW_HEIGHT > top;
        if (visible) expect(i >= start && i < end, `row ${i} at scroll ${top}`).toBe(true);
      }
    }
  });
});

describe("scrollToReveal", () => {
  it("does not move when the row is in view", () => {
    expect(scrollToReveal(3, 0, 560)).toBe(0);
    expect(scrollToReveal(10, 400, 560)).toBe(400);
  });
  it("moves the least that shows the row", () => {
    expect(scrollToReveal(0, 500, 560)).toBe(0);
    const down = scrollToReveal(40, 0, 560);
    expect(rowTop(40) + ROW_HEIGHT + PAD).toBe(down + 560);
    const up = scrollToReveal(5, 1000, 560);
    expect(up).toBe(rowTop(5) - PAD);
  });
  it("never goes below zero", () => {
    expect(scrollToReveal(0, 0, 560)).toBe(0);
    expect(scrollToReveal(1, 3, 560)).toBeGreaterThanOrEqual(0);
  });
});

describe("contentHeight", () => {
  it("is the rows and the padding", () => {
    expect(contentHeight(0)).toBe(PAD * 2);
    expect(contentHeight(10)).toBe(10 * ROW_HEIGHT + PAD * 2);
  });
});
