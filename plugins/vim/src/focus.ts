// ---- Mode follows focus [DOM] -----------------------------------------------------------
// The host's dispatcher already refuses plain keys while an editable has focus, so "insert
// mode" is simply "an editable is focused" and "normal mode" is everything else. Esc blurs,
// `i` focuses the composer. The flag only drives the indicator.
import { isEditable, regionOf } from "./dom";
import * as perf from "./perf";
import { disposed, set, setQuietly, state } from "./state";

export const syncFocus = perf.timed("syncFocus", () => {
  if (disposed) return; // a timer that outlived the plugin must not touch the page again
  const el = document.activeElement;
  set({
    mode: isEditable(el) && state.textMode === "insert" ? "insert" : "normal",
    visual: isEditable(el) ? state.visual : "",
    region: regionOf(el) ?? state.region,
  });
});
export const onFocusIn = (event: FocusEvent) => {
  if (isEditable(event.target as Element)) setQuietly({ textMode: "insert", visual: "" });
  syncFocus();
};
export const onFocusOut = () => void setTimeout(syncFocus, 0);
