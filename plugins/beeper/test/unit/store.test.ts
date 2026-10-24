import { describe, expect, it } from "vitest";
import { BeeperError } from "../../src/beeper/client";
import { applyFilter, createInbox, listable, mergeMessages } from "../../src/beeper/store";
import { chat, deferred, fail, manualTimers, message, scriptedClient, settle } from "./fake";

function setup(script: Parameters<typeof scriptedClient>[0] = {}, options: { token?: boolean; now?: () => number } = {}) {
  const fake = scriptedClient(script);
  const clock = manualTimers();
  const inbox = createInbox({ client: fake.client, hasToken: () => options.token ?? true, timers: clock.timers, now: options.now });
  return { ...fake, clock, inbox, state: () => inbox.getState() };
}

describe("listable", () => {
  it("leaves out archived chats and merged shells, and puts pinned first, then the latest", () => {
    const chats = [
      chat("old", { lastActivity: "2026-10-01T00:00:00Z" }),
      chat("archived", { isArchived: true }),
      chat("shell", { merge: { chatIDs: ["member"] } }),
      chat("member", { mergedIntoChatID: "shell", lastActivity: "2026-10-23T00:00:00Z" }),
      chat("pinned", { isPinned: true, lastActivity: "2026-09-01T00:00:00Z" }),
      chat("none", { lastActivity: undefined }),
    ];
    expect(listable(chats).map((c) => c.id)).toEqual(["pinned", "member", "old", "none"]);
  });
});

describe("applyFilter", () => {
  const chats = [chat("a", { title: "Alice Example", network: "WhatsApp", unreadCount: 2 }), chat("b", { title: "Bob Sample", network: "Signal" }), chat("c", { title: "Crew", network: "Signal", isMarkedUnread: true })];
  it("matches the title or the network, ignoring case", () => {
    expect(applyFilter(chats, "alice", false).map((c) => c.id)).toEqual(["a"]);
    expect(applyFilter(chats, "SIGNAL", false).map((c) => c.id)).toEqual(["b", "c"]);
    expect(applyFilter(chats, "  ", false)).toHaveLength(3);
  });
  it("keeps unread chats, and chats marked unread, when asked", () => {
    expect(applyFilter(chats, "", true).map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("mergeMessages", () => {
  it("drops reactions, deleted and hidden messages and orders oldest first", () => {
    const merged = mergeMessages(
      [message("2", { timestamp: "2026-10-24T10:02:00Z" }), message("1", { timestamp: "2026-10-24T10:01:00Z" })],
      [message("3", { type: "REACTION" }), message("4", { isDeleted: true }), message("5", { isHidden: true }), message("6", { timestamp: "2026-10-24T10:03:00Z" })],
    );
    expect(merged.map((m) => m.id)).toEqual(["1", "2", "6"]);
  });
  it("lets a newer copy replace an older one (an edit)", () => {
    const merged = mergeMessages([message("1", { text: "before" })], [message("1", { text: "after" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.text).toBe("after");
  });
  it("keeps the old object when nothing about the message changed, and takes the new one when something did", () => {
    const before = message("1", { text: "same" });
    const [kept] = mergeMessages([before], [{ ...before }]);
    expect(kept).toBe(before);
    const [edited] = mergeMessages([before], [{ ...before, text: "different" }]);
    expect(edited).not.toBe(before);
    expect(edited!.text).toBe("different");
  });
  it("breaks a tie in time by sort key, comparing numbers as numbers", () => {
    const same = "2026-10-24T10:00:00Z";
    const merged = mergeMessages([message("a", { sortKey: "100", timestamp: same }), message("b", { sortKey: "99", timestamp: same }), message("c", { sortKey: "1000", timestamp: same })]);
    expect(merged.map((m) => m.id)).toEqual(["b", "a", "c"]);
  });
});

describe("connection", () => {
  it("loads the chats and is ready, with the first row highlighted", async () => {
    const { inbox, state } = setup({ chats: async () => [chat("a"), chat("b", { lastActivity: "2026-10-24T11:00:00Z" })] });
    expect(state().connection).toBe("checking");
    inbox.start();
    await settle();
    expect(state().connection).toBe("ready");
    expect(state().list.map((c) => c.id)).toEqual(["b", "a"]);
    expect(state().cursorId).toBe("b");
  });

  it("keeps the old chat object across polls when nothing about it changed", async () => {
    const { inbox, state, clock } = setup({ chats: async () => [chat("a"), chat("b", { unreadCount: 1 })] });
    inbox.start();
    await settle();
    const first = state().chats;
    clock.tick();
    await settle();
    expect(state().chats[0]).toBe(first[0]);
    expect(state().chats[1]).toBe(first[1]);
  });

  it("asks for a token without calling Beeper when none is saved", async () => {
    const { inbox, state, calls } = setup({}, { token: false });
    inbox.start();
    await settle();
    expect(state().connection).toBe("no-token");
    expect(calls).toEqual([]);
  });

  it("tells Beeper being closed from curl being missing from a Beeper that answered badly", async () => {
    for (const [found, expected] of [["unreachable", "unavailable"], ["curl-missing", "curl-missing"], ["reachable", "error"]] as const) {
      const { inbox, state } = setup({ chats: fail("unreachable"), diagnose: async () => found });
      inbox.start();
      await settle();
      expect(state().connection, found).toBe(expected);
      if (expected === "error") expect(state().problem).toMatch(/too slow or too large/);
    }
  });

  it("maps a rejected token and a missing permission", async () => {
    for (const [kind, expected] of [["unauthorized", "unauthorized"], ["forbidden", "forbidden"], ["server", "error"], ["bad-reply", "error"]] as const) {
      const { inbox, state } = setup({ chats: fail(kind) });
      inbox.start();
      await settle();
      expect(state().connection, kind).toBe(expected);
    }
  });

  it("keeps showing the chats through one missed answer, and gives up on the second", async () => {
    let up = true;
    const { inbox, state, clock } = setup({
      chats: async () => {
        if (!up) throw new (await import("../../src/beeper/client")).BeeperError("unreachable");
        return [chat("a")];
      },
      diagnose: async () => "unreachable",
    });
    inbox.start();
    await settle();
    expect(state().connection).toBe("ready");
    up = false;
    clock.tick();
    await settle();
    expect(state().connection).toBe("ready");
    expect(state().stale).toBe(true);
    expect(state().list).toHaveLength(1);
    clock.tick();
    await settle();
    expect(state().connection).toBe("unavailable");
    up = true;
    clock.tick();
    await settle();
    clock.tick();
    await settle();
    expect(state().connection).toBe("ready");
    expect(state().stale).toBe(false);
  });

  it("starts over, and ignores a late answer, when the token or address changes", async () => {
    const late = deferred<ReturnType<typeof chat>[]>();
    let calls = 0;
    const { inbox, state } = setup({ chats: () => (calls++ === 0 ? late.promise : Promise.resolve([chat("new")])) });
    inbox.start();
    inbox.reset();
    await settle();
    expect(state().list.map((c) => c.id)).toEqual(["new"]);
    late.resolve([chat("old")]);
    await settle();
    expect(state().list.map((c) => c.id)).toEqual(["new"]);
  });
});

describe("the list", () => {
  const chats = [chat("a", { title: "Alice", lastActivity: "2026-10-24T12:00:00Z" }), chat("b", { title: "Bob", lastActivity: "2026-10-24T11:00:00Z" }), chat("c", { title: "Carol", lastActivity: "2026-10-24T10:00:00Z" })];

  it("moves the highlight and stops at the ends", async () => {
    const { inbox, state } = setup({ chats: async () => chats });
    inbox.start();
    await settle();
    inbox.moveCursor(1);
    inbox.moveCursor(1);
    inbox.moveCursor(1);
    expect(state().cursorId).toBe("c");
    inbox.moveCursor(-5);
    expect(state().cursorId).toBe("a");
  });

  it("keeps the highlight on the same chat when the order changes", async () => {
    let order = chats;
    const { inbox, state, clock } = setup({ chats: async () => order });
    inbox.start();
    await settle();
    inbox.moveCursor(1);
    expect(state().cursorId).toBe("b");
    order = [{ ...chats[2]!, lastActivity: "2026-10-24T13:00:00Z" }, chats[0]!, chats[1]!];
    clock.tick();
    await settle();
    expect(state().list.map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(state().cursorId).toBe("b");
  });

  it("filters, and keeps the highlight on a row that is still shown", async () => {
    const { inbox, state } = setup({ chats: async () => chats });
    inbox.start();
    await settle();
    inbox.moveCursor(2);
    inbox.setFilter("bo");
    expect(state().list.map((c) => c.id)).toEqual(["b"]);
    expect(state().cursorId).toBe("b");
    inbox.setFilter("zzz");
    expect(state().cursorId).toBeUndefined();
    inbox.setFilter("");
    expect(state().list).toHaveLength(3);
    expect(state().cursorId).toBeDefined();
  });
});

describe("an open chat", () => {
  const unread = chat("c1", { unreadCount: 2 });
  const thread = [message("1", { timestamp: "2026-10-24T10:01:00Z" }), message("2", { timestamp: "2026-10-24T10:02:00Z" })];

  it("reads the messages and marks the chat read", async () => {
    const { inbox, state, calls } = setup({ chats: async () => [unread], messages: async () => ({ items: [...thread].reverse(), hasMore: false }) });
    inbox.start();
    await settle();
    await inbox.open("c1");
    expect(state().openId).toBe("c1");
    expect(state().thread!.items.map((m) => m.id)).toEqual(["1", "2"]);
    expect(calls).toContain("markRead c1");
    expect(state().list[0]!.unreadCount).toBe(0);
  });

  it("does not mark a read chat read, nor a chat while the page is hidden", async () => {
    const { inbox, calls } = setup({ chats: async () => [chat("c1"), chat("c2", { unreadCount: 1 })], messages: async () => ({ items: thread }) });
    inbox.start();
    await settle();
    await inbox.open("c1");
    inbox.setActive(false);
    await inbox.open("c2");
    expect(calls.filter((c) => c.startsWith("markRead"))).toEqual([]);
  });

  it("ignores messages that arrive after another chat was opened", async () => {
    const slow = deferred<{ items: ReturnType<typeof message>[]; hasMore: boolean }>();
    const { inbox, state } = setup({
      chats: async () => [chat("c1"), chat("c2")],
      messages: (chatID) => (chatID === "c1" ? slow.promise : Promise.resolve({ items: [message("x", { chatID: "c2" })], hasMore: false })),
    });
    inbox.start();
    await settle();
    const first = inbox.open("c1");
    await inbox.open("c2");
    slow.resolve({ items: [message("stale", { chatID: "c1" })], hasMore: false });
    await first;
    expect(state().openId).toBe("c2");
    expect(state().thread!.items.map((m) => m.id)).toEqual(["x"]);
  });

  it("pages back through older messages, and a poll does not forget how far", async () => {
    const pages: Record<string, { items: ReturnType<typeof message>[]; hasMore: boolean; oldestCursor: string }> = {
      first: { items: [message("5", { timestamp: "2026-10-24T10:05:00Z" }), message("4", { timestamp: "2026-10-24T10:04:00Z" })], hasMore: true, oldestCursor: "p2" },
      p2: { items: [message("3", { timestamp: "2026-10-24T10:03:00Z" }), message("2", { timestamp: "2026-10-24T10:02:00Z" })], hasMore: false, oldestCursor: "p3" },
    };
    const { inbox, state, clock, calls } = setup({ chats: async () => [chat("c1")], messages: async (_id, cursor) => pages[cursor ?? "first"]! });
    inbox.start();
    await settle();
    await inbox.open("c1");
    expect(state().thread!.hasMore).toBe(true);
    clock.tick();
    await settle();
    expect(state().thread!.hasMore).toBe(true);
    await inbox.loadEarlier();
    expect(state().thread!.items.map((m) => m.id)).toEqual(["2", "3", "4", "5"]);
    expect(state().thread!.hasMore).toBe(false);
    expect(calls).toContain("messages c1 @p2");
    clock.tick();
    await settle();
    expect(state().thread!.items).toHaveLength(4);
  });

  it("reports a chat that could not be read, and keeps what it had", async () => {
    let ok = true;
    const { inbox, state, clock } = setup({
      chats: async () => [chat("c1")],
      messages: async () => {
        if (!ok) throw new (await import("../../src/beeper/client")).BeeperError("not-found");
        return { items: thread };
      },
    });
    inbox.start();
    await settle();
    await inbox.open("c1");
    ok = false;
    clock.tick();
    await settle();
    expect(state().thread!.failed).toBe(true);
    expect(state().thread!.items).toHaveLength(2);
    expect(state().connection).toBe("ready");
  });

  it("closes", async () => {
    const { inbox, state } = setup({ chats: async () => [chat("c1")], messages: async () => ({ items: thread }) });
    inbox.start();
    await settle();
    await inbox.open("c1");
    inbox.close();
    expect(state().openId).toBeUndefined();
    expect(state().thread).toBeUndefined();
  });
});

describe("sending", () => {
  const opened = async (script: Parameters<typeof scriptedClient>[0] = {}, now = () => 1_000_000) => {
    const world = setup({ chats: async () => [chat("c1")], messages: async () => ({ items: [message("1")] }), ...script }, { now });
    world.inbox.start();
    await settle();
    await world.inbox.open("c1");
    return world;
  };

  it("shows the message as sending, then sent, then drops it when the chat lists it", async () => {
    let listed: ReturnType<typeof message>[] = [message("1")];
    const { inbox, state, clock, calls } = await opened({ messages: async () => ({ items: listed }), send: async (chatID) => ({ chatID, pendingMessageID: "pending-9" }) });
    const sending = inbox.send("hello there  \n");
    expect(state().pending.map((p) => [p.text, p.status])).toEqual([["hello there", "sending"]]);
    await sending;
    expect(state().pending[0]!.status).toBe("sent");
    expect(calls).toContain("send c1 hello there");
    // Beeper lists it a moment later, under its own id.
    listed = [message("1"), message("real", { isSender: true, text: "hello there", timestamp: new Date(1_000_500).toISOString() })];
    clock.flushAfter();
    await settle();
    expect(state().pending).toEqual([]);
    expect(state().thread!.items.map((m) => m.id).sort()).toEqual(["1", "real"]);
  });

  it("matches the message by its pending id too", async () => {
    let listed: ReturnType<typeof message>[] = [message("1")];
    const { inbox, state, clock } = await opened({ messages: async () => ({ items: listed }), send: async (chatID) => ({ chatID, pendingMessageID: "pending-9" }) });
    await inbox.send("edited later by the network");
    listed = [message("1"), message("pending-9", { text: "rewritten", isSender: true })];
    clock.flushAfter();
    await settle();
    expect(state().pending).toEqual([]);
  });

  it("does not take someone else's message, or an older one, for the send", async () => {
    let listed: ReturnType<typeof message>[] = [message("1")];
    const { inbox, state, clock } = await opened({ messages: async () => ({ items: listed }) });
    await inbox.send("same words");
    listed = [
      message("1"),
      message("theirs", { isSender: false, text: "same words", timestamp: new Date(1_000_500).toISOString() }),
      message("old", { isSender: true, text: "same words", timestamp: new Date(900_000).toISOString() }),
    ];
    clock.flushAfter();
    await settle();
    expect(state().pending).toHaveLength(1);
  });

  it("forgets a sent message that never shows up, after a minute", async () => {
    let now = 1_000_000;
    const { inbox, state, clock } = await opened({}, () => now);
    await inbox.send("lost");
    now += 61_000;
    clock.tick();
    await settle();
    expect(state().pending).toEqual([]);
  });

  it("keeps a failed message, with the reason, and sends it again on request", async () => {
    let fails = true;
    const { inbox, state } = await opened({
      send: async (chatID) => {
        if (fails) throw new (await import("../../src/beeper/client")).BeeperError("rejected");
        return { chatID, pendingMessageID: "pending-2" };
      },
    });
    await inbox.send("try me");
    const failed = state().pending[0]!;
    expect(failed).toMatchObject({ status: "failed", text: "try me", error: "Beeper refused the request." });
    fails = false;
    await inbox.retrySend(failed.key);
    expect(state().pending).toHaveLength(1);
    expect(state().pending[0]).toMatchObject({ status: "sent", text: "try me" });
    inbox.dismissSend(state().pending[0]!.key);
    expect(state().pending).toEqual([]);
  });

  it("sends nothing for an empty message or without an open chat", async () => {
    const { inbox, calls } = await opened();
    await inbox.send("   \n ");
    inbox.close();
    await inbox.send("orphan");
    expect(calls.filter((c) => c.startsWith("send"))).toEqual([]);
  });

  it("keeps a send that fails after its chat was left, with that chat, and sends it again to that chat", async () => {
    const slow = deferred<{ chatID: string; pendingMessageID: string }>();
    let first = true;
    const { inbox, state, calls } = await opened({
      chats: async () => [chat("c1"), chat("c2")],
      send: () => (first ? ((first = false), slow.promise) : Promise.resolve({ chatID: "c1", pendingMessageID: "p2" })),
    });
    const sending = inbox.send("late");
    await inbox.open("c2");
    slow.reject(new BeeperError("rejected"));
    await sending;
    expect(state().openId).toBe("c2");
    expect(state().pending).toHaveLength(1);
    expect(state().pending[0]).toMatchObject({ chatID: "c1", status: "failed", text: "late", error: "Beeper refused the request." });
    await inbox.retrySend(state().pending[0]!.key);
    expect(calls.filter((c) => c.startsWith("send"))).toEqual(["send c1 late", "send c1 late"]);
    expect(state().pending[0]).toMatchObject({ chatID: "c1", status: "sent" });
  });

  it("shows a send that is accepted after its chat was left as sent, and forgets it after a minute", async () => {
    let now = 1_000_000;
    const slow = deferred<{ chatID: string; pendingMessageID: string }>();
    const { inbox, state, clock } = await opened({ chats: async () => [chat("c1"), chat("c2")], send: () => slow.promise }, () => now);
    const sending = inbox.send("late");
    await inbox.open("c2");
    slow.resolve({ chatID: "c1", pendingMessageID: "p" });
    await sending;
    expect(state().pending[0]).toMatchObject({ chatID: "c1", status: "sent" });
    now += 61_000;
    clock.tick();
    await settle();
    expect(state().pending).toEqual([]);
  });

  it("tells a send that got no answer apart from one that was refused", async () => {
    const { inbox, state } = await opened({ send: fail("unconfirmed") });
    await inbox.send("maybe");
    expect(state().pending[0]!.error).toMatch(/may still have been sent/);
  });

  it("matches each of two identical sends to one listed message", async () => {
    let listed: ReturnType<typeof message>[] = [message("1")];
    const { inbox, state, clock } = await opened({ messages: async () => ({ items: listed }) });
    await inbox.send("same");
    await inbox.send("same");
    listed = [message("1"), message("a", { isSender: true, text: "same", timestamp: new Date(1_000_100).toISOString() })];
    clock.flushAfter();
    await settle();
    expect(state().pending).toHaveLength(1);
    listed = [...listed, message("b", { isSender: true, text: "same", timestamp: new Date(1_000_200).toISOString() })];
    clock.tick();
    await settle();
    expect(state().pending).toEqual([]);
  });
});

describe("polling", () => {
  it("reads an open chat every tick and the list every third, and nothing while hidden", async () => {
    const { inbox, calls, clock } = setup({ chats: async () => [chat("c1")], messages: async () => ({ items: [message("1")] }) });
    inbox.start();
    await settle();
    await inbox.open("c1");
    calls.length = 0;
    for (let i = 0; i < 6; i += 1) {
      clock.tick();
      await settle();
    }
    expect(calls.filter((c) => c.startsWith("messages")).length).toBe(6);
    expect(calls.filter((c) => c === "chats").length).toBe(2);
    calls.length = 0;
    inbox.setActive(false);
    clock.tick();
    await settle();
    expect(calls).toEqual([]);
    inbox.setActive(true);
    await settle();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("reads only the list when no chat is open, and stops when told", async () => {
    const { inbox, calls, clock } = setup({ chats: async () => [chat("c1")] });
    const stop = inbox.start();
    await settle();
    calls.length = 0;
    clock.tick();
    await settle();
    expect(calls).toEqual(["chats"]);
    stop();
    expect(clock.running).toBe(0);
  });

  it("does not start a second read while one is running", async () => {
    const slow = deferred<ReturnType<typeof chat>[]>();
    let n = 0;
    const { inbox, calls, clock } = setup({ chats: () => (n++ === 0 ? Promise.resolve([chat("c1")]) : slow.promise) });
    inbox.start();
    await settle();
    calls.length = 0;
    clock.tick();
    clock.tick();
    clock.tick();
    await settle();
    expect(calls).toEqual(["chats"]);
    slow.resolve([]);
    await settle();
  });
});

describe("what one chat's trouble does not touch", () => {
  const thread = [message("1", { timestamp: "2026-10-24T10:01:00Z" }), message("2", { timestamp: "2026-10-24T10:02:00Z" })];

  it("does not mark a chat read when its messages could not be read, and does when they can", async () => {
    let ok = false;
    const { inbox, state, calls, clock } = setup({
      chats: async () => [chat("c1", { unreadCount: 3 })],
      messages: async () => {
        if (!ok) throw new BeeperError("server");
        return { items: thread };
      },
    });
    inbox.start();
    await settle();
    await inbox.open("c1");
    expect(state().thread!.failed).toBe(true);
    expect(calls.filter((c) => c.startsWith("markRead"))).toEqual([]);
    // The chat list says it is unread again on a later poll: still not marked, nothing is on screen.
    for (let i = 0; i < 3; i += 1) {
      clock.tick();
      await settle();
    }
    expect(calls.filter((c) => c.startsWith("markRead"))).toEqual([]);
    ok = true;
    // The next poll reads the chat; the one after that, which reads the list, finds it unread with its messages on screen.
    for (let i = 0; i < 3; i += 1) {
      clock.tick();
      await settle();
    }
    expect(state().thread!.failed).toBe(false);
    expect(calls.filter((c) => c.startsWith("markRead")).length).toBeGreaterThan(0);
  });

  it("does not mark a chat read from the poll while the page is hidden", async () => {
    const { inbox, calls } = setup({ chats: async () => [chat("c1")], messages: async () => ({ items: thread }) });
    inbox.start();
    await settle();
    await inbox.open("c1");
    inbox.setActive(false);
    const unread = setup({ chats: async () => [chat("c1", { unreadCount: 2 })], messages: async () => ({ items: thread }) });
    unread.inbox.start();
    await settle();
    await unread.inbox.open("c1");
    unread.calls.length = 0;
    unread.inbox.setActive(false);
    await unread.inbox.refresh();
    expect(unread.calls.filter((c) => c.startsWith("markRead"))).toEqual([]);
    expect(calls.filter((c) => c.startsWith("markRead"))).toEqual([]);
  });

  it("marks a chat read once, however many polls see it unread while that is under way", async () => {
    const slow = deferred<void>();
    const { inbox, calls } = setup({ chats: async () => [chat("c1", { unreadCount: 1 })], messages: async () => ({ items: thread }), markRead: () => slow.promise });
    inbox.start();
    await settle();
    const opening = inbox.open("c1");
    await settle();
    await Promise.all([inbox.refresh(), inbox.refresh()]);
    slow.resolve();
    await opening;
    expect(calls.filter((c) => c.startsWith("markRead"))).toHaveLength(1);
  });

  it("keeps the list when one chat's messages keep failing, however often it is polled", async () => {
    const { inbox, state, clock } = setup({
      chats: async () => [chat("c1"), chat("c2")],
      messages: async () => {
        throw new BeeperError("server");
      },
    });
    inbox.start();
    await settle();
    await inbox.open("c1");
    for (let i = 0; i < 12; i += 1) {
      clock.tick();
      await settle();
      expect(state().connection).toBe("ready");
      expect(state().list).toHaveLength(2);
    }
    expect(state().thread!.failed).toBe(true);
  });

  it("does not go from ready to unavailable and back on alternate misses", async () => {
    let answer = 0;
    const { inbox, state, clock } = setup({
      chats: async () => [chat("c1")],
      messages: async () => {
        answer += 1;
        if (answer % 2 === 0) throw new BeeperError("unreachable");
        return { items: thread };
      },
      diagnose: async () => "unreachable",
    });
    inbox.start();
    await settle();
    await inbox.open("c1");
    for (let i = 0; i < 10; i += 1) {
      clock.tick();
      await settle();
      expect(state().connection).toBe("ready");
    }
  });
});

describe("a chat read again after a gap", () => {
  const page = (ids: number[], more: boolean, cursor: string) => ({
    items: ids.map((n) => message(String(n), { timestamp: `2026-10-24T10:${String(n % 60).padStart(2, "0")}:00Z` })).reverse(),
    hasMore: more,
    oldestCursor: cursor,
  });

  it("starts the thread again from the newest page when the page shares nothing with what was read", async () => {
    let next = page([18, 19], true, "a");
    const { inbox, state, clock, calls } = setup({ chats: async () => [chat("c1")], messages: async (_id, cursor) => (cursor ? page([1, 2], false, "z") : next) });
    inbox.start();
    await settle();
    await inbox.open("c1");
    expect(state().thread!.items.map((m) => m.id)).toEqual(["18", "19"]);
    // Many messages arrived while nobody was looking: the newest page does not reach back to the last one read.
    next = page([58, 59], true, "b");
    clock.tick();
    await settle();
    expect(state().thread!.items.map((m) => m.id)).toEqual(["58", "59"]);
    expect(state().thread!.hasMore).toBe(true);
    await inbox.loadEarlier();
    expect(calls).toContain("messages c1 @b");
    expect(calls).not.toContain("messages c1 @a");
  });

  it("keeps the thread when the newest page overlaps it, even if the overlap is only a reaction", async () => {
    let next = { items: [message("3"), message("2")], hasMore: true, oldestCursor: "a" };
    const { inbox, state, clock } = setup({ chats: async () => [chat("c1")], messages: async () => next });
    inbox.start();
    await settle();
    await inbox.open("c1");
    expect(state().thread!.items.map((m) => m.id)).toEqual(["2", "3"]);
    next = { items: [message("5"), message("4"), message("r", { type: "REACTION" })], hasMore: true, oldestCursor: "b" };
    next.items.push(message("3"));
    clock.tick();
    await settle();
    expect(state().thread!.items.map((m) => m.id)).toEqual(["2", "3", "4", "5"]);
  });

  it("drops an answer about earlier messages that was asked before the thread started again", async () => {
    let next = page([18, 19], true, "a");
    const earlier = deferred<ReturnType<typeof page>>();
    const { inbox, state, clock } = setup({ chats: async () => [chat("c1")], messages: (_id, cursor) => (cursor ? earlier.promise : Promise.resolve(next)) });
    inbox.start();
    await settle();
    await inbox.open("c1");
    const asking = inbox.loadEarlier();
    next = page([58, 59], true, "b");
    clock.tick();
    await settle();
    earlier.resolve(page([1, 2], false, "z"));
    await asking;
    expect(state().thread!.items.map((m) => m.id)).toEqual(["58", "59"]);
    expect(state().thread!.loadingEarlier).toBe(false);
  });

  it("forgets how far it paged when another chat is opened", async () => {
    const { inbox, state, calls } = setup({
      chats: async () => [chat("c1"), chat("c2")],
      messages: async (id, cursor) => (id === "c1" ? (cursor ? page([1, 2], false, "z") : page([18, 19], true, "a")) : { items: [message("x", { chatID: "c2" })], hasMore: false }),
    });
    inbox.start();
    await settle();
    await inbox.open("c1");
    await inbox.loadEarlier();
    await inbox.open("c2");
    expect(state().thread!.hasMore).toBe(false);
    await inbox.loadEarlier();
    expect(calls.filter((c) => c.startsWith("messages c2"))).toEqual(["messages c2"]);
  });
});

describe("while the page is not on screen", () => {
  it("does not look at Beeper when the token changes", async () => {
    const { inbox, calls } = setup({ chats: async () => [chat("a")] });
    inbox.reset();
    await settle();
    expect(calls).toEqual([]);
    inbox.start();
    await settle();
    expect(calls).toEqual(["chats"]);
    inbox.reset();
    await settle();
    expect(calls).toEqual(["chats", "chats"]);
  });
});
