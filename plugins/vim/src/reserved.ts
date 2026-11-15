// ---- The plain keys Buzz reserves [DOM] -------------------------------------------------
// Buzz 1.0 registers the plain keys e, r, t, u and Delete as its own message keys, and its shortcut service (one bubbling keydown
// listener on window) runs no plugin shortcut on a key the host has reserved, even when the host has nothing to act on. So the
// shortcuts this plugin registers for r (reply, and the r of gr) and for t after a g (the next page) never run. This is our own
// capture-phase listener on document, which runs before that service: it takes exactly those two presses, prevents the event, which the
// service then skips (it returns on defaultPrevented), and runs what the registered shortcut would have run. Nothing else is taken:
// plain t, the right arrow, Shift+t, and every key outside a list still reach Buzz, and with Vim keys off this does nothing.
// It leans on that order, which Buzz documents for editors but does not promise to plugins: the test "Buzz's shortcut dispatch order"
// in test/vim.spec.mjs fails the moment a Buzz release changes it.
import { contextOk, isEditable } from "./dom";
import { isHelpOpen } from "./help";
import * as perf from "./perf";
import { nextPage, reply } from "./shortcuts";
import { state } from "./state";

// The service's own test for an open modal (MODAL in src/features/shortcuts/service.ts): no plain-key shortcut runs under one.
const MODAL = 'dialog[open], [aria-modal="true"]';
const replyKey = perf.timed("key reply", reply);
const nextPageKey = perf.timed("key page-next", nextPage);

export const onReservedKey = (event: KeyboardEvent) => {
  // Every other key costs this comparison and nothing more. (The service matches the logical key without its case: Caps Lock makes an R.)
  const { key } = event;
  if (key !== "r" && key !== "R" && key !== "t" && key !== "T") return;
  if (!state.enabled || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  // Exact modifiers, as the service matches a binding with none: Shift+r and Ctrl+r are other keys.
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.getModifierState("AltGraph")) return;
  const run = key === "r" || key === "R" ? replyKey : state.operator === "g" ? nextPageKey : undefined;
  if (!run) return;
  // What the service asks of a plain-key shortcut: nothing editable on the event's path, no modal open, and the shortcut's own `when`.
  if (event.composedPath().some((target) => isEditable(target as Element)) || document.querySelector(MODAL)) return;
  if (isHelpOpen() || !contextOk()) return;
  event.preventDefault();
  // A held key is consumed but runs once, as in the service.
  if (!event.repeat) run();
};
