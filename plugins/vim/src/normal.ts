// ---- Normal mode inside the message box [DOM] (on by default; a page switch turns it off) -----
// The shortcut service cannot do this: it runs after the editor (bubbling phase) and never
// sees keys the editor consumes, and a plugin has no caret or text commands. So this is a
// capture-phase listener that swallows plain keys while the composer is in text-normal mode
// and moves the caret with Selection.modify.
import { apple } from "./constants";
import { boxStep, boxUp, enterInsert } from "./box";
import {
  atDraftEnd,
  atDraftStart,
  clampCursor,
  firstNonBlank,
  forward,
  gap,
  goto,
  here,
  isBreak,
  lineEnd,
  onFirstRow,
  select,
  stepRight,
} from "./caret";
import { inComposer, isEditable } from "./dom";
import { isHelpOpen, markHelpOpenedBy, openHelp } from "./help";
import { PENDING, resolveMotion } from "./motions";
import { lineScroll } from "./scroll";
import { goPage, PAGE_KEYS } from "./pages";
import * as perf from "./perf";
import { armPending, clearPending, set, state, takeCount } from "./state";
import { startVisual, visualKey } from "./visual";

const textKey = perf.timed("textKey", (key: string) => {
  const selection = document.getSelection() as Selection;
  // A digit after f, t, F, T is the character to find, not a count.
  if (!state.prefix && /^[0-9]$/.test(key) && (key !== "0" || state.count > 0)) {
    set({ count: Math.min(state.count * 10 + Number(key), 999) });
    return armPending();
  }
  if (state.visual) return visualKey(key);
  // g then a page letter is the page key of the lists, not gg, ge or gE: the box is part of the one NORMAL mode.
  if (state.prefix === "g" && !state.operator && PAGE_KEYS.includes(key)) return goPage(key);
  const operator = state.operator; // takeCount() clears it
  const typed = state.count;
  const motion = resolveMotion(key); // may be only the first key of one (g, f, t ...)
  if (motion === PENDING) return;
  const n = takeCount();
  if (operator === "d") {
    // d{motion}: remember the caret, run the motion, select what it crossed, delete it. A motion
    // that lands on a character (e, f, $ ...) takes that character too.
    if (key === "d") {
      selection.modify("move", "backward", "paragraphboundary");
      selection.modify("extend", "forward", "paragraphboundary");
    } else if (motion && !motion.lines) {
      const origin = gap(selection);
      motion.run(selection, n, typed, true);
      const landed = gap(selection);
      const backwards = origin.compareBoundaryPoints(Range.START_TO_START, landed) > 0;
      const [start, end] = backwards ? [landed, origin] : [origin, landed];
      let stop = end;
      if (motion.inclusive) {
        goto(selection, end);
        const c = here(selection);
        if (c !== "" && !isBreak(c)) {
          forward(selection);
          stop = gap(selection);
        }
      }
      select(selection, start, stop, false);
    } else return;
    if (!selection.isCollapsed) document.execCommand("delete");
    return;
  }
  if (motion) {
    // k on the first row goes up into the newest message; h at the very start and l at the very end of the
    // draft (a key that could not move anyway) go one pane left or right, as in the lists.
    if (key === "k" && onFirstRow(selection)) return boxUp(state.region === "side" ? "side" : "main");
    if ((key === "h" && atDraftStart(selection)) || (key === "l" && atDraftEnd(selection))) return boxStep(key === "l" ? 1 : -1);
    motion.run(selection, n, typed);
    clampCursor(selection); // the cursor rests on a character, as in vim
    return;
  }
  switch (key) {
    case "v":
    case "V":
      return startVisual(key === "v" ? "char" : "line");
    case "i":
      return enterInsert();
    case "a":
      stepRight(selection);
      return enterInsert();
    case "A":
      lineEnd(selection);
      return enterInsert();
    case "I":
      firstNonBlank(selection);
      return enterInsert();
    case "x":
      for (let i = 0; i < n; i++) {
        const c = here(selection);
        if (c === "" || isBreak(c)) return; // nothing under the cursor: x never eats a line break
        selection.modify("extend", "forward", "character");
        if (!selection.isCollapsed) document.execCommand("delete");
      }
      return;
    case "d":
      set({ operator: "d" });
      return armPending();
    case "?":
      return openHelp();
    case "u": {
      // The editor owns undo history, so ask it the way a user would: with its own chord.
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          metaKey: apple,
          ctrlKey: !apple,
          bubbles: true,
          cancelable: true,
        }),
      );
      // The editor leaves the text it restored selected, so the next x or V would act on all of
      // it. vim leaves the cursor at the start of the change: do the same. The editor has
      // already put its selection on the page by the time the dispatch returns.
      if (!selection.isCollapsed) {
        selection.collapseToStart();
        clampCursor(selection);
      }
      return;
    }
  }
});
export const onTextKey = (event: KeyboardEvent) => {
  const target = event.target as Element | null;
  if (!state.enabled || !state.composerNormal || state.textMode !== "normal") return;
  if (!inComposer(target) || !isEditable(target)) return;
  if (event.isComposing || event.keyCode === 229) return;
  // Ctrl-e and Ctrl-y scroll the pane's messages a line, the draft untouched (in INSERT they are left alone: on a Mac
  // Ctrl-e is the editor's end-of-line there, and this listener does not run in INSERT).
  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.key === "e" || event.key === "y")) {
    event.preventDefault();
    event.stopPropagation();
    return lineScroll(event.key === "e" ? 1 : -1);
  }
  // Other chords, Escape (handled by the shortcut below), Tab and arrows stay native.
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "Escape" || event.key === "Tab") return;
  if (event.key.length > 1 && !["Enter", "Backspace", "Delete"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const helpWas = isHelpOpen();
  textKey(event.key === "Backspace" ? "h" : event.key === "Delete" ? "x" : event.key);
  // onHelpKey is the next listener on this node and gets this same event: it must not take the ?
  // that opened the dialog for the ? that closes it.
  if (isHelpOpen() && !helpWas) markHelpOpenedBy(event);
};
