// ---- The leader key [DOM] ---------------------------------------------------------------
// A prefix for the pane commands that must work from anywhere: inside the message box every plain
// key is a text command, so `h` `l` `q` `<` `>` cannot be the pane keys there. Leader then h or l
// moves between panes (from a message box to the next pane's box, from a list to its list), q
// closes the thread, < > | = resize the thread pane. Our own capture-phase listener, ahead of the
// others, so it sees the keys before the editor, the shortcut service or the host's tab handling.
// A chord leader (Ctrl-...) cannot be typing, so it also works in INSERT; a plain one (Space,
// comma) works only where plain keys are ours: the message list, the channel list, a NORMAL box.
import { apple, LEADERS, SCROLLER, SIDEBAR_ROW } from "./constants";
import { contextOk, inComposer, isEditable, timelineOf } from "./dom";
import { enterBox, otherBox } from "./box";
import { isHelpOpen } from "./help";
import { shiftRegion } from "./panes";
import { armPending, bumpKeyEpoch, clearPending, set, state } from "./state";
import { closeThread, resizePane } from "./threads";

export const leaderSpec = () => LEADERS[state.leader] ?? LEADERS[apple ? "ctrl-w" : "space"];
const isLeader = (event: KeyboardEvent) => {
  const spec = leaderSpec();
  if (event.metaKey || event.altKey || event.ctrlKey !== !!spec.ctrl) return false;
  return spec.ctrl ? event.key.toLowerCase() === spec.key : event.key === spec.key;
};
const leaderHere = (el: Element | null) => {
  if (leaderSpec().ctrl) return true;
  if (!timelineOf("main")) return false; // not on the Messages page: Space keeps scrolling
  if (!el || el === document.body) return true;
  if (isEditable(el)) return inComposer(el) && state.composerNormal && state.textMode === "normal";
  return el.matches(SCROLLER) || el.matches(SIDEBAR_ROW);
};
// In a message box, h and l both mean "the other pane's box"; with no other pane they fall back to
// moving between the panes as in the lists (h from the channel's box reaches the channel list).
const leaderPane = (direction: number) => {
  clearPending();
  const inBox = isEditable(document.activeElement) && inComposer(document.activeElement);
  const other = inBox ? otherBox() : undefined;
  if (other && enterBox(other, other === "side" ? "start" : "end")) return;
  shiftRegion(direction);
};
const LEADER_THEN: Record<string, () => void> = {
  h: () => leaderPane(-1),
  l: () => leaderPane(1),
  q: () => closeThread(),
  c: () => closeThread(),
  "<": () => void resizePane("narrower"),
  ">": () => void resizePane("wider"),
  "|": () => void resizePane("widest"),
  "=": () => void resizePane("reset"),
};
let leaderUp: string | undefined; // the key whose keyup we also swallow, so a button does not click on the release
export const resetLeader = () => {
  leaderUp = undefined;
};
export const onLeaderKey = (event: KeyboardEvent) => {
  if (!state.enabled || isHelpOpen() || event.isComposing || event.keyCode === 229) return;
  const swallow = () => {
    event.preventDefault();
    event.stopImmediatePropagation();
    leaderUp = event.key;
    bumpKeyEpoch();
  };
  if (state.operator === "leader") {
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return; // a modifier on its way to <, > or |
    swallow();
    const run = event.ctrlKey || event.metaKey || event.altKey ? undefined : LEADER_THEN[event.key];
    if (run) run();
    else clearPending(); // anything else, Esc included, only cancels
    return;
  }
  if (event.repeat || !isLeader(event) || !contextOk() || !leaderHere(event.target as Element)) return;
  swallow();
  set({ operator: "leader" });
  armPending();
};
export const onLeaderKeyUp = (event: KeyboardEvent) => {
  if (leaderUp === undefined || event.key !== leaderUp) return;
  leaderUp = undefined;
  event.preventDefault();
  event.stopImmediatePropagation();
};
