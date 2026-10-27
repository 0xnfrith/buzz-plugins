import { BeeperError, type BeeperClient, type Diagnosis } from "../../src/beeper/client";
import type { Chat, Message, Page } from "../../src/beeper/types";
import type { Timers } from "../../src/beeper/store";

export function chat(id: string, patch: Partial<Chat> = {}): Chat {
  return { id, accountID: "acct", network: "Signal", title: `Chat ${id}`, type: "single", unreadCount: 0, lastActivity: "2026-10-24T10:00:00Z", ...patch };
}

export function message(id: string, patch: Partial<Message> = {}): Message {
  return { id, chatID: "c1", senderID: "@them", sortKey: id.padStart(6, "0"), timestamp: "2026-10-24T10:00:00Z", text: `text ${id}`, type: "TEXT", ...patch };
}

/** A promise that settles when the test says so, to put replies in the order a test needs. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => ((resolve = yes), (reject = no)));
  return { promise, resolve, reject };
}

type Script = {
  chats: () => Promise<Chat[]>;
  messages: (chatID: string, cursor?: string) => Promise<Page<Message>>;
  send: (chatID: string, text: string) => Promise<{ chatID: string; pendingMessageID: string }>;
  markRead: (chatID: string) => Promise<void>;
  diagnose: () => Promise<Diagnosis>;
};

/** A client whose answers a test replaces one by one; every call is recorded. */
export function scriptedClient(initial: Partial<Script> = {}) {
  const calls: string[] = [];
  const script: Script = {
    chats: async () => [],
    messages: async () => ({ items: [], hasMore: false }),
    send: async (chatID) => ({ chatID, pendingMessageID: "pending-1" }),
    markRead: async () => {},
    diagnose: async () => "reachable",
    ...initial,
  };
  const client = {
    info: async () => ({ app: { name: "fake", version: "0" } }),
    chats: async () => (calls.push("chats"), { items: await script.chats(), hasMore: false }),
    messages: (chatID: string, cursor?: string) => (calls.push(`messages ${chatID}${cursor ? ` @${cursor}` : ""}`), script.messages(chatID, cursor)),
    send: (chatID: string, text: string) => (calls.push(`send ${chatID} ${text}`), script.send(chatID, text)),
    markRead: (chatID: string) => (calls.push(`markRead ${chatID}`), script.markRead(chatID)),
    diagnose: () => (calls.push("diagnose"), script.diagnose()),
  } satisfies BeeperClient;
  return { client, calls, script };
}

export const fail = (kind: ConstructorParameters<typeof BeeperError>[0]) => async (): Promise<never> => {
  throw new BeeperError(kind);
};

/** Timers a test advances by hand. */
export function manualTimers() {
  const intervals = new Set<{ fn: () => void }>();
  const afters = new Set<{ fn: () => void }>();
  const timers: Timers = {
    every(fn) {
      const entry = { fn };
      intervals.add(entry);
      return () => void intervals.delete(entry);
    },
    after(fn) {
      const entry = { fn };
      afters.add(entry);
      return () => void afters.delete(entry);
    },
  };
  return {
    timers,
    get running() {
      return intervals.size;
    },
    /** One interval tick. */
    tick: () => intervals.forEach((entry) => entry.fn()),
    /** Fires every pending `after`. */
    flushAfter() {
      const due = [...afters];
      afters.clear();
      due.forEach((entry) => entry.fn());
    },
  };
}

/** Lets promises that are already settled run their callbacks. */
export const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};
