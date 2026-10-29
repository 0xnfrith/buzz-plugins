// ---- Esc in a message box beside a thread pane [DOM] ------------------------------------
// The host closes a side-pane tab on Esc from anywhere inside it, in React's handler on the
// pane, which runs before the window-level dispatcher the shortcut service uses. So the
// shortcut cannot win: Esc in a reply box would close the thread instead of leaving the box.
// The channel's own box needs the same while a thread is open (found with the keys that cross
// between the two boxes: the event never reached the window, so Esc did nothing there).
// Intercept it first, in the capture phase, but only where the host would otherwise swallow
// it, and leave edit-cancel and open completion menus alone. A second Esc, from the pane's
// message list, then closes the thread as usual.
import { MAIN, POPUP, SCROLLER, SIDE } from "./constants";
import { escape } from "./box";
import { isEditable } from "./dom";
import { clearPending, set, state } from "./state";

export const onEscapeCapture = (event: KeyboardEvent) => {
  const el = event.target as Element;
  if (event.key !== "Escape" || !state.enabled || event.defaultPrevented) return;
  if (event.isComposing || event.keyCode === 229) return;
  // A pending g, y, z or count is Esc's to cancel wherever the focus is. The host's own handlers take Esc in places (the app's main
  // region, a pane) before the dispatcher the shortcut service uses sees it, so the shortcut alone would leave the g pending and
  // `g` Esc `p` would open Settings. This only clears the plugin's own state: the event is not consumed, the host keeps its Esc.
  // (In a box the pending d, f or g is dealt with by escape() below, which also decides what Esc does to the mode.)
  if (!isEditable(el)) clearPending();
  if (!el.closest?.(`${SIDE}, ${MAIN}`)) return;
  if (!isEditable(el)) {
    // In a message list Esc does nothing in NORMAL. The host would close a thread's tab here; q and
    // the leader's q do that instead. Only the list itself: a menu, a button or a link keeps its Esc.
    if (!el.matches?.(SCROLLER) || el.closest(POPUP)) return;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (
    el.closest("form[data-editing]") ||
    el.hasAttribute("aria-activedescendant") ||
    el.getAttribute("aria-expanded") === "true"
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  escape();
};

// A click moves the caret by itself, so the mode's own cursor no longer applies.
export const onPointerDown = () => {
  if (state.visual) set({ visual: "" });
};
