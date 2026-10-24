// ---- Scrolling the view a line at a time: Ctrl-e and Ctrl-y [DOM] ------------------------
// As in vim: Ctrl-e moves the view down a line (what is below comes up), Ctrl-y up a line; a count scrolls that many
// lines. The cursor stays where it is, unless it would leave the view, and then it goes to the nearest row that is
// still in it. The plugin API has no scroll service, so this scrolls the element that holds the content of the pane
// that has the keys: the channel list, a message list (the pane's too while its message box has the keys in NORMAL),
// or, on a page with no message list (Reminders, Agents, Workflows, Inbox ...), the page's own scrolling area.
import { SCROLLER } from "./constants";
import { keepCursorInView } from "./cursor";
import { afterLayout, boxHasKeys, channelRows, regionOf, timelineOf, visible } from "./dom";
import { state, takeCount } from "./state";

// One line of text in this element: its own line height, or one and a half times its font size when that is "normal".
export const lineHeight = (el: Element) => {
  const style = getComputedStyle(el);
  const lh = parseFloat(style.lineHeight);
  return Math.max(1, Math.round(Number.isFinite(lh) ? lh : (parseFloat(style.fontSize) || 16) * 1.5));
};
const scrollsY = (el: Element) => /auto|scroll/.test(getComputedStyle(el).overflowY);
// Can this element move its content one way: it scrolls, and it is not already at that end.
const canScroll = (el: HTMLElement, direction: number) =>
  scrollsY(el) && (direction > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0);
// The nearest ancestor (the element itself first) that can scroll that way: the browser's own scroll chaining.
const scrollerAbove = (from: Element | null | undefined, direction: number): HTMLElement | undefined => {
  for (let node = from ?? null; node && node !== document.body; node = node.parentElement)
    if (canScroll(node as HTMLElement, direction)) return node as HTMLElement;
};
// The channel list's scrolling element, from the row that has focus (or the first row).
const sidebarScroller = (direction: number) => {
  const active = document.activeElement;
  return scrollerAbove(regionOf(active) === "sidebar" ? active : channelRows()[0], direction);
};
// A page with no message list: where the focus is when that is inside the page, else the biggest area on the page
// that scrolls (not the channel list, not a dialog).
const pageScroller = (direction: number) => {
  const firstRow = channelRows()[0] ?? null;
  const outside = (el: Element) => !el.contains(firstRow) && regionOf(el) !== "sidebar" && !el.closest('[role="dialog"]');
  const active = document.activeElement;
  const focused = active && active !== document.body && regionOf(active) !== "sidebar" ? scrollerAbove(active, direction) : undefined;
  if (focused && outside(focused)) return focused;
  let best: HTMLElement | undefined;
  let area = 0;
  for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
    if (el.clientHeight < 40 || el.scrollHeight <= el.clientHeight + 1 || !canScroll(el, direction) || !outside(el)) continue;
    if (el.clientHeight * el.clientWidth > area) [best, area] = [el, el.clientHeight * el.clientWidth];
  }
  return best;
};
// The element a line-scroll moves, for the pane that has the keys.
export const lineScroller = (direction: number): HTMLElement | undefined => {
  if (state.region !== "sidebar") {
    const list = timelineOf(state.region === "side" ? "side" : "main");
    if (list) return list;
  } else if (timelineOf("main")) return sidebarScroller(direction);
  return pageScroller(direction) ?? sidebarScroller(direction);
};
// Moves the focus onto the nearest item that is still in the view when the scroll took the focused one out of it
// (the cursor of a list of buttons is its focus). `items` are the list's buttons and links.
export const keepFocusInView = (scroller: HTMLElement, items: HTMLElement[], direction: number) => {
  const box = scroller.getBoundingClientRect();
  const within = (el: Element, whole: boolean) => {
    const rect = el.getBoundingClientRect();
    return whole ? rect.top >= box.top && rect.bottom <= box.bottom : rect.bottom > box.top && rect.top < box.bottom;
  };
  const current = items.find((el) => el === document.activeElement);
  if (!current || within(current, false)) return;
  const shown = items.filter((el) => within(el, true));
  const next = direction > 0 ? shown[0] : shown.at(-1);
  if (!next) return;
  // No scrolling into view (the item shows already, and a scroll now would undo part of the one just made); the ring
  // the host draws only after a keyboard move is switched on, as for Tab.
  document.documentElement.dataset.keyboardNavigation = "";
  next.focus({ preventScroll: true, focusVisible: true });
};
export const scrollLines = (scroller: HTMLElement, direction: number, lines: number) => {
  scroller.scrollTop += direction * lines * lineHeight(scroller);
};
export const lineScroll = (direction: number) => {
  const lines = takeCount();
  const scroller = lineScroller(direction);
  if (!scroller) return;
  scrollLines(scroller, direction, lines);
  afterLayout(() => {
    if (scroller.matches(SCROLLER)) {
      // The message box has the keys: the pane's cursor row is only remembered (it comes back on k), not drawn.
      if (!boxHasKeys()) keepCursorInView(scroller, direction, true);
    } else keepFocusInView(scroller, [...scroller.querySelectorAll<HTMLElement>("button, a[href]")].filter(visible), direction);
  });
};
