// ---- Pages [API] ------------------------------------------------------------------------
// The pages service lists every primary page and navigation.open opens one. What the API does
// not give is the order the app shows them in: that is shell policy (AppShell.tsx and
// presentation.ts), copied here so gt walks the pages left to right, top bar first.
import { ctx } from "./ctx";
import type { PageInfo } from "./host-api";
import { clearPending, state } from "./state";

const TOPBAR = ["buzz.channels/channels", "buzz.reminders/reminders", "buzz.agents/agents", "buzz.workflows/workflows"];
const BUNDLED_ORDER = ["buzz.channels/channels", "buzz.inbox/inbox", "buzz.reminders/reminders", "buzz.bestie/bestie"];
const MESSAGES = "buzz.channels/channels";
const pageName = (page: PageInfo) => (page.key === MESSAGES ? "Messages" : page.title);
const pageRank = (page: PageInfo) => {
  const slot = BUNDLED_ORDER.indexOf(page.key);
  return slot < 0 ? BUNDLED_ORDER.length : slot;
};
const byShell = (a: PageInfo, b: PageInfo) =>
  pageRank(a) - pageRank(b) || pageName(a).localeCompare(pageName(b), "en") || a.key.localeCompare(b.key, "en");
const pageList = () => {
  const pages = ctx.pages.snapshot().filter((page) => page.primary);
  const top = (page: PageInfo) => TOPBAR.includes(page.key) || page.placement === "topbar";
  return [...pages.filter(top).sort(byShell), ...pages.filter((page) => !top(page)).sort(byShell)];
};
const openPage = (page: PageInfo) =>
  void ctx.navigation
    .open({ version: 1, kind: "page", pluginId: page.pluginId, pageId: page.id }, { focus: "preserve" })
    .catch(() => {});
const cyclePage = (direction: number) => {
  const pages = pageList();
  if (!pages.length) return;
  const target = ctx.navigation.snapshot().entry?.target;
  // A conversation belongs to the Messages page.
  const key = target?.kind === "page" ? `${target.pluginId}/${target.pageId}` : target?.kind === "conversation" ? MESSAGES : "";
  const here = pages.findIndex((page) => page.key === key);
  const at = here < 0 ? (direction > 0 ? -1 : 0) : here;
  openPage(pages[(at + direction + pages.length) % pages.length]);
};
// [API] Settings is a navigation target, not a page. Like the host's own Cmd/Ctrl+, it opens
// for the community on screen (scope null when there is none, which is Personal space).
const openSettings = (section?: string) => {
  const { status, viewer, origin } = ctx.relay.snapshot();
  const scope = status === "ready" && viewer && origin ? { viewer, communityOrigin: origin } : null;
  void ctx.navigation.open({ version: 1, kind: "settings", ...(section ? { section } : {}), scope }).catch(() => {});
};
// The letter after a `g`: t and T walk the pages, s opens Settings, p opens Settings on Manage plugins (a section the
// host's navigation names: `plugins`), any other letter picks the page whose name starts with it (gi Inbox, gm Messages). Both the lists (through the shortcut service) and
// the message box's NORMAL mode (its own key handler) come here: one NORMAL mode, one set of g keys.
export const goPage = (letter: string) => {
  clearPending();
  if (letter === "t" || letter === "T") return cyclePage(letter === "t" ? 1 : -1);
  if (letter === "s") return openSettings();
  if (letter === "p") return openSettings("plugins");
  const page = pageList().find((entry) => pageName(entry).toLowerCase().startsWith(letter));
  if (page) openPage(page);
};
// The letters the message box takes after a g (the others are its own gg, ge and gE).
export const PAGE_KEYS = "imarwvtTsp";
// Keys already bound for something else call this first when `g` is pending.
export const afterG = (letter: string, run: () => unknown) => () => (state.operator === "g" ? goPage(letter) : run());
