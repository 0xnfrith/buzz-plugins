// ---- Caret primitives in the message box [DOM] ------------------------------------------
// Positions are gaps: a caret sits between two characters, and vim's cursor is on the character
// after the gap. Every motion leaves the caret just before the character it lands on, so a
// motion that lands on a character (e, f, $) and one that lands before it (t) both read the same
// way. peek() reads the adjacent character and puts the caret back: a line break reads as "\n"
// ("\n\n" between two paragraphs), the end of the draft as "". Selection.modify's own "word"
// granularity differs by platform, so words are walked one character at a time.
export const peek = (selection: Selection, direction: "forward" | "backward") => {
  const { anchorNode, anchorOffset } = selection;
  selection.modify("extend", direction, "character");
  const adjacent = selection.toString();
  selection.collapse(anchorNode, anchorOffset);
  return adjacent;
};
export const here = (selection: Selection) => peek(selection, "forward"); // the character under the cursor
export const prev = (selection: Selection) => peek(selection, "backward"); // the character before it
export const isBreak = (c: string) => /^\n+$/.test(c);
export const forward = (selection: Selection) => selection.modify("move", "forward", "character");
export const backward = (selection: Selection) => selection.modify("move", "backward", "character");
// 0 blank (space, tab, line break), 1 a word character (letter, digit, underscore), 2 any other
// character, -1 no character at all. A WORD (W B E) treats every non-blank character alike.
const WORD_CHAR = /[\p{L}\p{N}_]/u;
export const kind = (c: string, big?: boolean) => (c === "" ? -1 : /^\s+$/.test(c) ? 0 : big || WORD_CHAR.test(c) ? 1 : 2);
// The cursor is on an empty line: nothing before it on the line and nothing under it.
export const onEmptyLine = (selection: Selection) => {
  const under = here(selection);
  const before = prev(selection);
  return (under === "" || isBreak(under)) && (before === "" || isBreak(before));
};
// A runaway guard for the loops in the motions: a draft is never this long.
export const LIMIT = 5000;
export const times = (n: number, run: (i: number) => void) => {
  for (let i = 0; i < n; i++) run(i);
};

// A caret sits in the gap between two characters; vim's cursor sits on the character after the
// gap. A gap is kept as a collapsed Range, which stays put if the editor re-renders.
export const gap = (selection: Selection) => {
  const range = document.createRange();
  range.setStart(selection.focusNode as Node, selection.focusOffset);
  return range;
};
export const goto = (selection: Selection, range: Range) => selection.collapse(range.startContainer, range.startOffset);
export const charUnder = (selection: Selection) => {
  const next = peek(selection, "forward");
  return isBreak(next) ? "" : next; // "" at the end of a line, and on an empty line
};
export const stepRight = (selection: Selection) => {
  if (charUnder(selection)) selection.modify("move", "forward", "character");
};
// Like vim, the cursor rests on a character, never past the last one of a line.
export const clampCursor = (selection: Selection) => {
  if (charUnder(selection)) return;
  const before = peek(selection, "backward");
  if (before !== "" && !isBreak(before)) selection.modify("move", "backward", "character");
};
// Where the caret is in the draft, for the keys that cross into the next stop of the column.
// On the first row: the start of the row it is on is the start of the draft (a wrapped line has
// several rows, so the first line alone is not the test).
export const onFirstRow = (selection: Selection) => {
  const origin = gap(selection);
  selection.modify("move", "backward", "lineboundary");
  const first = peek(selection, "backward") === "";
  goto(selection, origin);
  return first;
};
export const atDraftStart = (selection: Selection) => peek(selection, "backward") === "";
// The cursor rests on the last character: stepping past it reaches the end of the draft.
export const atDraftEnd = (selection: Selection) => {
  const origin = gap(selection);
  const under = here(selection);
  if (under !== "" && !isBreak(under)) forward(selection);
  const end = peek(selection, "forward") === "";
  goto(selection, origin);
  return end;
};
// Selects from `start` to `end` (collapsed Ranges), the caret at the start when `backward`.
export const select = (selection: Selection, start: Range, end: Range, backward: boolean) =>
  backward
    ? selection.setBaseAndExtent(end.startContainer, end.startOffset, start.startContainer, start.startOffset)
    : selection.setBaseAndExtent(start.startContainer, start.startOffset, end.startContainer, end.startOffset);
// The line is the text between two line breaks, however it wraps on screen.
export const lineStart = (selection: Selection) => selection.modify("move", "backward", "paragraphboundary");
export const lineEnd = (selection: Selection) => selection.modify("move", "forward", "paragraphboundary");
export const firstNonBlank = (selection: Selection) => {
  lineStart(selection);
  for (let i = 0; i < LIMIT; i++) {
    const c = here(selection);
    if (kind(c) !== 0 || isBreak(c)) return;
    forward(selection);
  }
};
