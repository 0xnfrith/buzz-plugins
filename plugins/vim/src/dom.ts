// ---- DOM helpers [DOM] ------------------------------------------------------------------
import {
  COMPOSER,
  MAIN,
  MESSAGE,
  NOT_WRITABLE,
  POPUP,
  SCROLLER,
  SIDE,
  SIDEBAR_ROW,
} from "./constants";
import * as perf from "./perf";
import { disposed, state } from "./state";
import type { Region } from "./types";

export const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

export const visible = (el: Element | null | undefined): el is Element =>
  !!el && el.getClientRects().length > 0 && !el.closest('[hidden], [inert], [aria-hidden="true"]');
// Same test the host's dispatcher uses to refuse plain keys.
export const isEditable = (el: Element | null | undefined): boolean =>
  !!el &&
  ((el as HTMLElement).isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
    el.getAttribute?.("role") === "textbox");
export const inComposer = (el: Element | null | undefined) => !!el?.closest?.("[data-tab-focus]");
export const regionOf = (el: Element | null | undefined): Region | undefined =>
  !el?.closest
    ? undefined
    : el.closest("[data-sidebar-section], [data-channel-sidebar-row]")
      ? "sidebar"
      : el.closest(SIDE)
        ? "side"
        : el.closest(MAIN)
          ? "main"
          : undefined;
export const workspaces = (region: "main" | "side") =>
  [...document.querySelectorAll(region === "side" ? SIDE : MAIN)].filter(visible);
export const timelineOf = (region: "main" | "side"): HTMLElement | undefined => {
  for (const workspace of workspaces(region)) {
    const scroller = [...workspace.querySelectorAll<HTMLElement>(SCROLLER)].find(visible);
    if (scroller) return scroller;
  }
  // Fallback if the workspace markers drift: any visible timeline counts as main.
  return region === "side" ? undefined : [...document.querySelectorAll<HTMLElement>(SCROLLER)].find(visible);
};
export const activeTimeline = () => timelineOf(state.region === "side" ? "side" : "main") ?? timelineOf("main");
// The pane's visible, writable message box. A pane with several thread tabs keeps every tab's box
// in the page (the others inert), so the first one in the markup is often a hidden tab's: look
// through them all for the one that shows.
export const composerOf = (region: Region): HTMLElement | undefined => {
  for (const workspace of workspaces(region === "side" ? "side" : "main")) {
    const composer = [...workspace.querySelectorAll<HTMLElement>(COMPOSER)].find(
      (box) => visible(box) && !box.matches(NOT_WRITABLE),
    );
    if (composer) return composer;
  }
};
export const channelRows = () => [...document.querySelectorAll<HTMLElement>(SIDEBAR_ROW)].filter(visible);
export const selectedRow = () => channelRows().find((row) => row.getAttribute("aria-current") === "page");
// A membership row ("You were added by ...") carries a message id but is not a message: it has
// no action bar and no thread, so the cursor never rests on it.
export const rowsOf = perf.timed("rowsOf", (scroller: Element) =>
  [...scroller.querySelectorAll<HTMLElement>(MESSAGE)].filter(
    (row) => !row.hasAttribute("data-membership-row") && !row.parentElement?.closest(MESSAGE) && visible(row),
  ),
);
export const inView = (scroller: Element, row: Element) => {
  const box = scroller.getBoundingClientRect();
  const rect = row.getBoundingClientRect();
  return rect.bottom > box.top && rect.top < box.bottom;
};
export const afterLayout = (fn: () => void) =>
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (!disposed) fn();
    }),
  );
export const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
export const focusEl = (el: HTMLElement | null | undefined) => {
  if (!el) return false;
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: "nearest" });
  return document.activeElement === el;
};
// We are not inside a menu or dialog. Pages without a conversation count: gt and { must be
// able to leave them.
export const contextOk = () => !document.activeElement?.closest?.(POPUP);

// Polls a probe once a frame until it finds something, up to `ms`.
export const settle = <T>(probe: () => T | undefined | false | null, ms = 1500) =>
  new Promise<T | undefined>((resolve) => {
    const started = performance.now();
    const tick = () => {
      const found = disposed ? undefined : probe();
      if (found || disposed || performance.now() - started > ms) resolve(found || undefined);
      else requestAnimationFrame(tick);
    };
    tick();
  });
// A message box has the keys: INSERT, or NORMAL in the box.
export const boxHasKeys = () => isEditable(document.activeElement) && inComposer(document.activeElement);
