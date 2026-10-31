// What a service has to check for the identity proof to mean anything, shown on the fake: each wrong proof is refused, and the right
// one passes. These test the fake service, which stands in for the real one; they are the contract's rules in executable form, for the
// service's team to implement, and not tests of the plugin (the plugin's own checks are in identity.test.ts and client.test.ts).
import { describe, expect, it } from "vitest";
import { CODE_SECONDS, checkAttestation, createUser, derive, digestOf } from "../fake-support/server.mjs";
import { world } from "./world";

const user = createUser("check-user");
const other = createUser("other-user");
const challenge = "Q2hhbGxlbmdlLWNvZGUtZm9yLXRlc3Q";
const check = (auth: unknown, over: Record<string, unknown> = {}) => checkAttestation(auth, { pubkey: user.pubkey, challenge, ...over });

describe("what the service checks", () => {
  it("accepts the attestation Buzz makes over the hash of the code", () => {
    expect(check(user.authorize(derive(challenge)))).toBeUndefined();
  });

  it("refuses an attestation over anything else: the raw code, another code, or a key", () => {
    expect(check(user.authorize(challenge))).toBe("bad signature");
    expect(check(user.authorize(derive("another-code")))).toBe("bad signature");
    expect(check(user.authorize(other.pubkey))).toBe("bad signature");
    expect(check(user.authorize("f".repeat(64)))).toBe("bad signature");
  });

  it("refuses another key's signature, and a key that is not the one that asked", () => {
    expect(check(other.authorize(derive(challenge)))).toBe("wrong key");
    const claimed = ["auth", user.pubkey, "", other.authorize(derive(challenge))[3]];
    expect(check(claimed)).toBe("bad signature");
  });

  it("refuses conditions, a wrong tag name, and a form that is not four strings", () => {
    const good = user.authorize(derive(challenge));
    expect(check(["auth", user.pubkey, "kind=1", good[3]])).toBe("conditions");
    expect(check(["nope", ...good.slice(1)])).toBe("wrong tag");
    expect(check(good.slice(0, 3))).toBe("not a tag of four");
    expect(check({ auth: good })).toBe("not a tag of four");
    expect(check(["auth", user.pubkey, "", "00".repeat(63)])).toBe("bad signature");
    expect(check(["auth", user.pubkey, "", "zz".repeat(64)])).toBe("bad signature");
    expect(check(["auth", user.pubkey, "", "00".repeat(64)])).toBe("bad signature");
  });

  it("signs, in the attestation, exactly the NIP-OA message with no conditions", () => {
    const n = derive(challenge);
    expect(Buffer.from(digestOf(n)).toString("hex")).toBe(
      Buffer.from(digestOf(n, "")).toString("hex"),
    );
    expect(Buffer.from(digestOf(n, "kind=1")).toString("hex")).not.toBe(Buffer.from(digestOf(n)).toString("hex"));
  });
});

describe("the service as a whole", () => {
  it("spends a code at its first use, and refuses it a second time", async () => {
    const w = world();
    await w.identity.verify();
    const [call] = (w.fake.log as { path: string; body?: unknown }[]).filter((entry) => entry.path === "/v1/identity/verify");
    const body = call?.body as { pubkey: string; challenge: string; auth: never };
    // Replaying the very same proof, by the plugin or by anyone who saw it, gets nothing.
    await expect(w.client.verify(body.pubkey, body.challenge, body.auth)).rejects.toMatchObject({ kind: "identity-refused" });
    expect(w.fake.sessions.size).toBe(1);
  });

  it("spends a code even on a wrong attempt, so it cannot be tried again", async () => {
    const w = world();
    const { challenge } = await w.client.challenge(w.user.pubkey);
    const wrong = w.user.authorize(challenge) as never; // the raw code, not its hash
    await expect(w.client.verify(w.user.pubkey, challenge, wrong)).rejects.toMatchObject({ kind: "identity-refused" });
    const right = w.user.authorize(derive(challenge)) as never;
    await expect(w.client.verify(w.user.pubkey, challenge, right)).rejects.toMatchObject({ kind: "identity-refused" });
  });

  it("refuses a code that has lived too long, and a code asked for by another key", async () => {
    const w = world();
    const first = await w.client.challenge(w.user.pubkey);
    const attested = w.user.authorize(derive(first.challenge)) as never;
    w.clock.t += (CODE_SECONDS + 5) * 1000;
    await expect(w.client.verify(w.user.pubkey, first.challenge, attested)).rejects.toMatchObject({ kind: "identity-refused" });
    const second = await w.client.challenge(w.user.pubkey);
    const stranger = createUser("stranger");
    const theirs = stranger.authorize(derive(second.challenge)) as never;
    await expect(w.client.verify(stranger.pubkey, second.challenge, theirs)).rejects.toMatchObject({ kind: "identity-refused" });
  });

  it("never accepts N as a key", async () => {
    // A code whose hash is the asking key itself cannot be made, but the service refuses the case on its face.
    const n = derive(challenge);
    expect(checkAttestation(["auth", n, "", "00".repeat(64)], { pubkey: n, challenge })).toBe("N is a key");
  });
});
