// ---- Yank: yy and yY [DOM] --------------------------------------------------------------
// `yy` copies the link of the message under the cursor and `yY` its text. Buzz does both itself and tells the user with a
// toast ("Link copied", "Message copied"), so the plugin presses its controls: the Copy link button of the message's action
// bar, and the Copy message item of its "More message actions" menu, which it opens without showing it, waits for to go,
// and then puts the focus back on the list. The host builds the link (its own format) and the text (mentions written as
// links, the addresses of the attachments). Plugin API: nothing reaches the clipboard or a message's controls. DOM.
import { cursorRow } from "./cursor";
import { activeTimeline, focusEl, nextFrame, settle } from "./dom";
import { clearPending, disposed } from "./state";
import { rowControl } from "./threads";

const MENU = '[role="menu"][data-message-id]';
// Marks the menu that yY drives; theme.ts hides what carries it. It is put on the menu itself, as the menu is drawn (a
// MutationObserver runs before the frame is painted), and not on the page's root: a rule that hangs on an attribute of the
// root makes the engine look at every element of the page, twice (set and removed), which cost yY some 25 ms.
export const YANKING = "data-vim-yanking";
const pressable = (el: HTMLElement | undefined) => (el && el.getAttribute("aria-disabled") !== "true" && !el.hasAttribute("data-disabled") ? el : undefined);

export const yankMessage = async (what: "link" | "text") => {
  clearPending();
  const id = cursorRow()?.dataset.messageId;
  if (!id) return;
  const list = activeTimeline(); // the pane that has the keys: the host's press takes the focus off it
  let hide: MutationObserver | undefined;
  try {
    if (what === "link") {
      await rowControl("Copy link"); // a button of the action bar, disabled while the message has no link yet
      await nextFrame();
      await nextFrame();
      return;
    }
    hide = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement) for (const menu of node.matches(MENU) ? [node] : node.querySelectorAll(MENU)) menu.setAttribute(YANKING, "");
    });
    hide.observe(document.body, { childList: true, subtree: true });
    await rowControl("More message actions");
    const menu = () => [...document.querySelectorAll<HTMLElement>(MENU)].find((el) => el.dataset.messageId === id);
    const item = await settle(() => [...(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find((el) => el.textContent?.trim() === "Copy message"), 1200);
    if (pressable(item)) item?.click();
    // A menu with no such item, or with it disabled: close it again.
    else menu()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await settle(() => !document.querySelector(MENU), 1500);
  } catch {
    // Nothing the host draws is worth an error in a key handler: the key does nothing.
  } finally {
    hide?.disconnect();
    for (const menu of document.querySelectorAll(`[${YANKING}]`)) menu.removeAttribute(YANKING);
    if (!disposed) focusEl(list?.isConnected ? list : activeTimeline());
  }
};
