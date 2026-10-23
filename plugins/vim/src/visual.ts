// ---- Visual mode in the message box [DOM] -----------------------------------------------
// A caret sits in the gap between two characters; vim's cursor sits on the character after the
// gap. The mode keeps its two ends as collapsed Ranges (anchor, cursor): each Range stays put
// if the editor re-renders, and a motion starts from the cursor's gap, not from the highlight.
// The highlight is derived after every key. A characterwise highlight includes the character
// under both ends, so when it grows rightwards it stops one character past the cursor, and when
// it grows leftwards it starts one character past the anchor. A linewise highlight runs from the
// start of the first line to the end of the last. A line is the text between two newlines.
import { clampCursor, gap, goto, peek, select, stepRight } from "./caret";
import { isEditable } from "./dom";
import { enterInsert } from "./box";
import { PENDING, resolveMotion } from "./motions";
import { clearPending, set, state, takeCount } from "./state";
import type { Motion, VisualKind } from "./types";

let visualAnchor: Range | undefined;
let visualCursor: Range | undefined;
let visualSpan: { start: Range; end: Range } | undefined; // what the highlight covers, start first
export const resetVisual = () => {
  visualAnchor = visualCursor = visualSpan = undefined;
};

const paintVisual = () => {
  const selection = document.getSelection() as Selection;
  const anchor = visualAnchor as Range;
  const cursor = visualCursor as Range;
  const backward = anchor.compareBoundaryPoints(Range.START_TO_START, cursor) > 0;
  const [first, last] = backward ? [cursor, anchor] : [anchor, cursor];
  let start = first;
  let end = last;
  if (state.visual === "line") {
    goto(selection, first);
    selection.modify("move", "backward", "paragraphboundary");
    start = gap(selection);
    goto(selection, last);
    selection.modify("move", "forward", "paragraphboundary");
    end = gap(selection);
  } else {
    goto(selection, last);
    stepRight(selection);
    end = gap(selection);
  }
  visualSpan = { start, end };
  select(selection, start, end, backward);
};
export const startVisual = (kind: VisualKind) => {
  const selection = document.getSelection() as Selection;
  selection.collapse(selection.focusNode, selection.focusOffset);
  clampCursor(selection);
  visualAnchor = gap(selection);
  visualCursor = gap(selection);
  set({ visual: kind });
  paintVisual();
};
// Back to text normal mode with the caret on the cursor (Esc), or on a given gap.
export const leaveVisual = (at?: Range) => {
  if (isEditable(document.activeElement) && visualCursor) {
    const selection = document.getSelection() as Selection;
    goto(selection, at ?? visualCursor);
    clampCursor(selection);
  }
  set({ visual: "" });
};
const visualMove = (motion: Motion, n: number, typed: number) => {
  const selection = document.getSelection() as Selection;
  goto(selection, visualCursor as Range);
  motion.run(selection, n, typed);
  clampCursor(selection);
  visualCursor = gap(selection);
  paintVisual();
};
// The editor serializes its own idea of the selection on a copy, which can lag a keystroke behind
// the highlight, so the highlight's text goes to the clipboard through a copy listener of ours.
// A webview that refuses execCommand("copy") gets the async clipboard instead.
const copy = (text: string) => {
  if (!text) return;
  const put = (event: ClipboardEvent) => {
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
    event.stopPropagation();
  };
  let copied = false;
  document.addEventListener("copy", put, true);
  try {
    copied = document.execCommand("copy");
  } finally {
    document.removeEventListener("copy", put, true);
  }
  if (!copied) navigator.clipboard?.writeText(text).catch(() => {});
};
const visualAct = (key: string) => {
  const selection = document.getSelection() as Selection;
  let { start, end } = visualSpan as { start: Range; end: Range };
  if (key === "y") {
    copy(selection.toString());
    return leaveVisual(start);
  }
  if (state.visual === "line" && key !== "c") {
    // d and x take the lines whole: with the newline after them, or before them for the last lines.
    goto(selection, end);
    if (peek(selection, "forward") === "\n") {
      selection.modify("move", "forward", "character");
      end = gap(selection);
    } else {
      goto(selection, start);
      if (peek(selection, "backward") === "\n") {
        selection.modify("move", "backward", "character");
        start = gap(selection);
      }
    }
  }
  select(selection, start, end, false);
  if (!selection.isCollapsed) document.execCommand("delete");
  if (key === "c") {
    set({ visual: "" });
    return enterInsert();
  }
  leaveVisual(gap(selection));
};
export const visualKey = (key: string) => {
  const typed = state.count;
  const motion = resolveMotion(key);
  if (motion === PENDING) return;
  if (motion) return visualMove(motion, takeCount(), typed);
  clearPending();
  switch (key) {
    case "v":
      return state.visual === "char" ? leaveVisual() : (set({ visual: "char" }), paintVisual());
    case "V":
      return state.visual === "line" ? leaveVisual() : (set({ visual: "line" }), paintVisual());
    case "y":
    case "d":
    case "x":
    case "c":
      return visualAct(key);
  }
};
