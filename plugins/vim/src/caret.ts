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
  const adjacent = selection.toString() || (chipCrossed(selection) ? CHIP : "");
  selection.collapse(anchorNode, anchorOffset);
  return adjacent;
};
// A mention chip is one unit of the draft that has no text for a selection to report: stepping over it selects it and
// toString() is "". It reads as one character, the object replacement character, so a motion crosses it and the draft
// does not seem to end (or start) at it.
export const CHIP = "\uFFFC";
const chipCrossed = (selection: Selection) => {
  if (selection.isCollapsed || !selection.anchorNode) return false;
  const node = selection.anchorNode;
  const box = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('[contenteditable="true"]');
  return !!box && [...box.querySelectorAll('[contenteditable="false"]')].some((island) => selection.containsNode(island, true));
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
  if (!charUnder(selection)) {
    const before = peek(selection, "backward");
    if (before !== "" && !isBreak(before)) selection.modify("move", "backward", "character");
  }
  keepOutOfIslands(selection);
};

// ---- Mention chips and other non-editable islands ---------------------------------------
// A mention chip is an element with contenteditable="false": the editor treats it as one unit and a caret may only sit
// beside it. A caret inside one (the text of its label, which a walk over the draft's text nodes reaches) is not drawn
// and nothing can be typed there, and a Mac's WKWebView does not recover from it the way Chromium does.
// The outermost non-editable element around `node`, below the editable box.
export const islandOf = (node: Node | null): Element | undefined => {
  let found: Element | undefined;
  for (let el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement); el; el = el.parentElement) {
    if (el.getAttribute("contenteditable") === "true") break;
    if (el.getAttribute("contenteditable") === "false") found = el;
  }
  return found;
};
// The gap just before an island, or just after it.
export const besideIsland = (island: Element, after: boolean): [Node, number] => {
  const parent = island.parentNode as Node;
  return [parent, [...parent.childNodes].indexOf(island as ChildNode) + (after ? 1 : 0)];
};
// A caret that sits inside an island goes to the gap beside it (before it, unless `after`).
export const keepOutOfIslands = (selection: Selection, after = false) => {
  if (!selection.isCollapsed || !selection.anchorNode) return;
  const island = islandOf(selection.anchorNode);
  if (island) selection.collapse(...besideIsland(island, after));
};
// The first or the last position of a draft that a caret may take: in its first or last text, or beside the chip
// when that is what the draft starts or ends with.
export const draftEdge = (box: HTMLElement, at: "start" | "end"): [Node, number] | undefined => {
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  let text = walker.nextNode() as Text | null;
  if (at === "end") for (let next = text; next; next = walker.nextNode() as Text | null) text = next;
  if (!text) return undefined;
  const island = islandOf(text);
  return island ? besideIsland(island, at === "end") : [text, at === "end" ? text.length : 0];
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
export const lineStart = (selection: Selection) => {
  selection.modify("move", "backward", "paragraphboundary");
  // Chromium puts the caret after a chip that starts the line, as the first place it can draw one; the start is before it.
  for (let i = 0; i < LIMIT && peek(selection, "backward") === CHIP; i++) backward(selection);
};
export const lineEnd = (selection: Selection) => selection.modify("move", "forward", "paragraphboundary");
export const firstNonBlank = (selection: Selection) => {
  lineStart(selection);
  for (let i = 0; i < LIMIT; i++) {
    const c = here(selection);
    if (kind(c) !== 0 || isBreak(c)) return;
    forward(selection);
  }
};

// ---- Runs of mentions at the edges of a draft -------------------------------------------
// A draft that starts with mentions (a reply to people: "@a @b @c text") has a leading run of chips and the spaces between
// them. Stepping left through the run one chip at a time to reach the start is a dead stop before the real way out,
// so h from just right of the run, or from anywhere inside it, leaves the box as h at the start does (see `normal.ts`).
// The mirror, a run of mentions that ends the draft, is skipped the same way by l.
type Item = "chip" | "space" | "text" | "break";
const BLANK = /^[\s\u00a0]*$/;
const BLOCK = /^(P|DIV|LI|UL|OL|BLOCKQUOTE|PRE|H[1-6])$/;
// What a piece of the draft holds, in order: chips (one item each), blank or other text, line and paragraph breaks.
const itemsIn = (fragment: Node): Item[] => {
  const out: Item[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node.textContent ?? "";
      if (text) out.push(BLANK.test(text) ? "space" : "text");
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.getAttribute("contenteditable") === "false") return void out.push("chip");
    if (el.tagName === "BR") return void (el.classList.contains("ProseMirror-trailingBreak") || out.push("break")); // the editor's own filler is not a break
    el.childNodes.forEach(visit);
  };
  // A fragment cut from a range holds a clone of the paragraph the range ends in, so a paragraph's own end says nothing:
  // the breaks are the boundaries between the paragraphs it holds.
  let blocks = 0;
  fragment.childNodes.forEach((node) => {
    if (node.nodeType === 1 && BLOCK.test((node as Element).tagName) && blocks++) out.push("break");
    visit(node);
  });
  return out;
};
// What lies before and after the caret, from the start and to the end of the box.
const aroundCaret = (selection: Selection) => {
  const node = selection.focusNode;
  if (!selection.isCollapsed || !node) return undefined;
  const box = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('[contenteditable="true"]');
  if (!box) return undefined;
  const before = document.createRange();
  before.setStart(box, 0);
  before.setEnd(node, selection.focusOffset);
  const after = document.createRange();
  after.setStart(node, selection.focusOffset);
  after.setEnd(box, box.childNodes.length);
  return { before: itemsIn(before.cloneContents()), after: itemsIn(after.cloneContents()) };
};
// The character before the caret is part of a leading run of mentions: a chip, or a space between two chips. Nothing but
// chips and spaces comes before the caret, and either the chip is what is just before it or another chip comes after.
export const insideLeadingRun = (selection: Selection) => {
  const around = aroundCaret(selection);
  if (!around) return false;
  const { before, after } = around;
  if (!before.includes("chip") || before.some((item) => item !== "chip" && item !== "space")) return false;
  return before.at(-1) === "chip" || after.find((item) => item !== "space") === "chip";
};
// The character after the one under the cursor is part of a trailing run of mentions (the step `l` would take lands in it).
export const stepsIntoTrailingRun = (selection: Selection) => {
  if (!charUnder(selection)) return false;
  const origin = gap(selection);
  forward(selection);
  const around = aroundCaret(selection);
  goto(selection, origin);
  if (!around) return false;
  const { before, after } = around;
  if (!after.includes("chip") || after.some((item) => item !== "chip" && item !== "space")) return false;
  return after[0] === "chip" || before.findLast((item) => item !== "space") === "chip";
};
