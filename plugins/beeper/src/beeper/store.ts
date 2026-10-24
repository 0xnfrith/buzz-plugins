import { BeeperError, type BeeperClient, type ErrorKind } from "./client.ts";
import type { Chat, Message } from "./types.ts";

/** Why the inbox cannot be shown, or that it can. */
export type Connection = "checking" | "ready" | "no-token" | "curl-missing" | "unavailable" | "unauthorized" | "forbidden" | "error";

export type Thread = {
  /** Oldest first, deduplicated; reactions, deleted and hidden messages are left out. */
  items: Message[];
  loading: boolean;
  loadingEarlier: boolean;
  /** The messages could not be read; `items` is whatever was read before. */
  failed: boolean;
  hasMore: boolean;
};

export type PendingSend = {
  key: string;
  /** The chat it was sent to; it stays with that chat when another is opened. */
  chatID: string;
  text: string;
  at: number;
  status: "sending" | "sent" | "failed";
  /** Why a send failed. Fixed text; never the token or anything Beeper sent back. */
  error?: string;
  /** Beeper's id for the message before the network confirms it. */
  pendingMessageID?: string;
};

export type InboxState = {
  connection: Connection;
  /** Beeper did not answer the last time, though it had before: what is shown may be old. */
  stale: boolean;
  /** Fixed text for the `error` connection. */
  problem?: string;
  /** Every chat worth listing, before the filter. */
  chats: Chat[];
  /** `chats` after the filter and the unread switch: what the list shows. */
  list: Chat[];
  /** Beeper has older chats than the ones listed. */
  moreChats: boolean;
  filter: string;
  unreadOnly: boolean;
  /** The highlighted row, which the arrow keys move. */
  cursorId?: string;
  /** The chat shown beside the list. */
  openId?: string;
  thread?: Thread;
  pending: PendingSend[];
};

export type Timers = {
  every(fn: () => void, ms: number): () => void;
  after(fn: () => void, ms: number): () => void;
};

export const realTimers: Timers = {
  every: (fn, ms) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  after: (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

export type InboxOptions = {
  client: BeeperClient;
  hasToken(): boolean;
  timers?: Timers;
  now?: () => number;
};

const TICK_MS = 3000;
/** How long a message Beeper has accepted waits to show up in the chat before it is forgotten. */
const CONFIRM_MS = 60_000;

/** Failures of one request that say Beeper cannot be reached or will not talk to us. Any other failure is about that request alone. */
const CONNECTIVITY: ReadonlySet<ErrorKind> = new Set(["unreachable", "curl-missing", "unauthorized", "forbidden", "no-token"]);

const CONNECTION_OF: Partial<Record<BeeperError["kind"], Connection>> = {
  "no-token": "no-token",
  "curl-missing": "curl-missing",
  unreachable: "unavailable",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
};

const time = (value: string | undefined) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** Pinned first, then the most recent activity. Archived chats and merged shells are not listed. */
export function listable(chats: Chat[]): Chat[] {
  return chats
    .filter((chat) => !chat.isArchived && !chat.merge)
    .map((chat, index) => ({ chat, index }))
    .sort((a, b) => Number(!!b.chat.isPinned) - Number(!!a.chat.isPinned) || time(b.chat.lastActivity) - time(a.chat.lastActivity) || a.index - b.index)
    .map(({ chat }) => chat);
}

export function applyFilter(chats: Chat[], filter: string, unreadOnly: boolean): Chat[] {
  const needle = filter.trim().toLowerCase();
  return chats.filter(
    (chat) => (!unreadOnly || chat.unreadCount > 0 || chat.isMarkedUnread) && (!needle || chat.title.toLowerCase().includes(needle) || chat.network.toLowerCase().includes(needle)),
  );
}

const numeric = /^\d+$/;
function bySortKey(a: string, b: string): number {
  if (numeric.test(a) && numeric.test(b)) return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * What a poll brings is new objects with the same content. Keeping the old object when nothing changed
 * is what lets the page skip drawing a row or a bubble again (it compares objects, not content).
 */
const unchanged = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Oldest first. Reactions, deleted and hidden messages are not shown; a newer copy of a message replaces the older. */
export function mergeMessages(...groups: Message[][]): Message[] {
  const byId = new Map<string, Message>();
  for (const group of groups)
    for (const message of group) {
      const old = byId.get(message.id);
      byId.set(message.id, old && unchanged(old, message) ? old : message);
    }
  return [...byId.values()]
    .filter((message) => message.type !== "REACTION" && !message.isDeleted && !message.isHidden)
    .sort((a, b) => time(a.timestamp) - time(b.timestamp) || bySortKey(a.sortKey, b.sortKey));
}

export function createInbox({ client, hasToken, timers = realTimers, now = Date.now }: InboxOptions) {
  let state: InboxState = { connection: "checking", stale: false, chats: [], list: [], moreChats: false, filter: "", unreadOnly: false, pending: [] };
  const listeners = new Set<() => void>();
  // A reply that arrives after the token changed, or after another chat was opened, belongs to a
  // world that is gone. Each of these counters says which world a request was made in.
  let epoch = 0;
  let openSerial = 0;
  let failures = 0;
  let sendCounter = 0;
  let ticks = 0;
  let busy = false;
  let markingRead = false;
  let active = true;
  let stopTicking: (() => void) | undefined;
  let stopSoon: (() => void) | undefined;
  // Paging of the open chat. Not state: nothing renders them. `cursor` fetches the page before the
  // oldest one loaded; `paged` says the first page has been read, which is what sets `hasMore`.
  let cursor: string | undefined;
  let paged = false;
  // The ids of every message read for the open chat, including the ones that are not shown (reactions, deleted). A poll whose
  // page shares none of them has skipped some messages in between, and the thread starts again from that page.
  const seen = new Set<string>();
  // Counts those restarts and every change of chat, so a "load earlier" that was asked before one is dropped when it answers.
  let pageGeneration = 0;
  let running = false;

  const set = (patch: Partial<InboxState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const relist = (patch: Partial<InboxState> = {}) => {
    const next = { ...state, ...patch };
    const list = applyFilter(next.chats, next.filter, next.unreadOnly);
    let cursorId = next.cursorId;
    if (!list.some((chat) => chat.id === cursorId)) {
      // The highlighted chat left the list (or nothing was highlighted yet): stay near where it was.
      const was = state.list.findIndex((chat) => chat.id === cursorId);
      cursorId = list[Math.min(Math.max(was, 0), list.length - 1)]?.id;
    }
    set({ ...patch, list, cursorId });
  };

  const connectionFailed = async (error: unknown, fromEpoch: number) => {
    if (fromEpoch !== epoch) return;
    const kind = error instanceof BeeperError ? error.kind : "bad-reply";
    let connection: Connection = CONNECTION_OF[kind] ?? "error";
    let problem = error instanceof BeeperError ? error.message : "Something went wrong talking to Beeper.";
    if (kind === "unreachable") {
      // Is Beeper closed, is curl gone, or did Beeper just not answer this one?
      const found = await client.diagnose().catch(() => "unreachable" as const);
      if (fromEpoch !== epoch) return;
      connection = found === "curl-missing" ? "curl-missing" : found === "unreachable" ? "unavailable" : "error";
      if (found === "reachable") problem = "Beeper Desktop is running, but its answer was too slow or too large to use.";
    }
    failures += 1;
    const transient = state.connection === "ready" && (connection === "unavailable" || connection === "error") && failures < 2;
    if (transient) return set({ stale: true });
    set({ connection, stale: false, problem: connection === "error" ? problem : undefined });
  };

  const refreshChats = async () => {
    const mine = epoch;
    if (!hasToken()) return connectionFailed(new BeeperError("no-token"), mine);
    try {
      const { items: fetched, hasMore } = await client.chats();
      if (mine !== epoch) return;
      failures = 0;
      const known = new Map(state.chats.map((chat) => [chat.id, chat]));
      const all = fetched.map((chat) => {
        const old = known.get(chat.id);
        return old && unchanged(old, chat) ? old : chat;
      });
      relist({ chats: listable(all), moreChats: hasMore, connection: "ready", stale: false, problem: undefined });
      const open = state.openId && state.chats.find((chat) => chat.id === state.openId);
      // Marked read only while its messages are on screen: not while they are loading, or failing to load.
      const shown = !!state.thread && !state.thread.loading && !state.thread.failed;
      if (open && open.unreadCount > 0 && active && shown) void markRead(open.id);
    } catch (error) {
      await connectionFailed(error, mine);
    }
  };

  /** Reads the newest page of the open chat. True if it was read and is still the chat being shown. */
  const loadMessages = async (chatID: string, serial: number): Promise<boolean> => {
    const mine = epoch;
    try {
      const page = await client.messages(chatID);
      if (mine !== epoch || serial !== openSerial) return false;
      failures = 0;
      const thread = state.thread;
      // The first read, or a page that shares nothing with what was read before (the window was hidden while many messages came):
      // the thread starts again from this page, so it never has a hole in the middle.
      const fresh = !paged || (seen.size > 0 && !page.items.some((message) => seen.has(message.id)));
      paged = true;
      if (fresh) {
        cursor = page.oldestCursor ?? undefined;
        seen.clear();
        pageGeneration += 1;
      }
      for (const message of page.items) seen.add(message.id);
      set({
        stale: false,
        thread: {
          items: fresh ? mergeMessages(page.items) : mergeMessages(thread?.items ?? [], page.items),
          loading: false,
          loadingEarlier: fresh ? false : (thread?.loadingEarlier ?? false),
          failed: false,
          // A poll only brings the newest page; whether there is more before it was settled when the thread (re)started.
          hasMore: fresh ? !!page.hasMore && !!cursor : (thread?.hasMore ?? false),
        },
      });
      settlePending();
      return true;
    } catch (error) {
      if (mine !== epoch || serial !== openSerial) return false;
      const thread = state.thread;
      set({ thread: { items: thread?.items ?? [], loading: false, loadingEarlier: false, failed: true, hasMore: thread?.hasMore ?? false } });
      // One chat that cannot be read says nothing about Beeper; only a failure to reach it does.
      if (error instanceof BeeperError && CONNECTIVITY.has(error.kind)) await connectionFailed(error, mine);
      return false;
    }
  };

  const markRead = async (chatID: string) => {
    if (markingRead) return;
    markingRead = true;
    const mine = epoch;
    try {
      await client.markRead(chatID);
      if (mine === epoch) {
        // Show it read at once; the next poll confirms it.
        relist({ chats: state.chats.map((chat) => (chat.id === chatID ? { ...chat, unreadCount: 0, isMarkedUnread: false } : chat)) });
      }
    } catch {
      // Marking read is a courtesy: the chat is still open and shown.
    } finally {
      markingRead = false;
    }
  };

  /** Drops the sends that now show up in the open chat, and the ones Beeper took long ago and never listed. */
  const settlePending = () => {
    const items = state.thread?.items ?? [];
    const taken = new Set<string>();
    const pending = state.pending.filter((send) => {
      if (send.status !== "sent") return true;
      if (now() - send.at > CONFIRM_MS) return false;
      if (send.chatID !== state.openId) return true;
      const match = items.find(
        (message) =>
          !taken.has(message.id) &&
          (message.id === send.pendingMessageID || (message.isSender && message.text === send.text && time(message.timestamp) >= send.at - 5000)),
      );
      if (match) taken.add(match.id);
      return !match;
    });
    if (pending.length !== state.pending.length) set({ pending });
  };

  const refreshOpen = async () => {
    if (state.openId) await loadMessages(state.openId, openSerial);
  };

  const tick = async () => {
    if (!active || busy) return;
    busy = true;
    try {
      ticks += 1;
      settlePending();
      if (state.connection === "ready") {
        if (state.openId) await refreshOpen();
        // The list changes less often than a chat being read.
        if (!state.openId || ticks % 3 === 0) await refreshChats();
      } else if (ticks % 2 === 0) {
        await refreshChats();
      }
    } finally {
      busy = false;
    }
  };

  /** Sends `text` to a chat. It shows at once as "sending" and settles when Beeper lists it. */
  async function sendTo(chatID: string, text: string) {
    const body = text.replace(/\s+$/, "");
    if (!body.trim()) return;
    const key = `send-${(sendCounter += 1)}`;
    set({ pending: [...state.pending, { key, chatID, text: body, at: now(), status: "sending" }] });
    const update = (patch: Partial<PendingSend>) => set({ pending: state.pending.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)) });
    const mine = epoch;
    try {
      const result = await client.send(chatID, body);
      if (mine !== epoch) return;
      update({ status: "sent", pendingMessageID: result.pendingMessageID });
      // Beeper lists the message a moment after accepting it.
      if (state.openId === chatID) {
        stopSoon?.();
        stopSoon = timers.after(() => void refreshOpen(), 800);
      }
    } catch (error) {
      if (mine !== epoch) return;
      update({ status: "failed", error: error instanceof BeeperError ? error.message : "The message was not sent." });
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Starts polling; call the returned function to stop. The first look happens at once. */
    start(): () => void {
      running = true;
      void refreshChats();
      stopTicking?.();
      stopTicking = timers.every(() => void tick(), TICK_MS);
      return () => {
        running = false;
        stopTicking?.();
        stopSoon?.();
        stopTicking = stopSoon = undefined;
      };
    },

    /** Whether Buzz is showing the page; nothing is asked of Beeper while it is not. */
    setActive(value: boolean) {
      const was = active;
      active = value;
      if (value && !was) void tick();
    },

    /** Read the list and the open chat now, for the refresh button. */
    async refresh() {
      await refreshChats();
      await refreshOpen();
    },

    /** Check now, for the Try again button. */
    async retry() {
      set({ connection: "checking", stale: false });
      await refreshChats();
    },

    /** A new token or address means a different Beeper: forget everything and look again. */
    reset() {
      epoch += 1;
      openSerial += 1;
      failures = 0;
      cursor = undefined;
      paged = false;
      seen.clear();
      pageGeneration += 1;
      set({ connection: "checking", stale: false, problem: undefined, chats: [], list: [], moreChats: false, cursorId: undefined, openId: undefined, thread: undefined, pending: [] });
      // Nothing is asked of Beeper while the page is not on screen; it looks when it is shown.
      if (running) void refreshChats();
    },

    setFilter: (filter: string) => relist({ filter }),
    setUnreadOnly: (unreadOnly: boolean) => relist({ unreadOnly }),

    moveCursor(delta: number) {
      const { list, cursorId } = state;
      if (!list.length) return;
      const at = list.findIndex((chat) => chat.id === cursorId);
      const next = Math.min(Math.max((at < 0 ? (delta > 0 ? -1 : list.length) : at) + delta, 0), list.length - 1);
      set({ cursorId: list[next]!.id });
    },

    moveCursorTo(chatID: string) {
      if (state.list.some((chat) => chat.id === chatID)) set({ cursorId: chatID });
    },

    async open(chatID: string) {
      if (state.openId === chatID) return;
      openSerial += 1;
      cursor = undefined;
      paged = false;
      seen.clear();
      pageGeneration += 1;
      set({ openId: chatID, cursorId: chatID, thread: { items: [], loading: true, loadingEarlier: false, failed: false, hasMore: false } });
      const chat = state.chats.find((candidate) => candidate.id === chatID);
      const read = await loadMessages(chatID, openSerial);
      // Marked read only once its messages are on screen.
      if (read && chat && (chat.unreadCount > 0 || chat.isMarkedUnread) && active && state.openId === chatID) await markRead(chatID);
    },

    close() {
      openSerial += 1;
      cursor = undefined;
      paged = false;
      seen.clear();
      pageGeneration += 1;
      set({ openId: undefined, thread: undefined });
    },

    async loadEarlier() {
      const thread = state.thread;
      const chatID = state.openId;
      if (!thread || !chatID || !thread.hasMore || thread.loadingEarlier || !cursor) return;
      const serial = openSerial;
      const generation = pageGeneration;
      const mine = epoch;
      set({ thread: { ...thread, loadingEarlier: true } });
      try {
        const page = await client.messages(chatID, cursor);
        if (mine !== epoch || serial !== openSerial || generation !== pageGeneration) return;
        cursor = page.oldestCursor ?? undefined;
        for (const message of page.items) seen.add(message.id);
        const current = state.thread!;
        set({ thread: { ...current, items: mergeMessages(current.items, page.items), loadingEarlier: false, failed: false, hasMore: !!page.hasMore && !!cursor } });
      } catch {
        if (mine !== epoch || serial !== openSerial || generation !== pageGeneration) return;
        set({ thread: { ...state.thread!, loadingEarlier: false, failed: true } });
      }
    },

    /** Sends `text` to the open chat. */
    async send(text: string) {
      if (state.openId) await sendTo(state.openId, text);
    },

    /** Tries a failed send again, to the chat it was for. */
    async retrySend(key: string) {
      const failed = state.pending.find((entry) => entry.key === key && entry.status === "failed");
      if (!failed) return;
      set({ pending: state.pending.filter((entry) => entry.key !== key) });
      await sendTo(failed.chatID, failed.text);
    },
    dismissSend(key: string) {
      set({ pending: state.pending.filter((send) => send.key !== key) });
    },
  };
}

export type Inbox = ReturnType<typeof createInbox>;
