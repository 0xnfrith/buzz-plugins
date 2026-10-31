import { describe, expect, it } from "vitest";
import { ERROR_TEXT, SupportError, createClient } from "../../src/support/client";
import { SUPPORT_ORIGIN } from "../../src/support/origin";
import { world } from "./world";

const SECRET_WORDING = /SECRET-(SERVICE|HOST)-WORDING/;

async function verified() {
  const w = world();
  await w.identity.verify();
  return w;
}

describe("the client's words", () => {
  it("are these, word for word: they are what a person reads", () => {
    expect(ERROR_TEXT).toEqual({
      "no-session": "Megatech support is not verified yet. Verify your identity first.",
      "session-ended": "Your Megatech support session has ended. Verify again.",
      "identity-refused": "Megatech support did not accept the identity check.",
      "rate-limited": "Megatech support is busy. Try again in a minute.",
      invalid: "Megatech support could not use that. Check what you wrote and try again.",
      "not-found": "That ticket was not found.",
      network: "Could not reach Megatech support.",
      unavailable: "Megatech support is having trouble right now.",
    });
  });
});

describe("the client", () => {
  it("makes no request before the identity is verified", async () => {
    const w = world();
    await expect(w.client.ask("hello", "k")).rejects.toMatchObject({ kind: "no-session" });
    await expect(w.client.list()).rejects.toMatchObject({ kind: "no-session" });
    expect(w.fake.log).toEqual([]);
  });

  it("sends every request to the one origin, and the session only in the Authorization header", async () => {
    const w = await verified();
    await w.client.ask("how do I reset my password", "k-0");
    await w.client.open("subject", "body", "key-1");
    await w.client.list();
    expect(w.fake.log.length).toBeGreaterThanOrEqual(5);
    expect(new Set(w.fake.log.map((entry: { origin: string }) => entry.origin))).toEqual(new Set([SUPPORT_ORIGIN]));
    const [token] = [...w.fake.sessions.keys()];
    for (const entry of w.fake.log as { path: string; headers: Record<string, string>; body?: unknown }[]) {
      expect(entry.path).not.toContain(token);
      expect(JSON.stringify(entry.body ?? "")).not.toContain(token);
    }
    const authed = (w.fake.log as { path: string; headers: Record<string, string> }[]).filter((entry) => !entry.path.startsWith("/v1/identity"));
    expect(authed.length).toBe(3);
    for (const entry of authed) expect(entry.headers.authorization).toBe(`Bearer ${token}`);
    // The two identity calls carry no credential at all.
    for (const entry of (w.fake.log as { path: string; headers: Record<string, string> }[]).filter((entry) => entry.path.startsWith("/v1/identity")))
      expect(entry.headers.authorization).toBeUndefined();
  });

  it("sends no credential on the identity calls, even when a session is still held", async () => {
    const w = await verified();
    // Verify again, while the first session is alive: the code request and the proof still carry no Authorization.
    await w.identity.verify();
    const identityCalls = (w.fake.log as { path: string; headers: Record<string, string> }[]).filter((entry) => entry.path.startsWith("/v1/identity"));
    expect(identityCalls).toHaveLength(4);
    for (const entry of identityCalls) expect(entry.headers.authorization).toBeUndefined();
  });

  it("returns an answer when the service has one, and only a ticket when it has not", async () => {
    const w = await verified();
    const answered = await w.client.ask("I need a password reset", "k-a");
    expect(answered.answer).toMatch(/reset it from Account/);
    expect(answered.ticket_id).toMatch(/^T-\d+$/);
    const plain = await w.client.ask("my order is late", "k-b");
    expect(plain).toEqual({ ticket_id: expect.stringMatching(/^T-\d+$/) });
    expect("answer" in plain).toBe(false);
  });

  it("sends the same idempotency key for a retry, and the service then makes one ticket", async () => {
    const w = await verified();
    const first = await w.client.open("Printer", "It is on fire", "k-1");
    const retry = await w.client.open("Printer", "It is on fire", "k-1");
    const other = await w.client.open("Printer", "It is on fire", "k-2");
    expect(retry.ticket_id).toBe(first.ticket_id);
    expect(other.ticket_id).not.toBe(first.ticket_id);
    expect(w.fake.ticketsOf(w.user.pubkey)).toHaveLength(2);
  });

  it("lists tickets and reads one with its messages", async () => {
    const w = await verified();
    const { ticket_id } = await w.client.open("Printer", "It is on fire", "k");
    w.fake.reply(w.user.pubkey, ticket_id, "We are sending a fire extinguisher.");
    expect((await w.client.list()).map((t) => t.ticket_id)).toEqual([ticket_id]);
    const detail = await w.client.detail(ticket_id);
    expect(detail.status).toBe("answered");
    expect(detail.messages.map((m) => [m.from, m.text])).toEqual([
      ["you", "It is on fire"],
      ["support", "We are sending a fire extinguisher."],
    ]);
  });

  it("does not put an unsafe ticket id in a path", async () => {
    const w = await verified();
    const before = w.fake.log.length;
    for (const id of ["../v1/tickets", "T-1?x=1", "a b", "", "x".repeat(65), "T-1/messages"])
      await expect(w.client.detail(id)).rejects.toMatchObject({ kind: "invalid" });
    expect(w.fake.log.length).toBe(before);
  });

  it("puts a ticket id in the path in its encoded form", async () => {
    const w = await verified();
    w.fake.fail("/v1/tickets/T%3A1", JSON.stringify({ ticket_id: "T:1", subject: "s", status: "open", updated_at: "2026-01-01T00:00:00Z", messages: [] }));
    await w.client.detail("T:1");
    expect((w.fake.log.at(-1) as { path: string }).path).toBe("/v1/tickets/T%3A1");
  });

  it("refuses a list or a ticket that is larger than the contract allows", async () => {
    const w = await verified();
    const row = (n: number) => ({ ticket_id: `T-${n}`, subject: "s", status: "open", updated_at: "2026-01-01T00:00:00Z" });
    w.fake.fail("/v1/tickets", JSON.stringify({ tickets: Array.from({ length: 201 }, (_, n) => row(n)) }));
    await expect(w.client.list()).rejects.toMatchObject({ kind: "unavailable" });
    w.fake.fail("/v1/tickets", JSON.stringify({ tickets: Array.from({ length: 200 }, (_, n) => row(n)) }));
    await expect(w.client.list()).resolves.toHaveLength(200);
    const message = { from: "you", at: "2026-01-01T00:00:00Z", text: "x" };
    w.fake.fail("/v1/tickets/T-1", JSON.stringify({ ...row(1), messages: Array.from({ length: 501 }, () => message) }));
    await expect(w.client.detail("T-1")).rejects.toMatchObject({ kind: "unavailable" });
    w.fake.fail("/v1/tickets/T-1", JSON.stringify({ ...row(1), messages: Array.from({ length: 500 }, () => message) }));
    await expect(w.client.detail("T-1")).resolves.toMatchObject({ ticket_id: "T-1" });
  });

  it("forgets the session on request", async () => {
    const w = await verified();
    expect(w.client.hasSession()).toBe(true);
    w.client.forget();
    expect(w.client.hasSession()).toBe(false);
    await expect(w.client.list()).rejects.toMatchObject({ kind: "no-session" });
  });

  it("treats a session whose time has passed as no session", async () => {
    const w = await verified();
    w.clock.t += 3_700_000;
    expect(w.client.hasSession()).toBe(false);
  });

  const cases: [string, { status: number; headers?: Record<string, string> } | "throw", keyof typeof ERROR_TEXT][] = [
    ["a 401", { status: 401 }, "session-ended"],
    ["a 429", { status: 429, headers: { "Retry-After": "30" } }, "rate-limited"],
    ["a 422", { status: 422 }, "invalid"],
    ["a 400", { status: 400 }, "invalid"],
    ["a 404", { status: 404 }, "not-found"],
    ["a 500", { status: 500 }, "unavailable"],
    ["a 503", { status: 503 }, "unavailable"],
    ["a 302", { status: 302 }, "unavailable"],
    ["a failure of the host itself", "throw", "network"],
  ];
  for (const [name, reply, kind] of cases)
    it(`answers ${name} with fixed words and none of the service's or host's`, async () => {
      const w = await verified();
      const [token] = [...w.fake.sessions.keys()];
      w.fake.fail("/v1/tickets", reply === "throw" ? "throw" : { status: reply.status, headers: reply.headers ?? {}, body: { error: { code: "x", message: "SECRET-SERVICE-WORDING " + token } } });
      const error = await w.client.list().catch((e) => e);
      expect(error).toBeInstanceOf(SupportError);
      expect(error.kind).toBe(kind);
      expect(error.message).toBe(ERROR_TEXT[kind]);
      expect(error.message).not.toMatch(SECRET_WORDING);
      expect(JSON.stringify(error)).not.toContain(token);
      expect(String(error.stack ?? "")).not.toContain(token);
      expect(w.client.hasSession()).toBe(kind !== "session-ended");
    });

  it("reads the retry time from Retry-After, with a minute when there is none", async () => {
    const w = await verified();
    w.fake.fail("/v1/tickets", { status: 429, headers: { "retry-after": "90" }, body: {} });
    const hint = await w.client.list().catch((e) => e);
    expect(hint.retryAt).toBe(w.clock.t + 90_000);
    w.fake.fail("/v1/tickets", { status: 429, body: {} });
    const none = await w.client.list().catch((e) => e);
    expect(none.retryAt).toBe(w.clock.t + 60_000);
  });

  it("refuses an identity check the service refuses, and keeps no session", async () => {
    const w = world();
    w.fake.refuseVerify = true;
    await expect(w.identity.verify()).rejects.toMatchObject({ kind: "identity-refused" });
    expect(w.client.hasSession()).toBe(false);
  });

  const malformed: [string, string][] = [
    ["not JSON", "<html>oops</html>"],
    ["JSON that is not an object", "[1,2]"],
    ["an empty object", "{}"],
    ["a ticket id with a slash", JSON.stringify({ ticket_id: "T/1" })],
    ["a ticket id that is a number", JSON.stringify({ ticket_id: 7 })],
    ["an answer that is not text", JSON.stringify({ ticket_id: "T-1", answer: { html: "x" } })],
    ["an answer that is far too long", JSON.stringify({ ticket_id: "T-1", answer: "x".repeat(20_001) })],
  ];
  for (const [name, body] of malformed)
    it(`treats a reply of ${name} to ask as the service having trouble`, async () => {
      const w = await verified();
      w.fake.fail("/v1/ask", body);
      await expect(w.client.ask("hi", "k")).rejects.toMatchObject({ kind: "unavailable" });
    });

  it("treats a ticket list that does not fit the contract as the service having trouble", async () => {
    const w = await verified();
    for (const reply of [
      { tickets: "x" },
      { tickets: [{ ticket_id: "T-1", subject: "s", status: "open" }] },
      { tickets: [{ ticket_id: "T-1", subject: "s", status: "<b>open</b>", updated_at: "2026-01-01T00:00:00Z" }] },
      { tickets: [{ ticket_id: "T-1", subject: "s", status: "open", updated_at: "yesterday" }] },
    ]) {
      w.fake.fail("/v1/tickets", JSON.stringify(reply));
      await expect(w.client.list()).rejects.toMatchObject({ kind: "unavailable" });
    }
  });

  it("treats a session or challenge that is not the contract's as the service having trouble", async () => {
    const w = world();
    w.fake.fail("/v1/identity/challenge", JSON.stringify({ challenge: "short", expires_in: 120 }));
    await expect(w.client.challenge(w.user.pubkey)).rejects.toMatchObject({ kind: "unavailable" });
    const { challenge } = await w.client.challenge(w.user.pubkey);
    const auth = ["auth", w.user.pubkey, "", "0".repeat(128)] as const;
    for (const session of ["has a space in it 0123456789", "short", 12345]) {
      w.fake.fail("/v1/identity/verify", JSON.stringify({ session, expires_in: 3600 }));
      await expect(w.client.verify(w.user.pubkey, challenge, auth)).rejects.toMatchObject({ kind: "unavailable" });
    }
    expect(w.client.hasSession()).toBe(false);
  });

  it("makes a client for a given origin", async () => {
    const seen: string[] = [];
    const client = createClient(async (request) => {
      seen.push(request.url);
      return { status: 200, headers: {}, body: JSON.stringify({ challenge: "A".repeat(24), expires_in: 120 }) };
    }, Date.now, "https://example.invalid");
    await client.challenge("a".repeat(64));
    expect(seen).toEqual(["https://example.invalid/v1/identity/challenge"]);
  });
});

describe("a late 401", () => {
  it("does not end a session that replaced the one the request was sent with", async () => {
    const w = world();
    await w.identity.verify();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let slow = true;
    const client = createClient(async (request) => {
      if (request.method === "GET" && slow) {
        slow = false;
        await held;
        return { status: 401, headers: {}, body: "{}" };
      }
      return w.fake.handle(request);
    }, () => w.clock.t);
    const identity = (await import("../../src/support/identity")).createIdentity({
      client,
      relay: w.relay as never,
      prove: (await import("../../src/support/identity")).hostProver(w.host),
      now: () => w.clock.t,
    });
    const { createSupport } = await import("../../src/support/service");
    const support = createSupport({ client, identity });
    await identity.verify();
    const late = support.list();
    // A newer session comes in while the old request is out.
    await identity.verify();
    release();
    await expect(late).rejects.toMatchObject({ kind: "session-ended" });
    expect(client.hasSession()).toBe(true);
    expect(identity.state().status).toBe("verified");
    expect(identity.verified()).toBe(true);
    await expect(support.list()).resolves.toEqual([]);
  });

  it("still ends the session it belongs to", async () => {
    const w = await verified();
    w.fake.sessions.clear();
    await expect(w.support.list()).rejects.toMatchObject({ kind: "session-ended" });
    expect(w.client.hasSession()).toBe(false);
    expect(w.identity.state()).toEqual({ status: "unverified", ended: true });
  });
});

describe("ticket ids", () => {
  it("never include '.' or '..', which would climb out of the tickets address", async () => {
    const w = await verified();
    const before = w.fake.log.length;
    for (const id of [".", "..", ".hidden", "-x", "_x", ":x", "a/b", "a b", "", "x".repeat(65)]) {
      await expect(w.client.detail(id)).rejects.toMatchObject({ kind: "invalid" });
      await expect(w.support.status(id)).rejects.toMatchObject({ kind: "invalid" });
    }
    expect(w.fake.log.length).toBe(before);
    for (const id of ["T-1", "a", "9", "A.b_c:d-e", "x".repeat(64)]) {
      w.fake.fail(`/v1/tickets/${encodeURIComponent(id)}`, JSON.stringify({ ticket_id: id, subject: "s", status: "open", updated_at: "2026-01-01T00:00:00Z", messages: [] }));
      await expect(w.client.detail(id)).resolves.toMatchObject({ ticket_id: id });
    }
  });

  it("are refused in a list or a reply too", async () => {
    const w = await verified();
    for (const ticket_id of [".", ".."]) {
      w.fake.fail("/v1/tickets", JSON.stringify({ tickets: [{ ticket_id, subject: "s", status: "open", updated_at: "2026-01-01T00:00:00Z" }] }));
      await expect(w.client.list()).rejects.toMatchObject({ kind: "unavailable" });
      w.fake.fail("/v1/ask", JSON.stringify({ ticket_id }));
      await expect(w.client.ask("hi", "k")).rejects.toMatchObject({ kind: "unavailable" });
    }
  });
});

describe("what the identity calls say when the service refuses them", () => {
  it("is always that the identity check was not accepted, whatever the status", async () => {
    const w = world();
    for (const status of [400, 401, 403, 404, 409, 413, 422]) {
      w.fake.fail("/v1/identity/challenge", { status, body: {} });
      await expect(w.client.challenge(w.user.pubkey)).rejects.toMatchObject({ kind: "identity-refused" });
    }
    const { challenge } = await w.client.challenge(w.user.pubkey);
    const auth = ["auth", w.user.pubkey, "", "0".repeat(128)] as const;
    for (const status of [400, 401, 403, 404, 409, 413, 422]) {
      w.fake.fail("/v1/identity/verify", { status, body: {} });
      await expect(w.client.verify(w.user.pubkey, challenge, auth)).rejects.toMatchObject({ kind: "identity-refused" });
    }
    w.fake.fail("/v1/identity/challenge", { status: 429, body: {}, headers: { "retry-after": "5" } });
    await expect(w.client.challenge(w.user.pubkey)).rejects.toMatchObject({ kind: "rate-limited" });
    w.fake.fail("/v1/identity/challenge", { status: 502, body: {} });
    await expect(w.client.challenge(w.user.pubkey)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("is still not found and invalid for the calls that have a ticket", async () => {
    const w = await verified();
    w.fake.fail("/v1/tickets", { status: 409, body: {} });
    await expect(w.client.list()).rejects.toMatchObject({ kind: "invalid" });
    await expect(w.client.detail("T-999")).rejects.toMatchObject({ kind: "not-found" });
  });
});

describe("how long a code or a session lasts", () => {
  const bad = [undefined, null, "300", 300.5, 9, 0, -5, NaN, Infinity, { n: 300 }];
  it("is told in whole seconds: a date, or an odd number, is the service having trouble", async () => {
    const w = world();
    for (const value of [...bad, 3601, "2026-10-31T12:05:00Z"]) {
      w.fake.fail("/v1/identity/challenge", JSON.stringify({ challenge: "A".repeat(24), expires_in: value }));
      await expect(w.client.challenge(w.user.pubkey)).rejects.toMatchObject({ kind: "unavailable" });
    }
    w.fake.fail("/v1/identity/challenge", JSON.stringify({ challenge: "A".repeat(24), expires_at: "2026-10-31T12:05:00Z" }));
    await expect(w.client.challenge(w.user.pubkey)).rejects.toMatchObject({ kind: "unavailable" });
    const { challenge } = await w.client.challenge(w.user.pubkey);
    const auth = ["auth", w.user.pubkey, "", "0".repeat(128)] as const;
    for (const value of [...bad, 86_401, "2026-10-31T13:00:00Z"]) {
      w.fake.fail("/v1/identity/verify", JSON.stringify({ session: "s".repeat(24), expires_in: value }));
      await expect(w.client.verify(w.user.pubkey, challenge, auth)).rejects.toMatchObject({ kind: "unavailable" });
    }
    expect(w.client.hasSession()).toBe(false);
  });

  it("is counted from when the answer arrived, so a clock that is wrong changes nothing", async () => {
    // The plugin's clock is a day ahead of the service's: nothing is compared across the two.
    const w = world();
    w.clock.t += 86_400_000;
    await w.identity.verify();
    expect(w.identity.state()).toMatchObject({ status: "verified", expiresAt: w.clock.t + 3_600_000 });
    expect(w.client.hasSession()).toBe(true);
    expect(w.client.sessionExpiresAt()).toBe(w.clock.t + 3_600_000);
  });
});

describe("telling the service the session is over", () => {
  it("sends the session once and drops it here first, and answers nothing", async () => {
    const w = await verified();
    const [token] = [...w.fake.sessions.keys()];
    const pending = w.client.logout();
    expect(w.client.hasSession()).toBe(false);
    await pending;
    const sent = (w.fake.log as { path: string; headers: Record<string, string> }[]).filter((entry) => entry.path === "/v1/identity/logout");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers.authorization).toBe(`Bearer ${token}`);
    await w.client.logout();
    expect((w.fake.log as { path: string }[]).filter((entry) => entry.path === "/v1/identity/logout")).toHaveLength(1);
  });

  it("changes nothing when the service cannot be reached", async () => {
    const w = await verified();
    w.fake.fail("/v1/identity/logout", "throw");
    await expect(w.client.logout()).resolves.toBeUndefined();
    expect(w.client.hasSession()).toBe(false);
  });
});

describe("the question's key", () => {
  it("goes with every ask, and a retry with the same key is the same ticket", async () => {
    const w = await verified();
    const first = await w.client.ask("my order is late", "key-1");
    const retry = await w.client.ask("my order is late, again", "key-1");
    const other = await w.client.ask("my order is late", "key-2");
    expect(retry.ticket_id).toBe(first.ticket_id);
    expect(other.ticket_id).not.toBe(first.ticket_id);
    const keys = (w.fake.log as { path: string; headers: Record<string, string> }[]).filter((entry) => entry.path === "/v1/ask").map((entry) => entry.headers["idempotency-key"]);
    expect(keys).toEqual(["key-1", "key-1", "key-2"]);
  });
});
