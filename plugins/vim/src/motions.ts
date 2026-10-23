// ---- Motions in the message box [DOM] ---------------------------------------------------
import {
  backward,
  firstNonBlank,
  forward,
  gap,
  goto,
  here,
  isBreak,
  kind,
  lineEnd,
  lineStart,
  LIMIT,
  onEmptyLine,
  prev,
  times,
} from "./caret";
import { armPending, set, state } from "./state";
import type { Motion } from "./types";

const wordForward = (selection: Selection, big: boolean, operator: boolean | string | undefined) => {
  const first = kind(here(selection), big);
  // Leave the word the cursor is in...
  if (first > 0) for (let i = 0; i < LIMIT && kind(here(selection), big) === first; i++) forward(selection);
  const endOfWord = gap(selection);
  // ...then cross blanks and line breaks to the next word; an empty line counts as a word.
  let crossed = false;
  for (let i = 0; i < LIMIT && kind(here(selection), big) === 0; i++) {
    crossed ||= isBreak(here(selection));
    forward(selection);
    if (onEmptyLine(selection)) break;
  }
  // vim: with an operator, the last word on a line ends the text, not the first word of the next line.
  if (operator && crossed && first > 0) goto(selection, endOfWord);
};
const wordBackward = (selection: Selection, big: boolean) => {
  if (!prev(selection)) return;
  backward(selection);
  for (let i = 0; i < LIMIT && kind(here(selection), big) === 0; i++) {
    if (onEmptyLine(selection) || !prev(selection)) return;
    backward(selection);
  }
  const k = kind(here(selection), big);
  for (let i = 0; i < LIMIT && kind(prev(selection), big) === k; i++) backward(selection);
};
const wordEnd = (selection: Selection, big: boolean) => {
  if (!here(selection)) return;
  forward(selection); // `e` always moves: from the end of a word it goes to the end of the next
  for (let i = 0; i < LIMIT && kind(here(selection), big) === 0; i++) forward(selection);
  const k = kind(here(selection), big);
  if (k > 0) for (let i = 0; i < LIMIT && kind(here(selection), big) === k; i++) forward(selection);
  backward(selection); // onto the last character of the word
};
const wordEndBackward = (selection: Selection, big: boolean) => {
  const first = kind(here(selection), big);
  if (!prev(selection)) return;
  backward(selection);
  if (first > 0)
    for (let i = 0; i < LIMIT && kind(here(selection), big) === first; i++) {
      if (!prev(selection)) return;
      backward(selection);
    }
  for (let i = 0; i < LIMIT && kind(here(selection), big) === 0; i++) {
    if (onEmptyLine(selection) || !prev(selection)) return;
    backward(selection);
  }
};

// Line n (1 is the first; Infinity is the last), on its first non-blank character.
const gotoLine = (selection: Selection, n: number) => {
  if (n === Infinity) selection.modify("move", "forward", "documentboundary");
  else {
    selection.modify("move", "backward", "documentboundary");
    for (let i = 1; i < n; i++) {
      lineEnd(selection);
      if (!here(selection)) break; // no more lines
      forward(selection);
    }
  }
  firstNonBlank(selection);
};

// f F t T: the character on this line only. Returns false (and does not move) if it is not there
// as many times as asked. `again` is ; or ,: a repeated t or T that is already next to its
// character goes on to the next one instead of staying put.
let lastFind: { key: string; ch: string } | undefined; // for ; and ,
export const resetMotions = () => {
  lastFind = undefined;
};
const OPPOSITE: Record<string, string> = { f: "F", F: "f", t: "T", T: "t" };
const findChar = (selection: Selection, key: string, ch: string, count: number, again: boolean) => {
  const backwards = key === "F" || key === "T";
  const till = key === "t" || key === "T";
  // One character along the line, staying on it.
  const hop = () => {
    if (backwards) {
      const before = prev(selection);
      if (before === "" || isBreak(before)) return false;
      backward(selection);
      return true;
    }
    const under = here(selection);
    if (under === "" || isBreak(under)) return false;
    forward(selection);
    const next = here(selection);
    if (next === "" || isBreak(next)) {
      backward(selection);
      return false;
    }
    return true;
  };
  const origin = gap(selection);
  if (again && till) {
    const at = gap(selection);
    const adjacent = hop() && here(selection) === ch;
    goto(selection, at);
    if (adjacent) hop();
  }
  for (let i = 0; i < count; i++) {
    let found = false;
    while (hop()) {
      if (here(selection) === ch) {
        found = true;
        break;
      }
    }
    if (!found) {
      goto(selection, origin);
      return false;
    }
  }
  if (till) (backwards ? forward : backward)(selection);
  return true;
};
const finder = (key: string, ch: string, again: boolean): Motion => ({
  run: (selection, n) => void findChar(selection, key, ch, n, again),
  inclusive: key === "f" || key === "t",
});

const MOTIONS: Record<string, Motion> = {
  h: { run: (s, n) => times(n, () => backward(s)) },
  l: { run: (s, n) => times(n, () => forward(s)) },
  j: { run: (s, n) => times(n, () => s.modify("move", "forward", "line")) },
  k: { run: (s, n) => times(n, () => s.modify("move", "backward", "line")) },
  w: { run: (s, n, _typed, operator) => times(n, (i) => wordForward(s, false, operator && i === n - 1)) },
  W: { run: (s, n, _typed, operator) => times(n, (i) => wordForward(s, true, operator && i === n - 1)) },
  b: { run: (s, n) => times(n, () => wordBackward(s, false)) },
  B: { run: (s, n) => times(n, () => wordBackward(s, true)) },
  e: { run: (s, n) => times(n, () => wordEnd(s, false)), inclusive: true },
  E: { run: (s, n) => times(n, () => wordEnd(s, true)), inclusive: true },
  ge: { run: (s, n) => times(n, () => wordEndBackward(s, false)), inclusive: true },
  gE: { run: (s, n) => times(n, () => wordEndBackward(s, true)), inclusive: true },
  0: { run: (s) => lineStart(s) },
  "^": { run: (s) => firstNonBlank(s) },
  $: {
    run: (s, n) => {
      times(n - 1, () => {
        lineEnd(s);
        forward(s);
      });
      lineEnd(s);
    },
    inclusive: true,
  },
  gg: { run: (s, _n, typed) => gotoLine(s, typed || 1), lines: true },
  G: { run: (s, _n, typed) => gotoLine(s, typed || Infinity), lines: true },
};
const FIND_KEYS = ["f", "F", "t", "T"];
export const PENDING = Symbol("pending");
// Turns the key just typed into a motion. Returns undefined if it starts none, PENDING if it
// needs another key (g, or the character after f t F T), else { run, inclusive, lines }.
export const resolveMotion = (key: string): Motion | typeof PENDING | undefined => {
  const prefix = state.prefix;
  if (prefix) {
    set({ prefix: "" });
    if (prefix === "g") return ({ g: MOTIONS.gg, e: MOTIONS.ge, E: MOTIONS.gE } as Record<string, Motion>)[key];
    lastFind = { key: prefix, ch: key };
    return finder(prefix, key, false);
  }
  if (key === "g" || FIND_KEYS.includes(key)) {
    set({ prefix: key });
    armPending();
    return PENDING;
  }
  if ((key === ";" || key === ",") && lastFind)
    return finder(key === ";" ? lastFind.key : OPPOSITE[lastFind.key], lastFind.ch, true);
  return MOTIONS[key];
};
