// ---- Communities [DOM] ------------------------------------------------------------------
// No plugin service reaches communities (nothing in the API lists, selects or switches them),
// so the plugin drives the host's own switcher the way a pointer would: click the trigger,
// read the rows, click one. While it does, CSS hides the popover so it does not flash.
import { COMMUNITY_POPUP, COMMUNITY_TRIGGER } from "./constants";
import { channelRows, clamp, focusEl, settle, visible } from "./dom";
import { available, goRegion } from "./panes";
import { clearCursors } from "./cursor";
import { keyEpoch, state, takeCount } from "./state";

const communityTrigger = () => document.querySelector<HTMLElement>(COMMUNITY_TRIGGER);
const communityPopup = () => [...document.querySelectorAll<HTMLElement>(COMMUNITY_POPUP)].find(visible);
const communityRows = (popup: HTMLElement) =>
  [...popup.querySelectorAll<HTMLElement>("button:not([disabled])")].filter(
    (row) => row.matches('[aria-label^="Switch to "]') || row.textContent?.trim() === "Personal space",
  );
// Opens the switcher and puts focus on the current community. The host's own keys then work
// in it (arrows, Home, End, Enter, Esc) and so do j and k (see menus.ts).
export async function openCommunityPicker() {
  const trigger = communityTrigger();
  if (!trigger) return;
  if (!communityPopup()) trigger.click();
  const popup = await settle(communityPopup);
  const rows = popup ? communityRows(popup) : [];
  focusEl(rows.find((row) => row.hasAttribute("aria-current")) ?? rows[0]);
}
let switching = false;
export const resetCommunities = () => {
  switching = false;
};
// `}` and `{` move through Personal space and the communities, in the switcher's own order.
export const switchCommunity = async (direction: number) => {
  const steps = takeCount() * direction;
  const trigger = communityTrigger();
  if (!trigger || switching) return;
  switching = true;
  const root = document.documentElement;
  root.dataset.vimDriving = "";
  const region = state.region;
  const before = trigger.getAttribute("aria-label");
  const oldRows = new Set(channelRows());
  let switched = false;
  try {
    if (!communityPopup()) trigger.click();
    const popup = await settle(communityPopup);
    const rows = popup ? communityRows(popup) : [];
    const at = rows.findIndex((row) => row.hasAttribute("aria-current"));
    const target = rows[clamp(at + steps, 0, rows.length - 1)];
    if (at < 0 || !target || target === rows[at]) {
      // Already at the end of the list: put the popover away and keep the user where they were.
      if (popup) trigger.click();
      await settle(() => !communityPopup());
      if (available(region)) goRegion(region);
      return;
    }
    target.click();
    await settle(() => !communityPopup() && communityTrigger()?.getAttribute("aria-label") !== before);
    clearCursors();
    switched = true;
  } finally {
    delete root.dataset.vimDriving;
    switching = false;
  }
  if (!switched) return;
  // The new community loads its channels a moment later; land in the channel list, unless a
  // key press says the user has already gone somewhere else. The host focuses the message box on
  // its own after a switch, which is why this does not wait for a quiet focus.
  const epoch = keyEpoch;
  const loaded = await settle(() => {
    const first = channelRows()[0];
    return first && !oldRows.has(first);
  }, 5000);
  if (loaded && keyEpoch === epoch) goRegion("sidebar");
};
