// ---- Message cursor [DOM] ---------------------------------------------------------------
// The host has no "selected message", so the cursor is an attribute the plugin puts on the row element, and a static
// stylesheet (theme.ts) that draws it. The virtual list unmounts and remounts rows, and a page that is left and entered
// again builds its list anew, so a MutationObserver puts the attribute back on a row that comes back. Each message pane
// (the channel's list and a thread's list) keeps its own cursor row: the pane that has the keys shows it strongly, the
// other shows where it was left, faintly, and an accent line under the pane's header says which pane is active whenever
// two are on screen. (The mark used to be a CSS rule keyed by message id, rewritten on every move; replacing a
// stylesheet's text makes the engine rebuild its rules and restyle the page.)
import { MESSAGE, SIDE } from "./constants";
import {
  activeTimeline,
  boxHasKeys,
  channelRows,
  clamp,
  afterLayout,
  focusEl,
  inView,
  rowsOf,
} from "./dom";
import { enterBox } from "./box";
import * as perf from "./perf";
import { state } from "./state";
import { CURSOR_ATTR, STATIC_CSS } from "./theme";

type Pane = "main" | "side";
const PANE_LIST: Pane[] = ["main", "side"];
export const cursors: Record<Pane, string | undefined> = { main: undefined, side: undefined };
export const cursorPane = (): Pane => (state.region === "side" ? "side" : "main");
// The stylesheet, and the cursors the tests read (data-message-id and friends).
export const cursorStyle = document.createElement("style");
cursorStyle.setAttribute("data-vim-cursor-style", "");
cursorStyle.textContent = STATIC_CSS;

const marked: Record<Pane, HTMLElement | undefined> = { main: undefined, side: undefined }; // the rows that carry the attribute
const paneOf = (row: Element): Pane => (row.closest(SIDE) ? "side" : "main");
const mark = (pane: Pane, row: HTMLElement | undefined) => {
  if (marked[pane] === row) return;
  marked[pane]?.removeAttribute(CURSOR_ATTR);
  row?.setAttribute(CURSOR_ATTR, pane);
  marked[pane] = row;
};
// A pane's cursor is a message id, and `row` its element.
export const setCursor = (pane: Pane, id: string, row: HTMLElement) => {
  cursors[pane] = id;
  mark(pane, row);
};
export const clearCursor = (pane: Pane) => {
  cursors[pane] = undefined;
  mark(pane, undefined);
};
// Is this element the row of the cursor of `pane`: a message row of that pane with the id, not a nested one or a membership row.
const isCursorRow = (el: Element, pane: Pane, id: string): el is HTMLElement =>
  (el as HTMLElement).dataset.messageId === id &&
  paneOf(el) === pane &&
  !el.hasAttribute("data-membership-row") &&
  !el.parentElement?.closest(MESSAGE);
// What the observer does with a batch of changes: a pane that has a cursor but no marked row on the page looks for it in what
// was just added (or whose id just changed). While every cursor row is mounted it does nothing at all.
const onMutations = (records: MutationRecord[]) => {
  for (const pane of PANE_LIST) if (marked[pane] && !marked[pane].isConnected) marked[pane] = undefined; // let a gone row go
  const lost = PANE_LIST.filter((pane) => cursors[pane] && !marked[pane]);
  if (!lost.length) return;
  for (const pane of lost) {
    const id = cursors[pane] as string;
    const selector = `[data-message-id="${CSS.escape(id)}"]`;
    const hunt = (el: Element) => {
      for (const row of el.matches(selector) ? [el] : el.querySelectorAll(selector))
        if (isCursorRow(row, pane, id)) return mark(pane, row);
    };
    for (const record of records) {
      if (marked[pane]) break;
      if (record.type === "attributes") hunt(record.target as Element);
      else for (const node of record.addedNodes) if (node.nodeType === 1) hunt(node as Element);
    }
  }
};
// The attribute on a row whose id changed in place no longer says where the cursor is.
const onIdChange = (records: MutationRecord[]) => {
  for (const record of records) {
    if (record.type !== "attributes") continue;
    for (const pane of PANE_LIST) if (record.target === marked[pane] && cursors[pane] !== (record.target as HTMLElement).dataset.messageId) mark(pane, undefined);
  }
  onMutations(records);
};
const observer = new MutationObserver(onIdChange);
// While the plugin is applied: watch the page for rows coming back.
export const watchCursors = () => observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-message-id"] });
export const unwatchCursors = () => observer.disconnect();
// Back to nothing marked: at the start of every apply, and when the plugin is taken off the page.
export const resetCursors = () => {
  for (const pane of PANE_LIST) clearCursor(pane);
};
// The cursors, for the tests to read, and whether a message box has the keys. Written only when they change.
export const paintCursor = perf.timed("paintCursor", () => {
  const publish = (name: string, value: string) => cursorStyle.dataset[name] !== value && (cursorStyle.dataset[name] = value);
  publish("messageId", cursors[cursorPane()] ?? ""); // the active pane's cursor
  publish("mainMessageId", cursors.main ?? "");
  publish("sideMessageId", cursors.side ?? "");
  document.documentElement.toggleAttribute("data-vim-box", boxHasKeys()); // a message box has the keys: the cursor row steps back
});
export const clearCursors = () => {
  clearCursor("main");
  clearCursor("side");
  paintCursor();
};
export const selectRow = (row: HTMLElement) => {
  setCursor(paneOf(row), row.dataset.messageId as string, row);
  paintCursor();
  row.scrollIntoView({ block: "nearest" });
};
export const nearestVisible = (scroller: HTMLElement, fromEnd: boolean) => {
  const rows = rowsOf(scroller).filter((row) => inView(scroller, row));
  return fromEnd ? rows.at(-1) : rows[0];
};
const atBottom = (scroller: HTMLElement) => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
export const moveCursor = perf.timed("moveCursor", (steps: number) => {
  const scroller = activeTimeline();
  if (!scroller) return;
  const rows = rowsOf(scroller);
  if (!rows.length) {
    // A pane with no messages has only its box.
    if (steps > 0) enterBox(cursorPane(), "start");
    return;
  }
  const at = rows.findIndex((row) => row.dataset.messageId === cursors[cursorPane()]);
  if (at < 0) {
    // First press only places the cursor: newest visible message going up, oldest going down.
    const row = nearestVisible(scroller, steps < 0);
    if (row) selectRow(row);
    return;
  }
  const target = clamp(at + steps, 0, rows.length - 1);
  if (target === at) {
    // Past the newest message is the pane's message box: one column, messages then box.
    if (steps > 0 && atBottom(scroller) && enterBox(cursorPane(), "start")) return;
    // End of the mounted window: scroll so the virtual list mounts more rows (and, at the
    // top, loads older history). The next press moves on.
    scroller.scrollBy({ top: Math.sign(steps) * scroller.clientHeight * 0.5 });
    return;
  }
  selectRow(rows[target]);
});
export const jumpEdge = (end: boolean) => {
  if (state.region === "sidebar") {
    const rows = channelRows();
    focusEl(end ? rows.at(-1) : rows[0]);
    return;
  }
  const scroller = activeTimeline();
  if (!scroller) return;
  scroller.scrollTop = end ? scroller.scrollHeight : 0;
  afterLayout(() => {
    const row = nearestVisible(scroller, end);
    if (row) selectRow(row);
  });
};
export const halfPage = (direction: number) => {
  const scroller = activeTimeline();
  if (!scroller) return;
  scroller.scrollBy({ top: (direction * scroller.clientHeight) / 2 });
  afterLayout(() => {
    const current = rowsOf(scroller).find((row) => row.dataset.messageId === cursors[cursorPane()]);
    if (current && inView(scroller, current)) return;
    const row = nearestVisible(scroller, direction < 0);
    if (row) selectRow(row);
  });
};
// The row the cursor is on in the pane that has the keys, if it is mounted.
export const cursorRow = () => {
  const scroller = activeTimeline();
  const id = cursors[cursorPane()];
  return scroller && id ? rowsOf(scroller).find((row) => row.dataset.messageId === id) : undefined;
};
