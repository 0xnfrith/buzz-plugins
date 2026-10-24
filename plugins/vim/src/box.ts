// ---- Insert mode, and the message box as a stop in the column --------------------------------
import { apple } from "./constants";
import { ctx } from "./ctx";
import { composerOf, focusEl, inComposer, isEditable, afterLayout, regionOf, rowsOf, timelineOf } from "./dom";
import type { ConversationToolProps } from "./host-api";
import { clampCursor, draftEdge, isBreak, keepOutOfIslands, peek, stepRight } from "./caret";
import { selectRow } from "./cursor";
import { shiftRegion } from "./panes";
import { syncFocus } from "./focus";
import { leaveVisual } from "./visual";
import { bar } from "./status";
import { clearPending, disposed, keyEpoch, set, state } from "./state";
import type { Region } from "./types";

// [API] The one sanctioned way to focus a composer is the focus() command a composer tool
// receives. A tool only exists inside a mounted composer, so this one renders nothing and just
// parks its command (with the channel and thread it belongs to) where `i` can find it.
interface Bridge {
  focus: () => void;
  channelId?: string;
  threadRootId?: string;
}
const bridges = new Set<Bridge>();
export const registerFocusBridge = () => {
  const React = ctx.react;
  const FocusBridge = (props: ConversationToolProps) => {
    const { focus, channelId, threadRootId } = props;
    React.useEffect(() => {
      const entry = { focus, channelId, threadRootId };
      bridges.add(entry);
      return () => {
        bridges.delete(entry);
      };
    }, [focus, channelId, threadRootId]);
    return null;
  };
  ctx.conversation.registerTool({
    id: "focus-bridge",
    title: "Vim focus bridge",
    order: 1000,
    component: FocusBridge,
  });
};
// [API] The channel on screen, from the navigation target.
export const currentChannelId = () => {
  const target = ctx.navigation.snapshot().entry?.target;
  return target?.kind === "conversation" ? target.channelId : undefined;
};
// Focuses a pane's message box: through the composer tool's focus() command ([API]), else by markup.
// Returns false when the pane has no writable box on screen.
const focusBox = (pane: Region) => {
  const channelId = currentChannelId();
  const bridge = [...bridges]
    .reverse()
    .find((b) => (pane === "side" ? b.threadRootId : !b.threadRootId && (!channelId || b.channelId === channelId)));
  let via = "tool";
  if (bridge) bridge.focus();
  const active = document.activeElement;
  if (!isEditable(active) || !inComposer(active) || regionOf(active) !== pane) {
    // [DOM] No matching tool (or its command was revoked): find the composer by markup.
    via = "dom";
    const composer = composerOf(pane) ?? (pane === "side" ? undefined : composerOf("main"));
    if (!composer) return false;
    composer.focus();
  }
  bar.dataset.focusVia = via; // read by the test, to tell the two paths apart
  return true;
};
// A caret inside a mention chip cannot type: INSERT starts beside the chip instead (after it).
const caretBesideChips = () => {
  const selection = document.getSelection();
  if (selection && isEditable(document.activeElement) && inComposer(document.activeElement)) keepOutOfIslands(selection, true);
};
// The editor puts its own saved selection back a moment after the box gains focus (see enterBox): if that lands inside a
// chip, move it beside the chip once it is done, unless a key has come in between.
const settleInsertCaret = () => {
  const epoch = keyEpoch;
  setTimeout(() => {
    if (!disposed && keyEpoch <= epoch + 1 && state.textMode === "insert") caretBesideChips();
  }, 100);
};
export const enterInsert = () => {
  caretBesideChips();
  set({ textMode: "insert" });
  syncFocus();
  settleInsertCaret();
};
export const startInsert = (where?: "end" | "after") => {
  if (!focusBox(state.region === "side" ? "side" : "main")) return;
  if (where === "end") {
    const selection = document.getSelection() as Selection;
    selection.selectAllChildren(document.activeElement as Node);
    selection.collapseToEnd();
  } else if (where === "after") {
    // With composer editing on, Esc left the caret on the last character, so `a` resumes after it.
    const selection = document.getSelection() as Selection;
    if (selection.isCollapsed) stepRight(selection);
  }
  caretBesideChips();
  set({ textMode: "insert" });
  syncFocus();
  settleInsertCaret();
};
// A pane is one column: its messages, then its message box. NORMAL mode runs in both, so the box is
// entered in NORMAL (not INSERT) at the start or the end of the draft, and left upwards into the
// newest message. Without composer editing the box has no NORMAL mode, so there is no crossing.
export const enterBox = (pane: Region, at: "start" | "end") => {
  if (!state.composerNormal || !focusBox(pane)) return false;
  const box = document.activeElement as HTMLElement;
  // The first or the last text position of the draft. Not "select all children, collapse": that is
  // a position on the editor's root element, which the editor does not accept as a caret and
  // answers by putting back the selection it had saved (seen in the browser test).
  const place = () => {
    const selection = document.getSelection() as Selection;
    const spot = draftEdge(box, at);
    if (spot) selection.collapse(...spot);
    else selection.collapse(box.firstElementChild ?? box, 0); // an empty draft
    clampCursor(selection);
  };
  const put = () => {
    place();
    // Tell the editor now rather than when the browser gets round to it.
    document.dispatchEvent(new Event("selectionchange"));
  };
  put();
  // The editor, on gaining focus, puts its own saved selection back at about 20 ms and ignores selection
  // changes for 50 ms after (seen in the browser test: the caret stayed where the editor had it). So
  // put the caret again once that is over, unless a key has come in between.
  const epoch = keyEpoch; // (+1: onAnyKey is still counting the key that brought us here)
  setTimeout(() => {
    if (!disposed && document.activeElement === box && keyEpoch <= epoch + 1 && state.textMode === "normal" && !state.visual) put();
  }, 80);
  set({ textMode: "normal", visual: "", region: pane });
  syncFocus();
  return true;
};
// A message pane lies to the right of the one that has the keys: the thread's, from the channel's.
export const paneRight = () => state.region === "main" && !!timelineOf("side");
// One pane left (-1) or right (+1) from a message box, by position and not by where the cursor came from:
// the thread's pane is right of the channel's, which is right of the channel list. Into the box of the pane
// beside it when that has one on screen (the thread's from the channel's going right, the channel's from the
// thread's going left); anywhere else the step is the same as in the lists, so `h` from the channel's box
// reaches the channel list and `l` from the thread's box, the rightmost pane, goes nowhere.
export const boxStep = (direction: number) => {
  const beside = state.region === "main" && direction > 0 ? "side" : state.region === "side" && direction < 0 ? "main" : undefined;
  // Moving right enters the box at the start of its draft, moving left at the end.
  if (beside && composerOf(beside) && enterBox(beside, direction > 0 ? "start" : "end")) return;
  shiftRegion(direction);
};
// Out of the box into its pane's message list. blur() alone is not enough in WebKit (Linux, and most
// likely a Mac's WKWebView): a key's text goes to the editor that holds the selection even when it
// no longer has focus, so any plain key the plugin does not bind (x, y, 0 ...) typed into the draft
// after Esc Esc. Chromium never did that, which is why the browser tests could not see it.
export const leaveBox = (el: HTMLElement, pane: "main" | "side") => {
  // The editor adopts the native caret as the box loses focus, and resumes from it on the way back: never from inside a chip.
  const caret = document.getSelection();
  if (caret) keepOutOfIslands(caret);
  el.blur();
  document.getSelection()?.removeAllRanges();
  set({ textMode: "insert", visual: "" });
  focusEl(timelineOf(pane));
  syncFocus();
};
// Up out of the box: the cursor lands on the newest message of the pane.
export const boxUp = (pane: "main" | "side") => {
  leaveBox(document.activeElement as HTMLElement, pane);
  const scroller = timelineOf(pane);
  if (!scroller) return;
  scroller.scrollTop = scroller.scrollHeight;
  afterLayout(() => {
    const row = rowsOf(scroller).at(-1);
    if (row) selectRow(row);
  });
};
export const escape = () => {
  const el = document.activeElement;
  // In the message box a pending d, g, f, t ... is what Esc cancels; the mode stays as it was.
  if (state.prefix || (state.operator === "d" && isEditable(el))) return clearPending();
  if (state.visual) return leaveVisual();
  if (!isEditable(el)) return clearPending();
  if (state.composerNormal && state.textMode === "insert" && inComposer(el)) {
    clearPending();
    set({ textMode: "normal" });
    // Like vim, leaving insert steps the caret back one character (never across a line).
    const selection = document.getSelection() as Selection;
    const before = selection.isCollapsed ? peek(selection, "backward") : "";
    if (before !== "" && !isBreak(before)) selection.modify("move", "backward", "character");
    return syncFocus();
  }
  // Already in NORMAL in the box: Esc stays there, as in vim. The cursor leaves the box upward (k on its
  // first row) or sideways (the leader key, or h and l at the ends of the draft), never by Esc.
  if (state.composerNormal && inComposer(el)) return clearPending();
  // Any other editable, or a message box without a NORMAL mode: Esc leaves it for the message list.
  leaveBox(el as HTMLElement, regionOf(el) === "side" ? "side" : "main");
};

// ---- Indirect command bus: synthetic host chords [API-adjacent] -------------------------
// The host's actions (search, focus message box) are not callable, but its dispatcher listens
// to window keydown and does not check isTrusted. So a plugin can press the host's own chord.
// It returns true when a host shortcut consumed it.
export const pressHostChord = (key: string) =>
  !(document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      metaKey: apple,
      ctrlKey: !apple,
      bubbles: true,
      cancelable: true,
      composed: true,
    }),
  );
