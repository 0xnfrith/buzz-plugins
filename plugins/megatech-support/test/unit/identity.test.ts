import { describe, expect, it, vi } from "vitest";
import { ERROR_TEXT, createClient } from "../../src/support/client";
import { CANNOT_CHECK, COULD_NOT_SIGN, DOMAIN, ODD_ANSWER, checkAttestation, createIdentity, derive, hostProver } from "../../src/support/identity";
import { createFakeHost, createUser, derive as serviceDerive } from "../fake-support/server.mjs";
import { flush, world } from "./world";

type Entry = { path: string; body?: Record<string, unknown> };
const calls = (w: ReturnType<typeof world>, path: string) => (w.fake.log as Entry[]).filter((entry) => entry.path === path);
const HEX64 = /^[0-9a-f]{64}$/;

describe("the identity check", () => {
  it("asks Buzz to attest to a hash of the service's code, and gives the service that attestation", async () => {
    const w = world();
    expect(w.identity.state()).toEqual({ status: "unverified" });
    await w.identity.verify();
    expect(w.identity.state().status).toBe("verified");
    expect(w.identity.verified()).toBe(true);
    expect(w.client.hasSession()).toBe(true);
    const [challenge] = [...w.fake.challenges.keys()];
    // Buzz was asked about exactly one value: the hash of the code, in lowercase hex, never the code itself or a key.
    expect(w.host.calls).toEqual([serviceDerive(challenge)]);
    expect(w.host.calls[0]).toMatch(HEX64);
    expect(w.host.calls[0]).not.toBe(challenge);
    expect(w.host.calls[0]).not.toBe(w.user.pubkey);
    // And the service got the attestation Buzz returned, whole, with the key and the code.
    const [verify] = calls(w, "/v1/identity/verify");
    expect(verify?.body).toEqual({ pubkey: w.user.pubkey, challenge, auth: w.host.answers[0] });
    expect(w.host.answers[0]).toEqual(["auth", w.user.pubkey, "", expect.stringMatching(/^[0-9a-f]{128}$/)]);
  });

  it("derives N the way the service does, as a hash of the domain and the code", async () => {
    expect(DOMAIN).toBe("megatech-support:v1:");
    for (const code of ["abc", "A".repeat(32), "x-y_z".repeat(10)]) expect(await derive(code)).toBe(serviceDerive(code));
    expect(await derive("a")).not.toBe(await derive("b"));
    expect(await derive("abc")).toMatch(HEX64);
  });

  describe("a service that tries to choose what Buzz signs", () => {
    // An attestation over a public key the service holds would make that key the user's agent. So the plugin may only ever ask Buzz to
    // sign the hash it derived itself, whatever the service sends as its code and in the fields around it.
    const user = createUser();
    const serviceKey = createUser("a-key-the-service-holds").pubkey as string;
    const codes = {
      "a public key the service holds": serviceKey,
      "the user's own key": user.pubkey as string,
      "a hash that is already the hash the plugin would make": serviceDerive("abcdefghijklmnop"),
      "sixty-four f": "f".repeat(64),
      "a plain code": "abcdefghijklmnopqrstuvwx",
    };

    for (const [name, code] of Object.entries(codes)) {
      it(`signs only the hash it derived, never ${name}, nor any other value the service sent`, async () => {
        const clock = { t: Date.parse("2026-10-31T12:00:00Z") };
        const now = () => clock.t;
        const host = createFakeHost({ user });
        const sent: string[] = [];
        // Fields a hostile service could add to look like instructions: none of them may reach Buzz.
        const extras = { agent: serviceKey, sign: serviceKey, n: "e".repeat(64), pubkey: serviceKey, conditions: "kind=1" };
        const transport = async (request: { url: string }) => {
          const reply =
            new URL(request.url).pathname === "/v1/identity/challenge"
              ? { challenge: code, expires_in: 300, ...extras }
              : { session: "s".repeat(32), expires_in: 3600 };
          for (const value of Object.values(reply)) if (typeof value === "string") sent.push(value);
          return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(reply) };
        };
        const relay = { snapshot: () => ({ viewer: user.pubkey as string }), subscribe: () => () => {} };
        const client = createClient(transport as never, now);
        const identity = createIdentity({ client, relay: relay as never, prove: hostProver(host), now, signWaitMs: 500 });
        await identity.verify();
        expect(identity.state().status).toBe("verified");
        // Exactly one value went to Buzz: sha256("megatech-support:v1:" + code) ...
        expect(host.calls).toEqual([serviceDerive(code)]);
        expect(host.calls[0]).toMatch(HEX64);
        // ... and it is none of the strings the service sent (its code, its look-alike fields, the session).
        expect(sent).toContain(code);
        for (const value of sent) expect(host.calls).not.toContain(value);
      });
    }
  });

  it("asks for the code first, for the signed-in key, and touches nothing else", async () => {
    const w = world();
    await w.identity.verify();
    expect((w.fake.log as Entry[]).map((entry) => entry.path)).toEqual(["/v1/identity/challenge", "/v1/identity/verify"]);
    expect((w.fake.log as Entry[])[0]?.body).toEqual({ pubkey: w.user.pubkey });
  });

  it("starts one check when asked twice", async () => {
    const w = world();
    await Promise.all([w.identity.verify(), w.identity.verify()]);
    expect(w.host.calls).toHaveLength(1);
    expect(calls(w, "/v1/identity/challenge")).toHaveLength(1);
  });

  it("reports its state as it goes", async () => {
    const w = world();
    const seen: string[] = [];
    w.identity.subscribe(() => seen.push(w.identity.state().status));
    await w.identity.verify();
    expect(seen).toEqual(["verifying", "verified"]);
  });

  describe("when Buzz cannot attest, or answers wrongly: the check fails closed", () => {
    const failed = async (w: ReturnType<typeof world>, text: string) => {
      await expect(w.identity.verify()).rejects.toBeDefined();
      expect(w.identity.state()).toEqual({ status: "failed", text });
      expect(w.client.hasSession()).toBe(false);
      expect(w.identity.verified()).toBe(false);
      // Nothing that is not an attestation of the signed-in user went to the service.
      expect(calls(w, "/v1/identity/verify")).toEqual([]);
    };

    it("says so when the host has no such call", async () => {
      const w = world({ missing: true });
      await failed(w, CANNOT_CHECK);
      // It does not even ask the service for a code it could not use, so the service is not sent the key.
      expect(calls(w, "/v1/identity/challenge")).toEqual([]);
      expect(w.fake.log).toEqual([]);
    });

    it("says so when the host fails, and shows none of the host's words", async () => {
      const w = world({ mode: "throw" });
      await failed(w, COULD_NOT_SIGN);
      expect(JSON.stringify(w.identity.state())).not.toContain("SECRET");
    });

    const odd: [string, string][] = [
      ["another key's attestation", "other-owner"],
      ["an attestation with conditions", "conditions"],
      ["a signature that is too short", "short-signature"],
      ["a signature in capitals", "upper-signature"],
      ["a signature that is not hex", "not-hex"],
      ["a tag of three", "three"],
      ["a tag of five", "five"],
      ["a tag that is not 'auth'", "wrong-name"],
      ["an object instead of a tag", "object"],
      ["a string instead of a tag", "string"],
      ["nothing", "null"],
    ];
    for (const [name, mode] of odd)
      it(`refuses ${name} before it reaches the service`, async () => {
        const w = world({ mode });
        await failed(w, ODD_ANSWER);
      });

    it("gives up when the host never answers", async () => {
      const w = world({ mode: "hang", signWaitMs: 40 });
      await failed(w, "Buzz did not sign the identity check in time.");
    });

    it("says so when Buzz has no signed-in key yet, and asks the service nothing", async () => {
      for (const viewer of [null, "not-a-key", "ABC".repeat(21) + "A"]) {
        const w = world({ viewer });
        await expect(w.identity.verify()).rejects.toBeDefined();
        expect(w.identity.state()).toEqual({ status: "failed", text: "Buzz is not signed in yet. Open a community and try again." });
        expect(w.fake.log).toEqual([]);
        expect(w.host.calls).toEqual([]);
      }
    });

    it("refuses a code that is already nearly out of time", async () => {
      const w = world();
      w.fake.fail("/v1/identity/challenge", JSON.stringify({ challenge: "A".repeat(32), expires_in: 10 }));
      await failed(w, "Megatech support sent a code that expires too soon. Try again.");
      expect(w.host.calls).toEqual([]);
    });
  });

  describe("the prover on its own", () => {
    const user = createUser("prover-user");
    const prove = (host: object, viewer = user.pubkey) => hostProver(host)(viewer, "A".repeat(32), new AbortController().signal);

    it("passes a good attestation on, as a new tag", async () => {
      const host = createFakeHost({ user });
      const tag = await prove(host);
      expect(host.calls).toEqual([serviceDerive("A".repeat(32))]);
      expect(tag).toEqual(host.answers[0]);
      expect(tag).not.toBe(host.answers[0]);
    });

    it("fails when the call is not a function, whatever else the host has", async () => {
      for (const host of [{}, { prepareRemoteAgentAuthorization: undefined }, { prepareRemoteAgentAuthorization: "yes" }, { prepareRemoteAgentAuthorization: {} }])
        await expect(prove(host)).rejects.toThrow(CANNOT_CHECK);
    });

    it("hands the signal to the call", async () => {
      const seen: unknown[] = [];
      await prove({ prepareRemoteAgentAuthorization: async (agent: string, signal: unknown) => (seen.push(signal), user.authorize(agent)) });
      expect(seen[0]).toBeInstanceOf(AbortSignal);
    });

    it("checks the owner against the signed-in key it was given", async () => {
      const host = createFakeHost({ user });
      await expect(prove(host, createUser("someone-else").pubkey)).rejects.toThrow(ODD_ANSWER);
    });
  });

  describe("checkAttestation", () => {
    const user = createUser("check-user");
    const good = ["auth", user.pubkey, "", "ab".repeat(64)];
    it("takes the form Buzz makes and nothing else", () => {
      expect(checkAttestation(good, user.pubkey)).toEqual(good);
      for (const bad of [null, undefined, "auth", {}, [], good.slice(0, 3), [...good, "x"], ["x", ...good.slice(1)], ["auth", "f".repeat(64), "", good[3]], ["auth", user.pubkey, " ", good[3]], ["auth", user.pubkey, "", "AB".repeat(64)], ["auth", user.pubkey, "", 5], ["auth", user.pubkey, "", "ab".repeat(63)]])
        expect(() => checkAttestation(bad, user.pubkey)).toThrow(ODD_ANSWER);
    });
  });

  describe("when the service says no", () => {
    it("shows fixed words, and keeps no session", async () => {
      const w = world();
      w.fake.refuseVerify = true;
      await expect(w.identity.verify()).rejects.toBeDefined();
      expect(w.identity.state()).toEqual({ status: "failed", text: ERROR_TEXT["identity-refused"] });
    });

    it("shows fixed words when it cannot be reached or the code request fails", async () => {
      const w = world();
      w.fake.fail("/v1/identity/challenge", "throw");
      await expect(w.identity.verify()).rejects.toBeDefined();
      expect(w.identity.state()).toEqual({ status: "failed", text: ERROR_TEXT.network });
      w.fake.fail("/v1/identity/challenge", { status: 503, body: {} });
      await expect(w.identity.verify()).rejects.toBeDefined();
      expect(w.identity.state()).toEqual({ status: "failed", text: ERROR_TEXT.unavailable });
    });

    it("drops a session it still holds when a new check fails: it fails closed", async () => {
      const w = world();
      await w.identity.verify();
      expect(w.client.hasSession()).toBe(true);
      w.host.mode = "other-owner";
      await expect(w.identity.verify()).rejects.toBeDefined();
      expect(w.identity.state().status).toBe("failed");
      expect(w.client.hasSession()).toBe(false);
    });

    it("can be tried again after a failure", async () => {
      const w = world();
      w.fake.fail("/v1/identity/challenge", "throw");
      await expect(w.identity.verify()).rejects.toBeDefined();
      await w.identity.verify();
      expect(w.identity.state().status).toBe("verified");
    });
  });

  describe("when the person ends things while a check is running", () => {
    // A check with two gates: Buzz's signing, and the service's answer to verify. A test opens them one at a time.
    function gated() {
      const w = world();
      const gate = () => {
        let open!: () => void;
        const wait = new Promise<void>((resolve) => (open = resolve));
        return { wait, open };
      };
      const signing = gate();
      const verify = gate();
      const real = hostProver(w.host);
      const prove = Object.assign(async (...args: Parameters<typeof real>) => (await signing.wait, real(...args)), { available: () => true });
      let asked = false;
      const client = createClient(async (request) => {
        if (request.url.endsWith("/v1/identity/verify")) {
          asked = true;
          await verify.wait;
        }
        return w.fake.handle(request);
      }, () => w.clock.t);
      const identity = createIdentity({ client, relay: w.relay as never, prove, now: () => w.clock.t, signWaitMs: 60_000 });
      /** The check has sent its verify request and is waiting for the service's answer. */
      const waiting = () => vi.waitFor(() => expect(asked).toBe(true));
      return { w, client, identity, signing, verify, waiting };
    }

    it("sends nothing to verify, and keeps nothing, when Forget comes before Buzz has signed", async () => {
      const { w, client, identity, signing } = gated();
      const check = identity.verify();
      await flush();
      identity.forget();
      signing.open();
      await check;
      expect(identity.state()).toEqual({ status: "unverified" });
      expect(client.hasSession()).toBe(false);
      expect(calls(w, "/v1/identity/verify")).toEqual([]);
    });

    it("drops the session, and tells the service, when Forget comes before its answer does", async () => {
      vi.useFakeTimers();
      try {
        const { w, client, identity, signing, verify, waiting } = gated();
        const check = identity.verify();
        signing.open();
        await waiting();
        identity.forget();
        verify.open();
        await vi.advanceTimersByTimeAsync(20);
        await check;
        expect(identity.state()).toEqual({ status: "unverified" });
        expect(identity.verified()).toBe(false);
        expect(client.hasSession()).toBe(false);
        expect(w.fake.sessions.size).toBe(0);
        // No clock is left running for a session nobody holds.
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps no session, no timer and no state when the plugin is switched off in the middle of a check", async () => {
      vi.useFakeTimers();
      try {
        const { w, client, identity, signing, verify, waiting } = gated();
        let heard = 0;
        identity.subscribe(() => heard++);
        const check = identity.verify();
        const heardBefore = heard;
        signing.open();
        await waiting();
        identity.dispose();
        verify.open();
        await vi.advanceTimersByTimeAsync(20);
        await check;
        expect(identity.verified()).toBe(false);
        expect(client.hasSession()).toBe(false);
        expect(w.fake.sessions.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(heard).toBe(heardBefore);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not let an old check's failure replace the state the person chose", async () => {
      const { w, identity, signing } = gated();
      w.host.mode = "throw";
      const check = identity.verify();
      await flush();
      identity.forget();
      signing.open();
      await expect(check).rejects.toBeDefined();
      expect(identity.state()).toEqual({ status: "unverified" });
    });

    it("starts a new check when asked after Forget, and the old one cannot spoil it or start a third", async () => {
      const { w, identity, signing, verify, waiting } = gated();
      const old = identity.verify();
      await flush();
      identity.forget();
      const fresh = identity.verify();
      expect(fresh).not.toBe(old);
      signing.open();
      // The old check ends first, at its stale turn; the new one is at the service.
      await old;
      await waiting();
      // Asking again while the new one runs is the new one, not a third.
      expect(identity.verify()).toBe(fresh);
      verify.open();
      await fresh;
      expect(identity.state().status).toBe("verified");
      expect(identity.verified()).toBe(true);
      expect(w.fake.sessions.size).toBe(1);
      expect(w.fake.challenges.size).toBe(2);
    });
  });

  describe("the key the session is for", () => {
    const other = "c".repeat(64);
    const sessionsOf = (w: ReturnType<typeof world>) => w.fake.sessions.size;

    it("ends, with a reason, when Buzz's signed-in key is no longer the one verified, and the service is told", async () => {
      const w = world();
      await w.identity.verify();
      expect(w.identity.verifiedKey()).toBe(w.user.pubkey);
      w.relayState.viewer = other;
      // Asked, before anyone is told: the answer is no, and the session goes.
      expect(w.identity.verified()).toBe(false);
      expect(w.identity.verifiedKey()).toBeUndefined();
      expect(w.identity.state()).toEqual({ status: "unverified", ended: true });
      expect(w.client.hasSession()).toBe(false);
      await flush();
      expect(sessionsOf(w)).toBe(0);
      expect(calls(w, "/v1/identity/logout")).toHaveLength(1);
      await expect(w.support.list()).rejects.toMatchObject({ kind: "no-session" });
    });

    it("ends as soon as Buzz says the key changed, without anyone asking", async () => {
      const w = world();
      await w.identity.verify();
      let heard = 0;
      w.identity.subscribe(() => heard++);
      w.setViewer(other);
      expect(heard).toBe(1);
      expect(w.identity.state()).toEqual({ status: "unverified", ended: true });
      await flush();
      expect(sessionsOf(w)).toBe(0);
    });

    it("keeps the session while Buzz has no signed-in key (it is reconnecting), and gives no key to trust until it is back", async () => {
      const w = world();
      await w.identity.verify();
      const before = w.fake.log.length;
      // Buzz's snapshot has no viewer while the relay connects, after a disconnect and in some error states.
      w.setViewer(undefined);
      expect(w.identity.state().status).toBe("verified");
      expect(w.identity.verified()).toBe(true);
      expect(w.client.hasSession()).toBe(true);
      expect(w.identity.verifiedKey()).toBeUndefined();
      // Nothing was told to the service, and the session still works for the page.
      expect(w.fake.log.length).toBe(before);
      await expect(w.support.list()).resolves.toEqual([]);
      // The same key comes back: nothing was lost.
      w.setViewer(w.user.pubkey);
      expect(w.identity.state().status).toBe("verified");
      expect(w.identity.verifiedKey()).toBe(w.user.pubkey);
      expect(w.fake.sessions.size).toBe(1);
      expect(calls(w, "/v1/identity/logout")).toEqual([]);
    });

    it("ends the session when a different key appears after Buzz had none, and keeps it when the same key is announced again and again", async () => {
      const w = world();
      await w.identity.verify();
      w.setViewer(w.user.pubkey);
      w.setViewer(w.user.pubkey);
      expect(w.identity.state().status).toBe("verified");
      for (let round = 0; round < 3; round++) {
        w.setViewer(undefined);
        w.setViewer(w.user.pubkey);
      }
      expect(w.identity.state().status).toBe("verified");
      w.setViewer(undefined);
      w.setViewer(other);
      expect(w.identity.state()).toEqual({ status: "unverified", ended: true });
      expect(w.identity.verifiedKey()).toBeUndefined();
      await flush();
      expect(w.fake.sessions.size).toBe(0);
      expect(calls(w, "/v1/identity/logout")).toHaveLength(1);
    });

    it("keeps the session when Buzz has no key at the moment a check ends", async () => {
      const w = world();
      const gate = () => {
        let open!: () => void;
        return { wait: new Promise<void>((resolve) => (open = resolve)), open };
      };
      const signing = gate();
      const real = hostProver(w.host);
      const prove = Object.assign(async (...args: Parameters<typeof real>) => (await signing.wait, real(...args)), { available: () => true });
      const identity = createIdentity({ client: w.client, relay: w.relay as never, prove, now: () => w.clock.t, signWaitMs: 60_000 });
      const check = identity.verify();
      await flush();
      w.relayState.viewer = undefined;
      signing.open();
      await check;
      expect(identity.state().status).toBe("verified");
      expect(w.client.hasSession()).toBe(true);
      expect(identity.verifiedKey()).toBeUndefined();
      w.relayState.viewer = w.user.pubkey;
      expect(identity.verifiedKey()).toBe(w.user.pubkey);
    });

    it("keeps nothing when the key changes while a check is running", async () => {
      const w = world();
      const gate = () => {
        let open!: () => void;
        return { wait: new Promise<void>((resolve) => (open = resolve)), open };
      };
      const signing = gate();
      const real = hostProver(w.host);
      const prove = Object.assign(async (...args: Parameters<typeof real>) => (await signing.wait, real(...args)), { available: () => true });
      const identity = createIdentity({ client: w.client, relay: w.relay as never, prove, now: () => w.clock.t, signWaitMs: 60_000 });
      const check = identity.verify();
      await flush();
      w.relayState.viewer = other;
      signing.open();
      await check;
      expect(identity.state()).toEqual({ status: "unverified", ended: true });
      expect(identity.verifiedKey()).toBeUndefined();
      expect(w.client.hasSession()).toBe(false);
      await flush();
      expect(sessionsOf(w)).toBe(0);
    });

    it("is not watched any more once the plugin has gone", async () => {
      const w = world();
      expect(w.watching()).toBe(1);
      await w.identity.verify();
      w.identity.dispose();
      expect(w.watching()).toBe(0);
      const before = w.fake.log.length;
      w.setViewer(other);
      expect(w.fake.log.length).toBe(before);
    });

    it("has no key to give once the session's time has passed, though no clock has run to say so", async () => {
      const w = world();
      await w.identity.verify();
      expect(w.identity.verifiedKey()).toBe(w.user.pubkey);
      w.clock.t += 3_700_000;
      expect(w.identity.verified()).toBe(false);
      expect(w.identity.verifiedKey()).toBeUndefined();
    });
  });

  describe("telling the service", () => {
    it("asks it to end the session on Forget, with that session, and keeps nothing if it will not", async () => {
      const w = world();
      await w.identity.verify();
      const [token] = [...w.fake.sessions.keys()];
      w.fake.fail("/v1/identity/logout", "throw");
      w.identity.forget();
      const [logout] = calls(w, "/v1/identity/logout") as unknown as { headers: Record<string, string> }[];
      expect(logout?.headers.authorization).toBe(`Bearer ${token}`);
      expect(w.client.hasSession()).toBe(false);
      expect(w.identity.state()).toEqual({ status: "unverified" });
    });

    it("ends it at the service on Forget and when the plugin goes, but not when the service itself said it is over", async () => {
      const w = world();
      await w.identity.verify();
      w.identity.forget();
      await flush();
      expect(w.fake.sessions.size).toBe(0);
      await w.identity.verify();
      w.identity.dispose();
      await flush();
      expect(w.fake.sessions.size).toBe(0);
      expect(calls(w, "/v1/identity/logout")).toHaveLength(2);
      const again = world();
      await again.identity.verify();
      again.fake.sessions.clear();
      await expect(again.support.list()).rejects.toMatchObject({ kind: "session-ended" });
      expect(calls(again, "/v1/identity/logout")).toEqual([]);
    });

    it("asks nothing of the service when there is no session to end", async () => {
      const w = world();
      w.identity.forget();
      expect(w.fake.log).toEqual([]);
    });
  });

  describe("the session", () => {
    it("ends by itself when its time is up", async () => {
      vi.useFakeTimers();
      try {
        const w = world();
        const done = w.identity.verify();
        await vi.advanceTimersByTimeAsync(50);
        await done;
        expect(w.identity.state().status).toBe("verified");
        w.clock.t += 3_600_000;
        await vi.advanceTimersByTimeAsync(3_600_000);
        expect(w.identity.state()).toEqual({ status: "unverified", ended: true });
        expect(w.client.hasSession()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("ends when a request finds the service no longer knows it", async () => {
      const w = world();
      await w.identity.verify();
      w.fake.sessions.clear();
      await expect(w.support.list()).rejects.toMatchObject({ kind: "session-ended" });
      expect(w.identity.state()).toEqual({ status: "unverified", ended: true });
      expect(w.identity.verified()).toBe(false);
    });

    it("leaves no clock running after Forget: the state stays as the person left it", async () => {
      vi.useFakeTimers();
      try {
        const w = world();
        const done = w.identity.verify();
        await vi.waitFor(() => expect(w.identity.state().status).toBe("verified"));
        await done;
        w.identity.forget();
        expect(vi.getTimerCount()).toBe(0);
        w.clock.t += 3_700_000;
        await vi.advanceTimersByTimeAsync(3_700_000);
        expect(w.identity.state()).toEqual({ status: "unverified" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("ends on Forget, and forgets the token", async () => {
      const w = world();
      await w.identity.verify();
      w.identity.forget();
      expect(w.identity.state()).toEqual({ status: "unverified" });
      expect(w.client.hasSession()).toBe(false);
      await expect(w.support.list()).rejects.toMatchObject({ kind: "no-session" });
    });

    it("is dropped, with its listeners, when the plugin goes", async () => {
      const w = world();
      await w.identity.verify();
      let heard = 0;
      w.identity.subscribe(() => heard++);
      w.identity.dispose();
      expect(w.client.hasSession()).toBe(false);
      w.identity.forget();
      expect(heard).toBe(0);
    });

    it("needs a new check, with a new code, after it ends", async () => {
      const w = world();
      await w.identity.verify();
      w.identity.forget();
      await w.identity.verify();
      expect(w.fake.challenges.size).toBe(2);
      expect(w.host.calls).toHaveLength(2);
      expect(w.host.calls[0]).not.toBe(w.host.calls[1]);
    });
  });
});
