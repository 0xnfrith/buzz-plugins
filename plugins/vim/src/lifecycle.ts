// What the plugin puts on the page while it is applied, and takes off again when the host disposes it (ctx.effect).
import { ctx } from "./ctx";
import { onFocusIn, onFocusOut, syncFocus } from "./focus";
import { cursorStyle, resetCursors, unwatchCursors, watchCursors } from "./cursor";
import { closeHelp, onHelpKey } from "./help";
import { onLeaderKey, onLeaderKeyUp } from "./leader";
import { onMenuKey } from "./menus";
import { onTextKey } from "./normal";
import * as perf from "./perf";
import { onSettingsKey } from "./settings-dialog";
import { bar, renderBar, resetBar } from "./status";
import { dispose, onAnyKey, state, subscribe } from "./state";
import { onEscapeCapture, onPointerDown } from "./escape";
import { onFoldClick } from "./threads";

export const mount = () => {
  resetBar();
  renderBar();
  const stopRender = subscribe(() => renderBar());
  document.head.append(cursorStyle);
  document.body.append(bar);
  watchCursors();
  // How many revisions of this plugin the page has applied and disposed: after an update, applied is one
  // ahead of disposed (a window global, so it survives the update; the trace and the tests read it).
  const revisions = (window.__vimRevisions ??= { applied: 0, disposed: 0 });
  revisions.applied++;
  const undo: (() => void)[] = [];
  const listen = <E extends Event>(type: string, name: string, fn: (event: E) => void) => {
    const wrapped = perf.timed(name, fn) as EventListener;
    document.addEventListener(type, wrapped, true);
    undo.push(() => document.removeEventListener(type, wrapped, true));
  };
  listen("focusin", "onFocusIn", onFocusIn);
  listen("focusout", "onFocusOut", onFocusOut);
  listen("keydown", "onSettingsKey", onSettingsKey);
  listen("keydown", "onLeaderKey", onLeaderKey);
  listen("keyup", "onLeaderKeyUp", onLeaderKeyUp);
  listen("keydown", "onEscapeCapture", onEscapeCapture);
  listen("keydown", "onTextKey", onTextKey);
  listen("keydown", "onMenuKey", onMenuKey);
  listen("keydown", "onAnyKey", onAnyKey);
  listen("keydown", "onHelpKey", onHelpKey);
  listen("pointerdown", "onPointerDown", onPointerDown);
  listen("click", "onFoldClick", onFoldClick);
  // The performance trace follows its setting (the Vim mode page).
  let traced = state.perf;
  perf.start(traced);
  const stopPerf = subscribe(() => {
    if (state.perf === traced) return;
    traced = state.perf;
    perf.start(traced);
  });
  // [API] Page changes can change what is on screen; repaint the indicator then.
  const stopNavigation = ctx.navigation.subscribe(() => setTimeout(syncFocus, 50));
  syncFocus();
  return () => {
    dispose();
    closeHelp();
    stopRender();
    revisions.disposed++;
    stopPerf();
    perf.stop();
    stopNavigation();
    for (const remove of undo) remove();
    delete document.documentElement.dataset.vimDriving;
    for (const menu of document.querySelectorAll("[data-vim-yanking]")) menu.removeAttribute("data-vim-yanking");
    cursorStyle.remove();
    unwatchCursors();
    resetCursors();
    bar.remove();
    resetBar();
    delete bar.dataset.focusVia;
    delete document.documentElement.dataset.vimRegion;
    document.documentElement.removeAttribute("data-vim-on");
    document.documentElement.removeAttribute("data-vim-panes");
    document.documentElement.removeAttribute("data-vim-box");
  };
};
