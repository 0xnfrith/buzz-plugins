// ---- Shortcuts [API] --------------------------------------------------------------------
// Plain keys are legal bindings, and the dispatcher skips editable targets and open dialogs
// on its own. `when` gates on the master switch and on a conversation being on screen.
import { apple } from "./constants";
import { ctx } from "./ctx";
import { escape, pressHostChord, startInsert } from "./box";
import { halfPage, jumpEdge } from "./cursor";
import { contextOk, timelineOf } from "./dom";
import type { Binding, ShortcutDefinition } from "./host-api";
import { openHelp } from "./help";
import { shiftRegion, step, switchChannel } from "./panes";
import { lineScroll } from "./scroll";
import { openCommunityPicker, switchCommunity } from "./communities";
import { afterG, goPage } from "./pages";
import * as perf from "./perf";
import { armPending, clearPending, set, setting, state } from "./state";
import { closeThread, enterOpens, hidePane, openOrFold, openThread, resizePane, rowControl, showPane } from "./threads";

const eligible = () => state.enabled && contextOk();
const ctrl = (letter: string): Binding => (apple ? { key: letter, ctrl: true } : { key: letter, mod: true });

export const registerShortcuts = () => {
  let order = 0;
  const key = (
    id: string,
    title: string,
    binding: Binding,
    run: () => unknown,
    extra: Partial<ShortcutDefinition> = {},
  ) =>
    ctx.shortcuts.register({
      id,
      title,
      binding,
      run: perf.timed(`key ${id}`, run),
      when: perf.timed("eligible", eligible),
      order: (order += 10),
      ...extra,
    });

  key("down", "Next message / channel", { key: "j" }, () => step(1), { repeat: true });
  key("up", "Previous message / channel", { key: "k" }, () => step(-1), { repeat: true });
  key("top", "Go to top (press twice)", { key: "g" }, () => {
    if (state.operator === "g") {
      clearPending();
      return jumpEdge(false);
    }
    set({ operator: "g" });
    armPending();
  });
  key("bottom", "Go to latest", { key: "G", shift: true }, () => jumpEdge(true));
  key("half-down", "Scroll half a page down", ctrl("d"), () => halfPage(1), { repeat: true });
  key("half-up", "Scroll half a page up", ctrl("u"), () => halfPage(-1), { repeat: true });
  key("line-down", "Scroll one line down, the cursor stays", ctrl("e"), () => lineScroll(1), { repeat: true });
  key("line-up", "Scroll one line up, the cursor stays", ctrl("y"), () => lineScroll(-1), { repeat: true });
  key("left", "Focus the region to the left", { key: "h" }, () => shiftRegion(-1));
  key("right", "Focus the region to the right (opens a channel)", { key: "l" }, () => shiftRegion(1));
  key("next-channel", "Next channel", { key: "]" }, () => switchChannel(1));
  key("previous-channel", "Previous channel", { key: "[" }, () => switchChannel(-1));
  key("insert", "Insert: focus the message box", { key: "i" }, afterG("i", () => startInsert()));
  key("insert-after", "Append: focus the message box, after the character under the caret", { key: "a" }, afterG("a", () => startInsert("after")));
  key("append", "Insert at the end of the draft", { key: "A", shift: true }, () => startInsert("end"));
  key("reply", "Reply in a thread to the message under the cursor", { key: "r" }, afterG("r", () => void rowControl("Reply")));
  key("message-menu", "Open the menu of the message under the cursor", { key: "m" }, afterG("m", () => void rowControl("More message actions")));
  key("page-next", "After g: next page", { key: "t" }, () => state.operator === "g" && goPage("t"));
  key("page-previous", "After g: previous page", { key: "T", shift: true }, () => state.operator === "g" && goPage("T"));
  key("page-workflows", "After g: Workflows", { key: "w" }, afterG("w", () => {}));
  key("page-vim", "After g: the Vim mode page (its switches)", { key: "v" }, afterG("v", () => {}));
  key("settings", "After g: open Settings (the host also has Cmd/Ctrl+,)", { key: "s" }, () => state.operator === "g" && goPage("s"));
  key("plugins", "After g: open Settings on Manage plugins", { key: "p" }, () => state.operator === "g" && goPage("p"));
  key("next-community", "Next community", { key: "}", shift: true }, () => void switchCommunity(1));
  key("previous-community", "Previous community", { key: "{", shift: true }, () => void switchCommunity(-1));
  key("communities", "Open the community switcher", { key: "C", shift: true }, () => void openCommunityPicker());
  key(
    "open-thread",
    "Open the thread of the message under the cursor, at its end; in a thread, open or fold the replies to it (after z: show the thread pane)",
    { key: "o" },
    afterG("o", () => (state.operator === "z" ? showPane() : openOrFold())),
  );
  key("open-thread-enter", "Open the thread of the message under the cursor", { key: "Enter" }, () => void openThread(), {
    when: () => eligible() && enterOpens(),
  });
  key("close-thread", "Close the active thread", { key: "q" }, afterG("q", closeThread));
  key("fold", "Fold prefix: zc hides the thread pane, zo shows it", { key: "z" }, afterG("z", () => {
    set({ operator: "z" });
    armPending();
  }));
  key("close-pane", "After z: hide the thread pane", { key: "c" }, afterG("c", () => state.operator === "z" && hidePane()));
  key("pane-wider", "Widen the thread pane", { key: ">", shift: true }, () => void resizePane("wider"), { repeat: true });
  key("pane-narrower", "Narrow the thread pane", { key: "<", shift: true }, () => void resizePane("narrower"), { repeat: true });
  key("pane-widest", "Make the thread pane as wide as it goes", { key: "|", shift: true }, () => void resizePane("widest"));
  key("pane-reset", "Reset the thread pane width", { key: "=" }, () => void resizePane("reset"));
  key("search", "Search this conversation", { key: "/" }, () => {
    // Search this conversation, falling back to Search Buzz.
    if (!pressHostChord("f")) pressHostChord("k");
  });
  key("help", "Show the Vim keys over the page", { key: "?", shift: true }, openHelp);
  // Escape must also work while the message box has focus, where nothing else may fire.
  key("normal", "Normal mode: leave the message box", { key: "Escape" }, escape, {
    allowInEditable: true,
    when: () => state.enabled && !!timelineOf("main"),
  });
  for (const digit of "1234567890")
    key(
      `count-${digit}`,
      `Count prefix ${digit}`,
      { key: digit },
      () => {
        set({ count: Math.min(state.count * 10 + Number(digit), 999) });
        armPending();
      },
      { when: () => eligible() && (digit !== "0" || state.count > 0) },
    );
  // Always eligible, so it can turn Vim keys back on.
  key(
    "toggle",
    "Turn Vim keys on or off",
    { key: "e", mod: true, shift: true },
    () => setting({ enabled: !state.enabled }),
    { when: () => true, allowInEditable: true },
  );
};
