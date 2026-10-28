// ---- Message actions [DOM] --------------------------------------------------------------
// The host builds a row's action bar lazily: when the pointer enters the row, focus lands in
// it, or Tab is pressed. A Tab keydown on window is the host's own "a keyboard user is here"
// signal for every row at once. It moves no focus, so the plugin sends one, then clicks the
// control the way a pointer would.
import { PANE_HANDLE, PANE_TOGGLE, SCROLLER } from "./constants";
import { ctx } from "./ctx";
import { clearCursor, cursorRow, cursors, paintCursor, selectRow } from "./cursor";
import { afterLayout, nextFrame, rowsOf, settle, timelineOf, visible } from "./dom";
import { currentChannelId } from "./box";
import { available, goRegion } from "./panes";
import { clearPending, disposed, keyEpoch, state, takeCount } from "./state";
import type { Region } from "./types";

export const rowControl = async (label: string) => {
  // Pin the message now: a request made without a cursor, or before the cursor moved on,
  // must not fire later on whatever message the cursor reaches.
  const id = cursorRow()?.dataset.messageId;
  if (!id) return;
  const find = () => {
    const row = cursorRow();
    return row?.dataset.messageId === id
      ? row.querySelector<HTMLButtonElement>(`[aria-label="Message actions"] button[aria-label="${label}"]`)
      : undefined;
  };
  if (!find()) window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  const control = await settle(find, 800);
  if (control && !control.disabled) control.click();
};

// ---- Threads and the thread pane [API + DOM] -------------------------------------------
// Opening is API: the relay read model says which thread a message belongs to, and
// navigation.open opens it where the user's thread placement setting puts threads (a pane
// beside the channel, or a tab over it). Everything else is DOM, because no service reaches a
// pane's focus, its tabs or its width: landing in the pane, closing a thread, hiding the pane
// and resizing it all drive the host's own controls the way a pointer or its keyboard would.
const threadRootOf = (messageId: string) => {
  try {
    const channelId = currentChannelId();
    const rows = channelId ? ctx.relay.snapshot().session.channels.window(channelId).rows : [];
    return rows.find((row) => row.id === messageId)?.threadRootId ?? messageId;
  } catch {
    return messageId;
  }
};
// A thread placed in the main pane is a tab over the channel's list, and the two share one cursor. Opening lands that cursor on the
// thread's newest message, so the message the thread was opened from is kept here, with the tab, and gets the cursor back when the
// tab is closed.
let beneath: { id: string; tab: HTMLElement } | undefined;
const cursorBack = () => {
  if (!beneath || visible(beneath.tab)) return;
  const { id } = beneath;
  beneath = undefined;
  const scroller = timelineOf("main");
  const rows = scroller ? rowsOf(scroller) : [];
  if (rows.some((row) => row.dataset.messageId === cursors.main)) return; // the cursor has been put somewhere in the list since
  clearCursor("main");
  const row = rows.find((row) => row.dataset.messageId === id);
  if (row) selectRow(row, false);
  paintCursor();
};
export const openThread = async () => {
  clearPending();
  // Pin the message now, as rowControl does. Only the message list has a cursor to open.
  const messageId = state.region === "main" ? cursorRow()?.dataset.messageId : undefined;
  const channelId = currentChannelId();
  const { status, viewer, origin } = ctx.relay.snapshot();
  if (!messageId || !channelId || status !== "ready" || !viewer || !origin) return;
  const before = timelineOf("main");
  const epoch = keyEpoch;
  try {
    const result = await ctx.navigation.open(
      {
        version: 1,
        kind: "conversation",
        scope: { viewer, communityOrigin: origin },
        channelId,
        messageId,
        threadRootId: threadRootOf(messageId),
      },
      { focus: "preserve" },
    );
    if (result.status !== "opened") return;
  } catch {
    return;
  }
  // A thread opened here is a new list: whatever the pane marked before belongs to another one.
  clearCursor("side");
  paintCursor();
  // [DOM] Land in the thread's message list (normal mode), unless a key press says the user
  // has moved on. A thread placed over the channel replaces the main message list instead.
  const region = await settle<Region>(
    () => (timelineOf("side") ? "side" : timelineOf("main") !== before ? "main" : undefined),
    3000,
  );
  if (!region || keyEpoch !== epoch) return;
  if (region === "main") {
    const tab = timelineOf("main");
    beneath = tab ? { id: messageId, tab } : undefined;
    clearCursor("main");
    paintCursor();
  }
  goRegion(region, true); // the thread lands at its end
};
// Enter is only ours while the message list itself has focus: on a button, a link or a tab it
// keeps its native meaning.
export const enterOpens = () => {
  const el = document.activeElement;
  return state.region === "main" && !!cursors.main && (!el || el === document.body || el.matches(SCROLLER));
};
// After a close or a hide, put focus back where j and k work. The host leaves it on a header
// button (or nowhere) once the pane it was in is gone.
const refocusAfter = (region: Region) =>
  afterLayout(() => {
    cursorBack();
    goRegion(available(region) ? region : "main");
  });
// [DOM] The same window event the native Close Tab menu sends (Cmd+W). The host closes the
// active tab of the pane that has focus, or of the thread pane when focus is in the message
// list, and marks the event handled when it did.
export const closeThread = () => {
  clearPending();
  if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
  const request = new Event("buzz:close-active-tab", { cancelable: true });
  window.dispatchEvent(request);
  if (request.defaultPrevented) refocusAfter(state.region);
};
// [DOM] The pane's own toggle button: it hides the pane and keeps its threads open.
const paneToggle = (expanded: boolean) =>
  [...document.querySelectorAll<HTMLElement>(`${PANE_TOGGLE}[aria-expanded="${expanded}"]`)].find(visible);
export const hidePane = () => {
  clearPending();
  const toggle = paneToggle(true);
  if (!toggle) return;
  toggle.click();
  refocusAfter("main");
};
export const showPane = () => {
  clearPending();
  paneToggle(false)?.click();
};
// [DOM] The split handle is a WAI-ARIA window splitter, and the host gives it keyboard control:
// Shift+Left and Shift+Right move it 48 px, End makes the pane as wide as it can be, and a
// double click resets it. The plugin sends those events to the handle; focus does not move.
// Left widens the pane because the pane is on the right. Each step reads the pane's width as
// it is now, so a count waits for the layout between steps.
export const resizePane = async (change: "wider" | "narrower" | "widest" | "reset") => {
  const steps = takeCount();
  const handle = [...document.querySelectorAll<HTMLElement>(PANE_HANDLE)].find(visible);
  if (!handle) return;
  const send = (init: KeyboardEventInit) =>
    handle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  if (change === "reset") handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  else if (change === "widest") send({ key: "End" });
  else
    for (let i = 0; i < steps && !disposed && handle.isConnected; i++) {
      send({ key: change === "wider" ? "ArrowLeft" : "ArrowRight", shiftKey: true });
      await nextFrame();
    }
};
