// ---- Moving focus between regions [DOM] -------------------------------------------------
import { SIDEBAR_ROW } from "./constants";
import { ctx } from "./ctx";
import { clearCursors, cursors, landAtEnd, moveCursor, nearestVisible, selectRow } from "./cursor";
import {
  afterLayout,
  channelRows,
  clamp,
  focusEl,
  inComposer,
  isEditable,
  selectedRow,
  settle,
  timelineOf,
} from "./dom";
import { openCommunityPicker } from "./communities";
import { disposed, keyEpoch, set, state, takeCount } from "./state";
import type { Region } from "./types";

// [API] Open a channel through ctx.navigation, asking the host not to move focus into the
// message box. Clicking the sidebar row does the same job but the host then focuses the
// composer, which would throw a vim user into insert mode. Resolves true once it opened.
const openChannel = async (row: HTMLElement) => {
  const { status, viewer, origin } = ctx.relay.snapshot();
  if (status === "ready" && viewer && origin) {
    try {
      const result = await ctx.navigation.open(
        {
          version: 1,
          kind: "conversation",
          scope: { viewer, communityOrigin: origin },
          channelId: row.dataset.channelId as string,
        },
        { focus: "preserve" },
      );
      if (result.status === "opened") return true;
    } catch {}
  }
  row.click(); // what a pointer does; the host may move focus
  return false;
};
const REGIONS: Region[] = ["sidebar", "main", "side"];
export const available = (region: Region) => (region === "sidebar" ? channelRows().length > 0 : !!timelineOf(region));
// Moving into a message pane marks a row in it: the row it already had, else the oldest row on
// screen in a thread and the newest in the channel. Without this the pane you arrive in would
// show nothing at all until the first j or k. A pane that is opened on purpose (`o`) lands at its
// end instead: scrolled to the bottom, the newest message marked. A key pressed while it lands
// ends the landing, and the pane then gets the mark it would have had, unless another key comes
// before the pane has a row to mark: a thread closed (q) and opened again at once has a new
// list, which that landing's mark would take, and the new landing would find its pane taken.
const ensureCursor = async (pane: "main" | "side", atEnd: boolean) => {
  if (cursors[pane]) return;
  if (atEnd && (await landAtEnd(pane))) return;
  const epoch = keyEpoch;
  const row = await settle(() => {
    const scroller = timelineOf(pane);
    return scroller && nearestVisible(scroller, pane === "main");
  }, 1000);
  if (row && !cursors[pane] && !disposed && (!atEnd || keyEpoch === epoch)) selectRow(row);
};
export const goRegion = (region: Region, atEnd = false) => {
  const was = document.activeElement;
  if (isEditable(was) && inComposer(was)) {
    // Leaving the box by this route too: no selection may stay in it (see leaveBox).
    document.getSelection()?.removeAllRanges();
    set({ textMode: "insert", visual: "" });
  }
  if (region === "sidebar") {
    const rows = channelRows();
    focusEl(
      rows.includes(document.activeElement as HTMLElement) ? (document.activeElement as HTMLElement) : (selectedRow() ?? rows[0]),
    );
  } else focusEl(timelineOf(region));
  set({ region });
  if (region !== "sidebar") void ensureCursor(region, atEnd);
};
export const shiftRegion = (direction: number) => {
  const order = REGIONS.filter(available);
  // A region that has gone away (a closed thread) counts as the message list.
  const from = order.includes(state.region) ? order.indexOf(state.region) : order.indexOf("main");
  const next = order[clamp(from + direction, 0, order.length - 1)];
  if (!next || next === state.region) {
    // `h` at the left edge goes one further left: the community switcher.
    if (direction < 0 && from <= 0) void openCommunityPicker();
    return;
  }
  const row = document.activeElement;
  // Leaving the sidebar with `l` opens the focused channel, like Enter would.
  if (state.region === "sidebar" && direction > 0 && row?.matches?.(SIDEBAR_ROW)) {
    const opened = row.getAttribute("aria-current") === "page" ? Promise.resolve() : openChannel(row as HTMLElement);
    // The new channel's timeline mounts once navigation settles.
    void opened.then(() => afterLayout(() => goRegion("main")));
    return;
  }
  goRegion(next);
};
const moveSidebar = (steps: number) => {
  const rows = channelRows();
  if (!rows.length) return;
  const base = rows.includes(document.activeElement as HTMLElement)
    ? rows.indexOf(document.activeElement as HTMLElement)
    : rows.indexOf(selectedRow() as HTMLElement);
  focusEl(rows[clamp(base < 0 ? 0 : base + steps, 0, rows.length - 1)]);
  set({ region: "sidebar" });
};
export const step = (direction: number) => {
  const n = takeCount() * direction;
  if (state.region === "sidebar") moveSidebar(n);
  else moveCursor(n);
};
// ]/[ switch channel without leaving the message list.
export const switchChannel = (direction: number) => {
  const rows = channelRows();
  const at = rows.indexOf(selectedRow() as HTMLElement);
  const row = rows[clamp(at + direction * takeCount(), 0, rows.length - 1)];
  if (!row || row === rows[at]) return;
  clearCursors();
  void openChannel(row).then(() => afterLayout(() => state.region === "main" && goRegion("main")));
};
