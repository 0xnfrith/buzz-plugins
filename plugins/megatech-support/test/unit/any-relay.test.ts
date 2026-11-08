// The plugin works for anyone with a Buzz key, on any relay. Three things make that true, and each is held here:
//  1. it reads nothing of the relay but the signed-in key, so there is nothing about a relay it could depend on;
//  2. it sends the service nothing but the contract's fields, so the service learns nothing of the relay either;
//  3. the service treats a key it has never seen as a new person: it verifies, it has no tickets, and a refusal always means a failed
//     proof and never "unknown key" (the contract's rule; the fake service carries it out so these tests can show it).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTools } from "../../src/support/agent";
import { createIdentity, hostProver } from "../../src/support/identity";
import { createSupport } from "../../src/support/service";
import { world } from "./world";

const root = join(import.meta.dirname, "../..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

describe("what the plugin reads of the relay", () => {
  const sources = files(join(root, "src")).filter((file) => /\.tsx?$/.test(file) && !file.endsWith("buzz.d.ts"));

  it("is the signed-in key and a way to hear that it changed, in every file of the source", () => {
    for (const path of sources) {
      const text = readFileSync(path, "utf8");
      // `relay.snapshot().viewer` and `relay.subscribe` are the only things done with the relay object. Anything else, a url, a
      // community, a channel, a member list, an event, would be a way to depend on which relay this is.
      expect(text.match(/\brelay\.(?!snapshot\(\)\.viewer\b|subscribe\b)\w+/g) ?? [], `${path} reads something of the relay`).toEqual([]);
      expect(text.match(/\.snapshot\(\)(?!\.viewer\b)/g) ?? [], `${path} reads more of the snapshot than the key`).toEqual([]);
    }
  });

  it("is never taken apart, indexed or kept under another name, which the reads above would not see", () => {
    for (const path of sources) {
      const text = readFileSync(path, "utf8");
      expect(text.match(/[}\]]\s*=\s*(?:\w+\.)*relay\b/g) ?? [], `${path} destructures the relay`).toEqual([]);
      expect(text.match(/\brelay\s*\[/g) ?? [], `${path} indexes the relay`).toEqual([]);
      expect(text.match(/\b\w+\s*=\s*(?:\w+\.)*relay\s*(?:[;,)\n]|$)/g) ?? [], `${path} keeps the relay under another name`).toEqual([]);
    }
  });

  it("is handed to the plugin's own code in one place only: src/index.tsx passes ctx.relay on, and nothing else uses it", () => {
    for (const path of sources) {
      const text = readFileSync(path, "utf8");
      const uses = text.match(/\bctx\.relay\b/g)?.length ?? 0;
      if (path.endsWith("src/index.tsx")) expect(uses, `${path}: every use of ctx.relay is the value of a \`relay:\` property`).toBe(text.match(/\brelay:\s*ctx\.relay\b/g)?.length ?? 0);
      else expect(uses, `${path} uses ctx.relay`).toBe(0);
    }
  });

  it("is the key and nothing else, through a whole session of verifying, asking and listing", async () => {
    const w = world();
    const onRelay = new Set<string | symbol>();
    const onSnapshot = new Set<string | symbol>();
    const real = w.relay.snapshot;
    w.relay.snapshot = (() => new Proxy(real(), { get: (target, key, receiver) => (onSnapshot.add(key), Reflect.get(target, key, receiver)) })) as never;
    // The identity and what uses it are built again here, over a relay that records every property read on it.
    const relay = new Proxy(w.relay, { get: (target, key, receiver) => (onRelay.add(key), Reflect.get(target, key, receiver)) });
    const identity = createIdentity({ client: w.client, relay: relay as never, prove: hostProver(w.host), now: () => w.clock.t });
    const support = createSupport({ client: w.client, identity });
    await identity.verify();
    await support.askOrOpen("how do I reset my password");
    await support.open("a subject", "what happened");
    await support.list();
    support.verifiedKey();
    identity.dispose();
    expect([...onRelay].sort()).toEqual(["snapshot", "subscribe"]);
    expect([...onSnapshot]).toEqual(["viewer"]);
  });
});

describe("what the plugin sends the service", () => {
  // Per call, the whole of the body's field names and the headers that may be present: no relay, community, channel, member or host.
  const BODY: Record<string, string[]> = {
    "POST /v1/identity/challenge": ["pubkey"],
    "POST /v1/identity/verify": ["auth", "challenge", "pubkey"],
    "POST /v1/ask": ["question"],
    "POST /v1/tickets": ["body", "subject"],
  };
  const HEADERS = ["accept", "authorization", "content-type", "idempotency-key"];

  it("is the contract's fields and headers, and an address with no query", async () => {
    const w = world();
    await w.identity.verify();
    const reply = await w.support.askOrOpen("how do I reset my password");
    await w.support.open("a subject", "what happened");
    const [ticket] = await w.support.list();
    await w.support.detail(ticket!.ticket_id);
    w.identity.forget();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reply.ticket_id).toMatch(/^T-/);
    const log = w.fake.log as { method: string; path: string; headers: Record<string, string>; body?: Record<string, unknown> }[];
    // The code, the proof, the ask, the form, the list, the one ticket, and the end of the session.
    expect(log.map((entry) => `${entry.method} ${entry.path.replace(/T-\d+/, "T-n")}`)).toEqual([
      "POST /v1/identity/challenge",
      "POST /v1/identity/verify",
      "POST /v1/ask",
      "POST /v1/tickets",
      "GET /v1/tickets",
      "GET /v1/tickets/T-n",
      "POST /v1/identity/logout",
    ]);
    for (const entry of log) {
      expect(entry.path, "an address with a query").not.toContain("?");
      expect(Object.keys(entry.headers).filter((name) => !HEADERS.includes(name)), `${entry.method} ${entry.path}`).toEqual([]);
      const allowed = BODY[`${entry.method} ${entry.path}`];
      if (allowed) expect(Object.keys(entry.body ?? {}).sort(), `${entry.method} ${entry.path}`).toEqual(allowed);
      else expect(entry.body, `${entry.method} ${entry.path}`).toBeUndefined();
    }
  });
});

describe("a key the service has never seen", () => {
  it("verifies, has no tickets, and can ask and open one: it is a new person, not a refusal", async () => {
    for (const seed of ["never-seen-1", "never-seen-2", "never-seen-3"]) {
      const w = world({ seed });
      expect(w.fake.ticketsOf(w.user.pubkey)).toEqual([]);
      await w.identity.verify();
      expect(w.identity.state().status).toBe("verified");
      expect(w.fake.lastRefusal).toBeUndefined();
      await expect(w.support.list()).resolves.toEqual([]);
      const asked = await w.support.askOrOpen("a question from somebody the service does not know");
      const opened = await w.support.open("a subject", "what happened");
      await expect(w.support.list()).resolves.toHaveLength(2);
      expect(new Set([asked.ticket_id, opened.ticket_id]).size).toBe(2);
    }
  });

  it("is refused only for a failed proof, which is the one thing that makes a refusal", async () => {
    // The same fresh key, proving a value that is not the hash of its code: refused. Proving the right one: accepted. Nothing about
    // the key itself decides it.
    const w = world({ seed: "never-seen-proof" });
    const { challenge } = await w.client.challenge(w.user.pubkey);
    await expect(w.client.verify(w.user.pubkey, challenge, w.user.authorize(challenge) as never)).rejects.toMatchObject({ kind: "identity-refused" });
    expect(w.fake.lastRefusal).toBe("bad signature");
    await w.identity.verify();
    expect(w.identity.state().status).toBe("verified");
  });

  it("can have its own agent use the tools like anyone's", async () => {
    const w = world({ seed: "never-seen-agent" });
    await w.identity.verify();
    const ask = createTools({ support: w.support, enabled: w.enabled }).find((tool) => tool.name === "megatech_support_ask_or_open")!;
    const answer = JSON.parse(await ask.call({ pubkey: "a".repeat(64), owner: w.user.pubkey }, {}, { question: "how do I reset my password" }));
    expect(answer.ticket_id).toMatch(/^T-/);
  });
});
