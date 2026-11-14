// ---- Pages [API] ------------------------------------------------------------------------
// The pages service lists every primary page and navigation.open opens one. What the API does
// not give is where the app shows a page and in what order: that is shell policy (presentation.ts
// and AppShell.tsx: pagePlacement and orderPages), copied here so gt walks the pages the way the
// app lists them, the dock first, from the top, then the sidebar.
import { ctx } from "./ctx";
import type { PageInfo } from "./host-api";
import { clearPending, state } from "./state";

const MESSAGES = "buzz.channels/channels";
const INBOX = "buzz.inbox/inbox";
// The pages the app puts in its dock, whatever they declare; a plugin's page is in the dock when it says so (`dock`, or `topbar` and
// `toolbar`, the names from before the dock), and in the Messages sidebar otherwise. Inbox is always a sidebar row.
const DOCK = [MESSAGES, "buzz.bestie/bestie", "buzz.reminders/reminders", "buzz.agents/agents", "buzz.workflows/workflows"];
// The order of the dock, then of the sidebar; every other page follows by name.
const DOCK_ORDER = ["buzz.bestie/bestie", MESSAGES, "buzz.reminders/reminders"];
const SIDEBAR_ORDER = [MESSAGES, INBOX, "buzz.drafts-and-sent/drafts-sent", "buzz.reminders/reminders", "buzz.bestie/bestie"];
// The letter after a `g` that names a bundled page, by its key and not by what the app calls it: Inbox is titled Activity since Buzz 1.0,
// and `ga` stays Agents.
const LETTERS: Record<string, string> = {
  i: INBOX,
  m: MESSAGES,
  a: "buzz.agents/agents",
  r: "buzz.reminders/reminders",
  w: "buzz.workflows/workflows",
};
const pageName = (page: PageInfo) => (page.key === MESSAGES ? "Messages" : page.title);
const rankIn = (order: string[]) => (page: PageInfo) => {
  const slot = order.indexOf(page.key);
  return slot < 0 ? order.length : slot;
};
const byOrder = (order: string[]) => {
  const rank = rankIn(order);
  return (a: PageInfo, b: PageInfo) => rank(a) - rank(b) || pageName(a).localeCompare(pageName(b), "en") || a.key.localeCompare(b.key, "en");
};
const inDock = (page: PageInfo) =>
  page.key !== INBOX && (DOCK.includes(page.key) || (page.placement !== undefined && page.placement !== "sidebar"));
// The dock top to bottom, as the host orders it: Messages, Reminders, then every other page placed there, by name (the bundled Agents
// and Workflows, and the pages plugins put in it, in between), Bestie first when it is there.
const dock = () => ctx.pages.snapshot().filter((page) => page.primary && inDock(page)).sort(byOrder(DOCK_ORDER));
const pageList = () => {
  const pages = ctx.pages.snapshot().filter((page) => page.primary);
  return [...pages.filter(inDock).sort(byOrder(DOCK_ORDER)), ...pages.filter((page) => !inDock(page)).sort(byOrder(SIDEBAR_ORDER))];
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
  const open = (named?: string) =>
    ctx.navigation.open({ version: 1, kind: "settings", ...(named ? { section: named } : {}), scope });
  // A Buzz that does not take the section (an older one, whose Settings target has no such field, answers "failed", or rejects): Settings
  // still opens, on the section it opens on.
  void (async () => {
    try {
      const result = await open(section);
      if (!section || result.status !== "failed") return;
    } catch {
      if (!section) return;
    }
    await open();
  })().catch(() => {});
};
// The letter after a `g`: t and T walk the pages, s opens Settings, p opens Settings on Manage plugins (a section the
// host's navigation names: `plugins`), a digit opens that entry of the dock (g1 the first, counted from the top; there are
// no more than nine keys), i, m, a, r and w open Inbox (Activity), Messages, Agents, Reminders and Workflows, and any other letter
// picks the page whose name starts with it. Both the lists (through the shortcut service) and the message box's NORMAL mode (its own
// key handler) come here: one NORMAL mode, one set of g keys.
export const goPage = (letter: string) => {
  clearPending();
  if (/^[1-9]$/.test(letter)) {
    const page = dock()[Number(letter) - 1];
    return page ? openPage(page) : undefined;
  }
  if (letter === "t" || letter === "T") return cyclePage(letter === "t" ? 1 : -1);
  if (letter === "s") return openSettings();
  if (letter === "p") return openSettings("plugins");
  const named = LETTERS[letter];
  const claimed = Object.values(LETTERS);
  const page = named
    ? pageList().find((entry) => entry.key === named)
    : pageList().find((entry) => !claimed.includes(entry.key) && pageName(entry).toLowerCase().startsWith(letter));
  if (page) openPage(page);
};
// The letters the message box takes after a g (the others are its own gg, ge and gE).
export const PAGE_KEYS = "imarwvtTsp123456789";
// Keys already bound for something else call this first when `g` is pending.
export const afterG = (letter: string, run: () => unknown) => () => (state.operator === "g" ? goPage(letter) : run());
