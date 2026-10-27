// ---- Indicator overlay [DOM] ------------------------------------------------------------
// The label says which mode the keys are in and which pane they act on:
//   -- NORMAL --  one normal mode, in a pane's messages and in its message box alike
//   -- INSERT --  typing; -- VISUAL --  and  -- VISUAL LINE --  in the message box
import { ACCENT } from "./constants";
import { paintCursor } from "./cursor";
import { isEditable, workspaces } from "./dom";
import * as perf from "./perf";
import { state } from "./state";

export const bar = document.createElement("div");
bar.setAttribute("data-vim-status", "");
// Visual only: the nav badge carries the mode for assistive technology.
bar.setAttribute("aria-hidden", "true");
// Where it goes: the window's bottom-right corner, fixed, whichever pane or thread tab has the keys.
// It used to be placed against the composer of the pane that has the keys, and that lookup went wrong
// (with a second thread tab open the label jumped into the channel's pane, and in a single pane it sat
// under the box rather than in the corner). A fixed corner depends on no pane, tab or composer. Close
// to the edge (2px, 10px) it stays clear of a composer's send button, which is further in and higher
// (the label test measures that in every layout).
Object.assign(bar.style, {
  position: "fixed",
  right: "10px",
  bottom: "2px",
  zIndex: "2147483000",
  padding: "0 6px",
  borderRadius: "3px",
  font: "600 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace",
  letterSpacing: "-0.01em",
  background: "var(--surface-popover, #1d1d1f)",
  color: "var(--text-standard, #f5f5f7)",
  border: `1px solid ${ACCENT}`,
  pointerEvents: "none",
  whiteSpace: "pre",
});
// What the last render wrote, so that a render that changes nothing writes nothing: setting an attribute or replacing a text node
// to the value it has already makes the engine invalidate style (the stylesheet has rules on these attributes) and the label's
// layout. renderBar runs several times for one key, and in a long list that was most of the key's cost.
// (null: not known, so the next render writes it; mount and dispose reset it, since dispose takes the page's attributes off.)
const unknown = () => ({ display: null as string | null, text: null as string | null, mode: null as string | null, region: null as string | null, on: null as boolean | null, panes: null as boolean | null });
let written = unknown();
export const resetBar = () => {
  written = unknown();
};
export const renderBar = perf.timed("renderBar", () => {
  const display = state.enabled && state.statusLine ? "" : "none";
  if (display !== written.display) bar.style.display = written.display = display;
  const text = state.composerNormal && isEditable(document.activeElement) && state.textMode === "normal";
  const label =
    state.mode === "insert"
      ? "INSERT"
      : text
        ? { "": "NORMAL", char: "VISUAL", line: "VISUAL LINE" }[state.visual]
        : "NORMAL";
  const line = `-- ${label} --  ${state.region}${state.count ? `  ${state.count}` : ""}${state.operator || state.prefix ? `  ${state.operator}${state.prefix}` : ""}`;
  if (line !== written.text) bar.textContent = written.text = line;
  if (state.mode !== written.mode) bar.dataset.mode = written.mode = state.mode;
  const root = document.documentElement;
  if (state.region !== written.region) root.dataset.vimRegion = written.region = state.region;
  if (state.enabled !== written.on) root.toggleAttribute("data-vim-on", (written.on = state.enabled));
  const panes = state.enabled && workspaces("main").length > 0 && workspaces("side").length > 0;
  if (panes !== written.panes) root.toggleAttribute("data-vim-panes", (written.panes = panes));
  paintCursor(); // which pane is active, and whether a box has the keys, decides how strongly each pane's cursor row shows
});
