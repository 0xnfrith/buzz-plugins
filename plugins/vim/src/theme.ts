// ---- Theme: the plugin's stylesheet [DOM] -----------------------------------------------
// Every colour is one of the host's own theme tokens (custom properties on <html>), so the marks follow the accent
// colour and light or dark mode live. See "Theme" in plugins/vim/NOTES.md.
import { ACCENT, COMMUNITY_POPUP, COMPOSER, FOCUS_RING, FOLD_ATTR, MAIN, mix, SIDE, SIDEBAR_ROW } from "./constants";

// The channel list has real focus, so only a ring is needed; mark it while that region is active.
// While the plugin drives the community switcher, its popover is hidden so it does not flash.
const FOCUS_CSS =
  `html[data-vim-region="sidebar"] ${SIDEBAR_ROW}:focus{outline:2px solid ${FOCUS_RING};outline-offset:-2px}` +
  `html[data-vim-driving] ${COMMUNITY_POPUP}{opacity:0!important;transition:none!important;animation:none!important}` +
  // Likewise a message's menu while yY presses its item (yank.ts marks the menu itself).
  `[role="menu"][data-vim-yanking]{opacity:0!important;transition:none!important;animation:none!important}`;
// Put text before and after every part of a selector list.
const around = (list: string, before: string, after = "") =>
  list
    .split(",")
    .map((part) => `${before}${part.trim()}${after}`)
    .join(",");
export const PANES = [
  ["main", MAIN],
  ["side", SIDE],
] as const;
// The active pane's header gets a 2px accent line along its bottom edge, the full width of the
// pane. It is the header's own ::after (the host draws its 1px separator there, inset from the
// sides), restyled, so nothing is added to the page. A frame drawn on the pane's outer box was
// tried first: the message list inside scrolls in a layer of its own that paints over it, so
// below the header only the corners survived. The line shows only with a thread pane beside the
// channel (data-vim-panes): a lone pane is trivially the active one.
const PANE_HEADER = { main: "[data-main-workspace] > header", side: "[data-panel-workspace] > header" };
const LINE_CSS = PANES.map(
  ([pane]) =>
    `html[data-vim-on][data-vim-panes][data-vim-region="${pane}"] ${PANE_HEADER[pane]}::after` +
    `{inset-inline:0;height:2px;background:${ACCENT}}`,
).join("");
// The cursor row is marked on its message bubble, not on the row: the bubble goes up a step in brightness
// (the host's own hover treatment, `--affordance-backdrop-pressed`, laid over whatever fill the bubble has,
// so it works for received and own bubbles, in light and dark mode, with every accent) and gets a thin
// accent outline. The row itself keeps no tint and no bar. The bubble is the element that carries
// `data-message-action-anchor` inside the row's `[data-bubble]` content (the host's class names are hashed).
// A row with no bubble (a picture, a card, a huddle) gets the outline round the whole message instead.
// The pane that has the keys shows it strongly; the other pane shows where it was left, outline only, faint.
const BUBBLE = "[data-bubble] [data-message-action-anchor]:not([data-solo-cards])";
const LIFT = "var(--affordance-backdrop-pressed, #80808040)";
const MARK_ACTIVE = {
  bubble: `background-image:linear-gradient(${LIFT},${LIFT});outline:2px solid ${ACCENT}`,
  bare: `outline:2px solid ${ACCENT};outline-offset:-2px;border-radius:14px`,
};
const MARK_RESTING = {
  bubble: `outline:1px solid ${mix(ACCENT, 45)}`,
  bare: `outline:1px solid ${mix(ACCENT, 45)};outline-offset:-1px;border-radius:14px`,
};
// While a message box has the keys (INSERT, or NORMAL in the box) the focus is in the box, not on the message above
// it: that pane's cursor row steps back like the other pane's (its place is kept, as an outline, with no lift),
// and the box takes a much fainter version of the same lift, so it is clear where the keys are.
const BOX_LIFT = mix(LIFT, 40);
const BOX_FOCUS_CSS = `html[data-vim-on] form:has(${COMPOSER}:focus){background-image:linear-gradient(${BOX_LIFT},${BOX_LIFT})}`;

// The cursor row of each pane carries this attribute, whose value is the pane ("main" or "side"); cursor.ts sets it on the
// row element. Whether that pane is the one that has the keys comes from two attributes on <html> that the label keeps
// current: data-vim-region (which region has the keys) and data-vim-box (a message box has them), so moving the cursor or
// the focus never rewrites this stylesheet.
export const CURSOR_ATTR = "data-vim-cursor";
const ROW = `[${CURSOR_ATTR}]`;
const BARE = ":not(:has([data-bubble])) > [data-layout]";
// The channel list counts as the message list here: with it focused the channel's cursor still reads as the active one.
const ACTIVE_MAIN = 'html:not([data-vim-region="side"]):not([data-vim-box]) ';
const ACTIVE_SIDE = 'html[data-vim-region="side"]:not([data-vim-box]) ';
const CURSOR_CSS =
  // where it was left: any marked row inside a pane
  `${around(`${MAIN}, ${SIDE}`, "", ` ${ROW} ${BUBBLE}`)}{${MARK_RESTING.bubble}}` +
  `${around(`${MAIN}, ${SIDE}`, "", ` ${ROW}${BARE}`)}{${MARK_RESTING.bare}}` +
  // the pane that has the keys
  `${ACTIVE_MAIN}${ROW}[${CURSOR_ATTR}="main"] ${BUBBLE}{${MARK_ACTIVE.bubble}}` +
  `${ACTIVE_MAIN}${ROW}[${CURSOR_ATTR}="main"]${BARE}{${MARK_ACTIVE.bare}}` +
  `${ACTIVE_SIDE}${ROW}[${CURSOR_ATTR}="side"] ${BUBBLE}{${MARK_ACTIVE.bubble}}` +
  `${ACTIVE_SIDE}${ROW}[${CURSOR_ATTR}="side"]${BARE}{${MARK_ACTIVE.bare}}`;

// A reply branch folded with `o` (threads.ts). The host's branch is a wrapper with the message first and the replies' panel last (its
// own pill sits between them, and only while the branch is closed), so a folded branch hides its last child, ends the vertical line
// the host draws down from the message, and shows the count (the attribute's value, "3 replies") where the pill would be, in the
// size and the place of the host's own, under the message, in line with its bubble.
const FOLD = `[${FOLD_ATTR}]`;
const FOLD_CSS =
  `${FOLD}>:last-child{display:none}` +
  `${FOLD}>:first-child::after{display:none}` +
  `${FOLD}::after{content:attr(${FOLD_ATTR});display:flex;align-items:center;min-height:var(--size-control-sm,2rem);` +
  `margin-inline-start:calc(var(--size-control-sm,2rem) + var(--space-2,.5rem));padding-inline:var(--space-4,1rem);` +
  `color:var(--text-standard,inherit);font-size:var(--text-body-sm,.875rem);line-height:var(--text-body-sm--line-height,1.43)}`;

// The whole stylesheet, written once when the plugin is applied.
export const STATIC_CSS = FOCUS_CSS + LINE_CSS + BOX_FOCUS_CSS + CURSOR_CSS + FOLD_CSS;
