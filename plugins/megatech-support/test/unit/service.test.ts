import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/support/types";
import { world } from "./world";

const asked = (w: ReturnType<typeof world>) => w.fake.log.length;

describe("the support calls", () => {
  it("make no request until the identity is verified", async () => {
    const w = world();
    for (const call of [() => w.support.askOrOpen("hi"), () => w.support.open("s", "b"), () => w.support.list(), () => w.support.detail("T-1"), () => w.support.status("T-1")])
      await expect(call()).rejects.toMatchObject({ kind: "no-session" });
    expect(w.fake.log).toEqual([]);
  });

  it("make no request with a session whose time has passed, though the page has not noticed yet", async () => {
    const w = world();
    await w.identity.verify();
    w.clock.t += 3_700_000;
    // The identity's own timer has not fired (no timer ran): the state still says verified, but the session is over.
    expect(w.identity.state().status).toBe("verified");
    const before = asked(w);
    await expect(w.support.list()).rejects.toMatchObject({ kind: "no-session" });
    expect(asked(w)).toBe(before);
  });

  it("refuse text that is blank or too long without a request", async () => {
    const w = world();
    await w.identity.verify();
    const before = asked(w);
    for (const question of ["", "   ", "x".repeat(LIMITS.question + 1)]) await expect(w.support.askOrOpen(question)).rejects.toMatchObject({ kind: "invalid" });
    for (const [subject, body] of [["", "b"], ["s", ""], ["  ", "b"], ["s", "  "], ["x".repeat(LIMITS.subject + 1), "b"], ["s", "x".repeat(LIMITS.body + 1)]] as const)
      await expect(w.support.open(subject, body)).rejects.toMatchObject({ kind: "invalid" });
    expect(asked(w)).toBe(before);
  });

  it("send the text trimmed, and take the longest allowed", async () => {
    const w = await (async () => {
      const w = world();
      await w.identity.verify();
      return w;
    })();
    await w.support.askOrOpen("  hello there  ");
    expect((w.fake.log.at(-1) as { body: unknown }).body).toEqual({ question: "hello there" });
    await expect(w.support.askOrOpen("x".repeat(LIMITS.question))).resolves.toMatchObject({ ticket_id: expect.any(String) });
    await w.support.open("  subject  ", "  body  ");
    expect((w.fake.log.at(-1) as { body: unknown }).body).toEqual({ subject: "subject", body: "body" });
    await expect(w.support.open("x".repeat(LIMITS.subject), "x".repeat(LIMITS.body))).resolves.toMatchObject({ status: "open" });
  });

  it("answer a status from the ticket's own record", async () => {
    const w = world();
    await w.identity.verify();
    const { ticket_id } = await w.support.askOrOpen("my order is late");
    expect(await w.support.status(ticket_id)).toEqual({ ticket_id, status: "open" });
  });
});

describe("keys that make a retry the same ticket", () => {
  const keysOf = (w: ReturnType<typeof world>, path: string) =>
    (w.fake.log as { path: string; headers: Record<string, string> }[]).filter((entry) => entry.path === path).map((entry) => entry.headers["idempotency-key"]);
  const verified = async () => {
    const w = world();
    await w.identity.verify();
    return w;
  };

  it("keep the key of a question that failed: the retry is the same ticket, and the next fresh ask is a new one", async () => {
    const w = await verified();
    w.fake.fail("/v1/ask", "throw");
    await expect(w.support.askOrOpen("my order is late")).rejects.toMatchObject({ kind: "network" });
    const retry = await w.support.askOrOpen("  my order is late ");
    const again = await w.support.askOrOpen("my order is late");
    const [first, second, third] = keysOf(w, "/v1/ask");
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(third).not.toBe(first);
    expect(again.ticket_id).not.toBe(retry.ticket_id);
    expect(w.fake.ticketsOf(w.user.pubkey)).toHaveLength(2);
  });

  it("are new for other words, so an edited form after a failure is a new ticket, not the old one replayed", async () => {
    const w = await verified();
    w.fake.fail("/v1/tickets", "throw");
    await expect(w.support.open("Printer", "It is on fire")).rejects.toMatchObject({ kind: "network" });
    const edited = await w.support.open("Printer", "It is on fire, and smoking");
    const [first, second] = keysOf(w, "/v1/tickets");
    expect(second).not.toBe(first);
    expect((await w.support.detail(edited.ticket_id)).messages[0]?.text).toBe("It is on fire, and smoking");
  });

  it("keep the key of a ticket that failed, and give the unchanged retry the same ticket", async () => {
    const w = await verified();
    w.fake.fail("/v1/tickets", { status: 503, body: {} });
    await expect(w.support.open("Printer", "It is on fire")).rejects.toMatchObject({ kind: "unavailable" });
    const retry = await w.support.open("Printer", "It is on fire");
    const second = await w.support.open("Printer", "It is on fire");
    const [first, again, third] = keysOf(w, "/v1/tickets");
    expect(again).toBe(first);
    expect(third).not.toBe(first);
    expect(second.ticket_id).not.toBe(retry.ticket_id);
  });

  it("are not reused between a question and a form with the same words", async () => {
    const w = await verified();
    // The question is worded like the form's own memory of itself: only the kind of call keeps the two apart.
    w.fake.fail("/v1/ask", "throw");
    await expect(w.support.askOrOpen("open\u0000Printer\u0000It is on fire")).rejects.toBeDefined();
    w.fake.fail("/v1/tickets", "throw");
    await expect(w.support.open("Printer", "It is on fire")).rejects.toBeDefined();
    expect(keysOf(w, "/v1/ask")[0]).not.toBe(keysOf(w, "/v1/tickets")[0]);
  });

  it("are remembered for a bounded number of unfinished texts", async () => {
    const w = await verified();
    for (let i = 0; i < 60; i++) {
      w.fake.fail("/v1/ask", "throw");
      await expect(w.support.askOrOpen(`question ${i}`)).rejects.toBeDefined();
    }
    // The oldest is forgotten: asking it again is a new key; a recent one still has its key.
    w.fake.fail("/v1/ask", "throw");
    await expect(w.support.askOrOpen("question 0")).rejects.toBeDefined();
    w.fake.fail("/v1/ask", "throw");
    await expect(w.support.askOrOpen("question 59")).rejects.toBeDefined();
    const keys = keysOf(w, "/v1/ask");
    expect(keys[60]).not.toBe(keys[0]);
    expect(keys[61]).toBe(keys[59]);
  });
});
