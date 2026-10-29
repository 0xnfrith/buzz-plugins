// ---- Message actions [DOM] --------------------------------------------------------------
// The host builds a row's action bar lazily: when the pointer enters the row, focus lands in
// it, or Tab is pressed. A Tab keydown on window is the host's own "a keyboard user is here"
// signal for every row at once. It moves no focus, so the plugin sends one, then clicks the
// control the way a pointer would.
import { BRANCH, BRANCH_PILL, FOLD_ATTR, MAIN, PANE_HANDLE, PANE_TOGGLE, SCROLLER } from "./constants";
import { ctx } from "./ctx";
import { clearCursor, cursorRow, cursors, paintCursor, selectRow, stopFollow } from "./cursor";
import { activeTimeline, afterLayout, focusEl, nextFrame, rowsOf, settle, timelineOf, visible } from "./dom";
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
// tab stops showing: closed (q, the tab's x, Cmd+W) or left for the channel's tab. The host marks the channel's panel inert and
// aria-hidden while a tab covers it, so the page is watched for those and for tabs coming and going, one check a frame later.
let beneath: { id: string; tab: HTMLElement } | undefined;
let leaving: MutationObserver | undefined;
const cursorBack = () => {
  if (!beneath || visible(beneath.tab)) return;
  const scroller = timelineOf("main");
  if (!scroller) return; // no list is back yet (another page is showing): the next change of the page asks again
  const { id } = beneath;
  beneath = undefined;
  leaving?.disconnect();
  const rows = rowsOf(scroller);
  const kept = rows.find((row) => row.dataset.messageId === cursors.main);
  // The channel's list comes back at its bottom, which can leave the row far above the view: it is shown too, not only marked.
  if (kept) return selectRow(kept); // the cursor is in the list already (put there since, or the thread's own copy of the same message): it needs its mark back
  clearCursor("main");
  const row = rows.find((row) => row.dataset.messageId === id);
  if (row) selectRow(row);
  paintCursor();
};
const watchBeneath = (tab: HTMLElement) => {
  leaving?.disconnect();
  const workspace = tab.closest(MAIN);
  if (!workspace) return;
  let queued = false;
  const watch = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (disposed || !beneath) return watch.disconnect();
      cursorBack();
    });
  });
  watch.observe(workspace, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert", "aria-hidden", "data-covered", "hidden"] });
  leaving = watch;
};
export const openThread = async () => {
  clearPending();
  stopFollow();
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
    if (tab) watchBeneath(tab);
    clearCursor("main");
    paintCursor();
  }
  goRegion(region, true); // the thread lands at its end
};
// ---- Reply branches in a thread [DOM] ---------------------------------------------------
// A thread shows a message's own replies under it, behind a pill ("3 replies") that opens them. The host opens a branch once and gives
// it no way to close again, so `o` there opens a closed branch by pressing the pill, as a pointer would, and folds an open one itself:
// it marks the branch (FOLD_ATTR, the count the pill shows) and the stylesheet (theme.ts) hides its replies and draws the count where
// the pill was. The host does not know: it has the branch open still, and `o` again takes the mark off. The fold is the plugin's own and
// leans on the host's markup, so it is made to fail safe: where that markup is not found, or the mark does not hide the replies, `o`
// does nothing to an open branch (it still opens a closed one), and it never throws. On a message with no replies of its own (and on
// the thread's first message) `o` does nothing.
const numberIn = (text: string | null) => Number(/\d+/.exec(text ?? "")?.[0] ?? 0);
const FOLDED = `[${FOLD_ATTR}]`;
// The replies under a branch's message, at every depth: the rows the host drew, the replies that a branch inside this one still keeps
// behind its pill, and the replies of a branch inside this one that is folded itself. A folded branch has its rows out of the page, and
// the pills inside it, and says how many it hides in its mark, which has counted both (so its mark is added, and what is inside it is not).
const replyCount = (panel: Element) => {
  const marks = [...panel.querySelectorAll(FOLDED)].filter((fold) => !fold.parentElement?.closest(FOLDED));
  const pills = [...panel.querySelectorAll(BRANCH_PILL)].filter((pill) => !pill.closest(FOLDED));
  return (
    rowsOf(panel).length +
    pills.reduce((sum, pill) => sum + numberIn(pill.getAttribute("aria-label")), 0) +
    marks.reduce((sum, fold) => sum + numberIn(fold.getAttribute(FOLD_ATTR)), 0)
  );
};
const foldBranch = (branch: HTMLElement, row: HTMLElement) => {
  const panel = branch.lastElementChild;
  if (!panel || branch.getAttribute("data-open") !== "true") return;
  const count = replyCount(panel);
  if (!count) return;
  branch.setAttribute(FOLD_ATTR, `${count} ${count === 1 ? "reply" : "replies"}`);
  // The stylesheet takes the replies out of the page. If it did not, the markup is not the one it was written for: leave the branch open.
  if (visible(panel)) branch.removeAttribute(FOLD_ATTR);
  else row.scrollIntoView({ block: "nearest" });
};
// The pill that opens the replies of the message `row` shows: the host's branch wrapper (marked data-depth) holds the message first and
// the pill's own wrapper after it. Where the host does not mark its branches that way, the same shape finds it: the nearest ancestor of
// the row that holds the row in its first child and has a pill of its own. (There an open branch is not found, and `o` leaves it be.)
const pillOf = (row: HTMLElement, scroller: Element, branch: Element | null | undefined) => {
  const own = `:scope > * > ${BRANCH_PILL}`;
  if (branch) return branch.querySelector<HTMLElement>(own);
  for (let el = row.parentElement; el && el !== scroller; el = el.parentElement) {
    const pill = el.firstElementChild?.contains(row) ? el.querySelector<HTMLElement>(own) : null;
    if (pill) return pill;
  }
  return null;
};
const toggleBranch = async () => {
  clearPending();
  try {
    const scroller = activeTimeline();
    const row = cursorRow();
    if (!scroller || !row) return;
    const branch = row.closest<HTMLElement>(BRANCH);
    if (branch?.hasAttribute(FOLD_ATTR)) return branch.removeAttribute(FOLD_ATTR);
    const pill = pillOf(row, scroller, branch);
    if (!pill) return branch ? foldBranch(branch, row) : undefined;
    const epoch = keyEpoch;
    pill.click();
    // The host moves the focus to the first reply it shows: back to the message list, with the cursor where it was.
    await nextFrame();
    if (keyEpoch === epoch && row.isConnected) {
      focusEl(scroller);
      row.scrollIntoView({ block: "nearest" });
    }
  } catch {
    // Nothing the host draws is worth an error in a key handler: the key does nothing.
  }
};
// A folded branch shows its count in a pseudo-element, which a pointer cannot press, so a click on the branch itself in the band the count
// fills at its foot opens it again. One listener of the plugin's, and no element of its own on the page.
export const onFoldClick = (event: MouseEvent) => {
  const branch = event.target;
  if (!(branch instanceof HTMLElement) || !branch.hasAttribute(FOLD_ATTR)) return;
  const band = parseFloat(getComputedStyle(branch, "::after").height) || Infinity;
  if (event.clientY >= branch.getBoundingClientRect().bottom - band) branch.removeAttribute(FOLD_ATTR);
};
// `o`: in a thread it opens or folds the replies of the message under the cursor; in the channel it opens the message's thread. A
// thread that replaces the channel's list is told from the channel by what the list is: only the channel's carries data-channel-timeline.
export const openOrFold = () => {
  const scroller = activeTimeline();
  if (scroller && !scroller.hasAttribute("data-channel-timeline") && state.region !== "sidebar") void toggleBranch();
  else void openThread();
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
  stopFollow();
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
