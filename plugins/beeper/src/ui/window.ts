// The chat list draws only the rows in view, so a key costs the same with 12 chats or 2,000. Rows
// have one fixed height, which makes the arithmetic simple and keeps it out of the DOM.

export const ROW_HEIGHT = 56;
/** Space above the first row and below the last. */
export const PAD = 4;
/** Rows drawn beyond each edge of the view, so a scroll does not show a blank for a frame. */
export const OVERSCAN = 6;

export function contentHeight(total: number): number {
  return total * ROW_HEIGHT + PAD * 2;
}

export function rowTop(index: number): number {
  return PAD + index * ROW_HEIGHT;
}

/** The rows to draw, as `[start, end)`. */
export function visibleRange(scrollTop: number, viewHeight: number, total: number): [number, number] {
  const first = Math.floor((scrollTop - PAD) / ROW_HEIGHT) - OVERSCAN;
  const last = Math.ceil((scrollTop + viewHeight - PAD) / ROW_HEIGHT) + OVERSCAN;
  return [Math.min(Math.max(first, 0), total), Math.min(Math.max(last, 0), total)];
}

/** The scroll position that brings row `index` fully into view with the least movement. */
export function scrollToReveal(index: number, scrollTop: number, viewHeight: number): number {
  const top = rowTop(index);
  const bottom = top + ROW_HEIGHT;
  if (top - PAD < scrollTop) return Math.max(0, top - PAD);
  if (bottom + PAD > scrollTop + viewHeight) return bottom + PAD - viewHeight;
  return scrollTop;
}
