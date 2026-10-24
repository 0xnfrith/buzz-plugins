// ---- Help dialog [DOM] ------------------------------------------------------------------
// `?` shows the key list in a dialog over whatever is on screen, so closing it leaves you where
// you were. The plugin draws it itself: the plugin API has no dialog or overlay service (a message
// action can mount a dialog, but only from a message's menu, never from a key). While it is open
// every key is ours: the shortcut service already stands down for an aria-modal element, and a
// capture-phase listener scrolls and closes it and swallows the rest, so nothing reaches the page.
import { focusEl, inComposer, isEditable, timelineOf } from "./dom";
import { groups } from "./key-list";
import { lineHeight } from "./scroll";
import { disposed, set, state } from "./state";
import { syncFocus } from "./focus";

let helpEl: HTMLElement | undefined; // the backdrop, while open
let helpCard: HTMLElement | undefined; // the scrolling dialog inside it
let helpReturn: HTMLElement | undefined; // where focus goes back to
let helpReturnMode: string | undefined; // the message box's mode when it opened (refocusing a box would make it INSERT)
let helpOpenedBy: Event | undefined; // the keydown that opened it
let helpPending = ""; // "g" after a first g
let helpCount = 0;
export const isHelpOpen = () => !!helpEl;
export const markHelpOpenedBy = (event: Event) => {
  helpOpenedBy = event;
};
export function closeHelp() {
  if (!helpEl) return;
  helpEl.remove();
  helpEl = helpCard = undefined;
  helpPending = "";
  helpCount = 0;
  const back = helpReturn;
  const mode = helpReturnMode;
  helpReturn = helpReturnMode = undefined;
  if (disposed) return;
  if (back?.isConnected && back !== document.body) {
    back.focus({ preventScroll: true });
    // A box that had NORMAL gets it back, not the INSERT that any focus into a box means.
    if (mode === "normal" && isEditable(back) && inComposer(back)) set({ textMode: "normal", visual: "" });
  } else focusEl(timelineOf(state.region === "side" ? "side" : "main"));
  syncFocus();
}
export function openHelp() {
  if (helpEl) return closeHelp();
  helpReturn = (document.activeElement as HTMLElement | null) ?? undefined;
  helpReturnMode = state.textMode;
  const backdrop = document.createElement("div");
  backdrop.setAttribute("data-vim-help", "");
  Object.assign(backdrop.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483001",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.45)",
  });
  const card = document.createElement("div");
  card.className = "ui-card"; // the host's own card look
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Vim keys");
  card.tabIndex = -1;
  Object.assign(card.style, {
    boxSizing: "border-box",
    width: "min(780px, calc(100vw - 48px))",
    maxHeight: "min(80vh, 760px)",
    overflow: "auto",
    padding: "20px 24px",
    outline: "none",
    font: "13px/1.5 system-ui, sans-serif",
  });
  const el = (tag: string, style: Partial<CSSStyleDeclaration>, text?: string) => {
    const node = document.createElement(tag);
    Object.assign(node.style, style);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  card.append(
    el("h2", { margin: "0 0 4px", font: "600 16px/1.3 system-ui, sans-serif" }, "Vim keys"),
    el("p", { margin: "0 0 12px", opacity: "0.7" }, "j k scroll, Ctrl-d Ctrl-u half a page, gg G top and bottom. q, Esc or ? closes."),
  );
  for (const group of groups()) {
    card.append(
      el("h3", { margin: "14px 0 2px", font: "700 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.04em" }, `-- ${group.title} --`),
      el("p", { margin: "0 0 4px", opacity: "0.7" }, group.intro),
    );
    const rows = el("div", { display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "16px", rowGap: "2px" });
    for (const [keys, what] of group.rows)
      rows.append(el("span", { font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "nowrap" }, keys), el("span", {}, what));
    card.append(rows);
  }
  backdrop.append(card);
  // A click on the dimmed backdrop, outside the card, closes it.
  backdrop.addEventListener("pointerdown", (event) => event.target === backdrop && closeHelp());
  document.body.append(backdrop);
  helpEl = backdrop;
  helpCard = card;
  card.focus({ preventScroll: true });
  syncFocus();
}
export function onHelpKey(event: KeyboardEvent) {
  if (!helpEl || event.isComposing || event === helpOpenedBy) return;
  if (event.metaKey || event.altKey) return; // the host's own chords stay available
  const card = helpCard as HTMLElement;
  const half = () => Math.max(40, card.clientHeight / 2);
  if (event.ctrlKey) {
    if (event.shiftKey || !["d", "u", "e", "y"].includes(event.key)) return; // Ctrl+Shift+E and the like still work
    event.preventDefault();
    event.stopPropagation();
    // Ctrl-d and Ctrl-u half a page, Ctrl-e and Ctrl-y a line.
    const step = { d: half(), u: -half(), e: lineHeight(card), y: -lineHeight(card) }[event.key as "d" | "u" | "e" | "y"];
    card.scrollBy({ top: step });
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const { key } = event;
  const first = helpPending === "g";
  helpPending = "";
  const n = Math.max(1, helpCount);
  if (/^[0-9]$/.test(key) && (key !== "0" || helpCount > 0)) {
    helpCount = Math.min(helpCount * 10 + Number(key), 999);
    return;
  }
  helpCount = 0;
  switch (key) {
    case "Escape":
    case "q":
    case "?":
      return closeHelp();
    case "j":
    case "ArrowDown":
      return card.scrollBy({ top: 48 * n });
    case "k":
    case "ArrowUp":
      return card.scrollBy({ top: -48 * n });
    case "PageDown":
    case " ":
      return card.scrollBy({ top: card.clientHeight * 0.9 });
    case "PageUp":
      return card.scrollBy({ top: -card.clientHeight * 0.9 });
    case "g":
      if (first) card.scrollTo({ top: 0 });
      else helpPending = "g";
      return;
    case "Home":
      return card.scrollTo({ top: 0 });
    case "G":
    case "End":
      return card.scrollTo({ top: card.scrollHeight });
  }
}
