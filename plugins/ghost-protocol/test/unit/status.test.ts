import { afterEach, describe, expect, it } from "vitest";
import { gpLines, readStatus, updateImageOf, CLAUDES, RELAYS, STATES, INTERFACE } from "../../src/status";
import { makeFake, type FakeDocker } from "./support/fake-host";
// @ts-expect-error plain JavaScript, with its own types that the plugin's type check does not include
import { attestationTag, imageOfVersion } from "../fake-docker/index.mjs";

const KEY = "a".repeat(64);
// The shape of GHOST Protocol's own example of a status, whole.
const NOTE_EXAMPLE = {
  interface: 1,
  version: "0.0.0",
  state: "running",
  agent_pubkey: KEY,
  relay_url: "wss://relay.example.com",
  relay: "connected",
  claude: "active",
  update: { available: false, version: null },
  previous_version: null,
  error: null,
};
const json = (change: Record<string, unknown> = {}, spaces?: number) => JSON.stringify({ ...NOTE_EXAMPLE, ...change }, null, spaces);
const read = (text: string) => readStatus(text);

const made: FakeDocker[] = [];
afterEach(() => made.splice(0).forEach((fake) => fake.cleanup()));
const fakeWith = (scenario: unknown) => {
  const fake = makeFake(scenario);
  made.push(fake);
  return fake;
};
const statusFrom = async (fake: FakeDocker) => (await fake.run(["exec", "gp-maple", "gp", "status", "--json"])).stdout;

describe("readStatus", () => {
  it("reads GHOST Protocol's own example of a status, to the last field", () => {
    expect(read(json())).toEqual({
      kind: "status",
      status: {
        state: "running",
        version: "0.0.0",
        agentPubkey: KEY,
        relayUrl: "wss://relay.example.com",
        relay: "connected",
        claude: "active",
        update: { available: false, version: null, image: { kind: "none" } },
        previousVersion: null,
        error: null,
      },
    });
  });

  it("knows the one interface number there is", () => {
    expect(INTERFACE).toBe(1);
  });

  it("reads every state, relay and Claude value GHOST Protocol lists, and no other", () => {
    expect([...STATES]).toEqual(["needs-claude", "needs-auth-tag", "connecting", "running", "updating", "error"]);
    expect([...RELAYS]).toEqual(["connected", "refused-not-member", "unreachable"]);
    expect([...CLAUDES]).toEqual(["active", "not-active"]);
    for (const state of STATES) expect(read(json({ state }))).toMatchObject({ kind: "status", status: { state } });
    for (const relay of RELAYS) expect(read(json({ relay }))).toMatchObject({ kind: "status", status: { relay } });
    for (const claude of CLAUDES) expect(read(json({ claude }))).toMatchObject({ kind: "status", status: { claude } });
    for (const state of ["", "Running", "stopped", "done", null, 3, undefined]) expect(read(json({ state })), String(state)).toEqual({ kind: "unreadable" });
    for (const relay of ["", "Connected", "refused", "down", null, 3, undefined]) expect(read(json({ relay })), String(relay)).toEqual({ kind: "unreadable" });
    for (const claude of ["", "Active", "inactive", true, null, undefined]) expect(read(json({ claude })), String(claude)).toEqual({ kind: "unreadable" });
  });

  it("reads all of stdout, whether the object is written over several lines or on one, with Windows line ends or without", () => {
    for (const text of [json({}, 2), json({}, 2).replace(/\n/g, "\r\n"), json(), `\n  ${json({}, 4)}\n\n`]) expect(read(text).kind).toBe("status");
  });

  it("skips a GP_ line before or after the object, which is no part of it", () => {
    expect(read(`GP_INTERFACE=1\n${json({}, 2)}\n`).kind).toBe("status");
    expect(read(`${json({}, 2)}\nGP_INTERFACE=1\n`).kind).toBe("status");
    // Only a GP_ line is skipped: any other text is not JSON.
    expect(read(`starting up\n${json()}`)).toEqual({ kind: "unreadable" });
    expect(read(`GP_interface=1\n${json()}`)).toEqual({ kind: "unreadable" });
  });

  it("says the interface is another one for any `interface` that is not 1, and reads nothing else of such an answer", () => {
    for (const interfaceNumber of [0, 2, 3, 1.5, -1, "1", "2", null, true, [1], {}]) {
      expect(read(json({ interface: interfaceNumber })), JSON.stringify(interfaceNumber)).toEqual({ kind: "other-interface" });
    }
    // A shape this plugin does not know goes with a number it does not know: the rest is not read.
    expect(read(JSON.stringify({ interface: 2, state: "hibernating", extra: [1, 2] }))).toEqual({ kind: "other-interface" });
    expect(read(JSON.stringify({ state: "running" }))).toEqual({ kind: "other-interface" });
  });

  it("says unreadable for what is not an object: no text, other JSON, a broken object", () => {
    for (const text of ["", "\n", "null", "[]", "[1]", "1", '"running"', "true", "{", `${json()}}`, `${json()}${json()}`, "GP_INTERFACE=1\n", "<html>"]) {
      expect(read(text), JSON.stringify(text)).toEqual({ kind: "unreadable" });
    }
  });

  it("says unreadable for an object of interface 1 with a field missing or of the wrong kind", () => {
    const without = (field: string) => {
      const { [field]: _gone, ...rest } = NOTE_EXAMPLE as Record<string, unknown>;
      return JSON.stringify(rest);
    };
    for (const field of ["version", "state", "agent_pubkey", "relay_url", "relay", "claude", "update", "previous_version", "error"]) {
      expect(read(without(field)), field).toEqual({ kind: "unreadable" });
    }
    const wrong: Record<string, unknown>[] = [
      { version: "" },
      { version: 1 },
      { version: null },
      { agent_pubkey: "abc" },
      { agent_pubkey: "g".repeat(64) },
      { agent_pubkey: "a".repeat(65) },
      { agent_pubkey: 5 },
      { relay_url: null },
      { previous_version: 1 },
      { previous_version: undefined },
      { update: null },
      { update: [] },
      { update: { available: "yes", version: null } },
      { update: { available: false } },
      { update: { available: false, version: 3 } },
      { error: "boom" },
      { error: {} },
      { error: { code: "x" } },
      { error: { code: 1, message: "x" } },
      { error: { code: "x", message: null } },
      { error: [] },
    ];
    for (const change of wrong) expect(read(JSON.stringify({ ...NOTE_EXAMPLE, ...change })), JSON.stringify(change)).toEqual({ kind: "unreadable" });
  });

  it("takes the public key in either case of hex, an empty relay address, and fields it does not know", () => {
    expect(read(json({ agent_pubkey: "ABCDEF0123456789".repeat(4) }))).toMatchObject({ kind: "status", status: { agentPubkey: "ABCDEF0123456789".repeat(4) } });
    expect(read(json({ relay_url: "" }))).toMatchObject({ kind: "status", status: { relayUrl: "" } });
    expect(read(json({ later: { field: 1 } })).kind).toBe("status");
  });

  it("reads an update on offer, a version to go back to, and an error with its code and message", () => {
    expect(read(json({ update: { available: true, version: "0.1.1" }, previous_version: "0.0.9", state: "error", error: { code: "crashed", message: "The agent stopped." } }))).toMatchObject({
      status: { update: { available: true, version: "0.1.1" }, previousVersion: "0.0.9", error: { code: "crashed", message: "The agent stopped." } },
    });
    // An update that is on offer without a version is still on offer.
    expect(read(json({ update: { available: true, version: null } }))).toMatchObject({ status: { update: { available: true, version: null } } });
  });
});

// With an update on offer, `update` also carries `image`, that version pinned by digest, and `digest`.
describe("readStatus, on the image of the update on offer", () => {
  const HEX = "ab".repeat(32);
  const PINNED = `registry.example/ghost-protocol:0.1.1@sha256:${HEX}`;
  const offer = (more: Record<string, unknown>) => ({ available: true, version: "0.1.1", ...more });
  const imageOf = (update: Record<string, unknown>) => {
    const read = readStatus(json({ update }));
    if (read.kind !== "status") throw new Error(`the status was not read: ${read.kind}`);
    return read.status.update.image;
  };

  it("is pinned for the image GHOST Protocol names, with its digest, whole", () => {
    expect(imageOf(offer({ image: PINNED, digest: `sha256:${HEX}` }))).toEqual({ kind: "pinned", image: PINNED });
    // The digest field may be left out of an image that is pinned all the same.
    expect(imageOf(offer({ image: PINNED }))).toEqual({ kind: "pinned", image: PINNED });
    expect(imageOf(offer({ image: PINNED, digest: null }))).toEqual({ kind: "pinned", image: PINNED });
  });

  it("takes a registry with a port and a path, and a tag with a dot, a dash and an underscore", () => {
    const image = `registry.example:5000/team/sub-team/ghost-protocol:1.0.0-rc_1@sha256:${HEX}`;
    expect(imageOf({ available: true, version: "1.0.0-rc_1", image, digest: `sha256:${HEX}` })).toEqual({ kind: "pinned", image });
  });

  it("is none where GHOST Protocol names no image: the keys are not there, or null (an older one, or an offer made by hand in a test)", () => {
    expect(imageOf({ available: true, version: "0.1.1" })).toEqual({ kind: "none" });
    expect(imageOf(offer({ image: null, digest: null }))).toEqual({ kind: "none" });
    expect(imageOf(offer({ image: null }))).toEqual({ kind: "none" });
    expect(imageOf({ available: false, version: null })).toEqual({ kind: "none" });
  });

  it("is refused for an image that is not the pinned form, whatever it is", () => {
    const bad = [
      "registry.example/ghost-protocol:0.1.1",
      "registry.example/ghost-protocol",
      `registry.example/ghost-protocol@sha256:${HEX}`,
      `registry.example/ghost-protocol:latest@sha256:${HEX}`,
      `registry.example/ghost-protocol:0.1.1@sha256:${HEX.slice(1)}`,
      `registry.example/ghost-protocol:0.1.1@sha256:${HEX}a`,
      `registry.example/ghost-protocol:0.1.1@sha256:${HEX.toUpperCase()}`,
      `registry.example/ghost-protocol:0.1.1@sha256:${"g".repeat(64)}`,
      `registry.example/ghost-protocol:0.1.1@sha512:${HEX}`,
      `registry.example/ghost-protocol:0.1.1@${HEX}`,
      `${PINNED} `,
      ` ${PINNED}`,
      `${PINNED}\n`,
      `${PINNED};rm -rf ~`,
      `${PINNED} && echo hi`,
      `${PINNED}@sha256:${HEX}`,
      `registry.example/ghost-protocol:0.1.1@sha256:${HEX}\nregistry.example/ghost-protocol:0.1.1@sha256:${HEX}`,
      "$(whoami)/ghost-protocol:0.1.1@sha256:" + HEX,
      "`id`/ghost-protocol:0.1.1@sha256:" + HEX,
      "reg/Ghost-Protocol:0.1.1@sha256:" + HEX,
      "registry.example/other:0.1.1@sha256:" + HEX,
      "-evil/ghost-protocol:0.1.1@sha256:" + HEX,
      "registry.example/ghost-protocol:0.1.1|x@sha256:" + HEX,
      "",
      "not an image",
    ];
    for (const image of bad) expect(imageOf(offer({ image, digest: `sha256:${HEX}` })), JSON.stringify(image)).toEqual({ kind: "refused" });
    // With the digest field the very text the image ends in, so that the check of the digest field cannot be what refuses it, nor with no digest field at all.
    for (const image of bad) {
      const digest = image.includes("@") ? image.slice(image.lastIndexOf("@") + 1) : undefined;
      expect(imageOf(offer({ image, digest })), `${JSON.stringify(image)} with its own digest`).toEqual({ kind: "refused" });
      expect(imageOf(offer({ image })), `${JSON.stringify(image)} without a digest`).toEqual({ kind: "refused" });
    }
  });

  it("is refused for an image of another version than the one on offer, or when no version is on offer", () => {
    expect(imageOf(offer({ image: PINNED.replace(":0.1.1@", ":0.1.2@"), digest: `sha256:${HEX}` }))).toEqual({ kind: "refused" });
    expect(imageOf(offer({ image: PINNED.replace(":0.1.1@", ":0.1.10@"), digest: `sha256:${HEX}` }))).toEqual({ kind: "refused" });
    expect(imageOf(offer({ version: "0.1", image: PINNED, digest: `sha256:${HEX}` }))).toEqual({ kind: "refused" });
    expect(imageOf(offer({ version: null, image: PINNED, digest: `sha256:${HEX}` }))).toEqual({ kind: "refused" });
    expect(imageOf({ available: false, version: null, image: PINNED })).toEqual({ kind: "refused" });
  });

  it("is refused when the digest field is not the digest of the image, or is not a string or null", () => {
    expect(imageOf(offer({ image: PINNED, digest: `sha256:${"cd".repeat(32)}` }))).toEqual({ kind: "refused" });
    expect(imageOf(offer({ image: PINNED, digest: HEX }))).toEqual({ kind: "refused" });
    expect(imageOf(offer({ image: PINNED, digest: "" }))).toEqual({ kind: "refused" });
    for (const digest of [5, true, {}, [`sha256:${HEX}`]]) expect(imageOf(offer({ image: PINNED, digest })), JSON.stringify(digest)).toEqual({ kind: "refused" });
  });

  it("is refused for an image that is not a string", () => {
    for (const image of [5, true, {}, [PINNED], { image: PINNED }]) expect(imageOf(offer({ image, digest: `sha256:${HEX}` })), JSON.stringify(image)).toEqual({ kind: "refused" });
  });

  it("never makes the status unreadable: the state and the rest are read all the same", () => {
    const read = readStatus(json({ update: offer({ image: "not an image", digest: 5 }), state: "running", previous_version: "0.0.9" }));
    expect(read).toMatchObject({ kind: "status", status: { state: "running", update: { available: true, version: "0.1.1", image: { kind: "refused" } }, previousVersion: "0.0.9" } });
  });

  it("is the one rule of updateImageOf", () => {
    expect(updateImageOf("0.1.1", PINNED, `sha256:${HEX}`)).toEqual({ kind: "pinned", image: PINNED });
    expect(updateImageOf("0.1.1", undefined, undefined)).toEqual({ kind: "none" });
    expect(updateImageOf("0.1.1", "x", undefined)).toEqual({ kind: "refused" });
  });
});

describe("readStatus, on what the fake docker prints", () => {
  it("reads every state of a new agent as it walks to running", async () => {
    const fake = fakeWith({});
    fake.seed({ condition: "needs-auth-tag" });
    const states: string[] = [];
    const take = async () => {
      const read1 = readStatus(await statusFrom(fake));
      expect(read1.kind).toBe("status");
      if (read1.kind === "status") states.push(read1.status.state);
    };
    await take();
    // The owner's attestation and a Claude token, then the polls that end in running.
    const volume = fake.state().volumes["gp-maple-data"];
    expect(volume).toBeDefined();
    await fake.run(["exec", "-i", "gp-maple", "gp", "auth-tag", "set"], { input: `${attestationTag(volume.owner as string)}\n` });
    await take();
    await fake.run(["exec", "-i", "gp-maple", "gp", "claude", "token"], { input: "made-up-token\n" });
    await take();
    await take();
    expect(states).toEqual(["needs-auth-tag", "needs-claude", "connecting", "running"]);
  });

  it("reads each relay value, and an error with its code and message", async () => {
    for (const relay of RELAYS) {
      const fake = fakeWith({ relay });
      fake.seed({ condition: "running" });
      const result = readStatus(await statusFrom(fake));
      expect(result).toMatchObject({ kind: "status", status: { relay } });
    }
    const fake = fakeWith("status-error");
    fake.seed({ condition: "running" });
    expect(readStatus(await statusFrom(fake))).toMatchObject({ kind: "status", status: { state: "error", error: { code: "crashed", message: "The agent stopped unexpectedly." } } });
  });

  it("reads an update on offer, and an unknown interface number", async () => {
    const offer = fakeWith("update-available");
    offer.seed({ condition: "running" });
    expect(readStatus(await statusFrom(offer))).toMatchObject({ kind: "status", status: { update: { available: true, version: "0.1.1", image: { kind: "none" } } } });
    const other = fakeWith("unknown-interface");
    other.seed({ condition: "running" });
    expect(readStatus(await statusFrom(other))).toEqual({ kind: "other-interface" });
  });

  it("reads the update image of each preset: pinned, none for a GHOST Protocol that names none or null, refused for a bare tag", async () => {
    const imageOfPreset = async (scenario: unknown) => {
      const fake = fakeWith(scenario);
      fake.seed({ condition: "running" });
      const read = readStatus(await statusFrom(fake));
      if (read.kind !== "status") throw new Error(read.kind);
      return read.status.update.image;
    };
    expect(await imageOfPreset("update-pinned")).toEqual({ kind: "pinned", image: imageOfVersion("0.1.1") });
    expect(await imageOfPreset("update-available")).toEqual({ kind: "none" });
    expect(await imageOfPreset("update-image-null")).toEqual({ kind: "none" });
    expect(await imageOfPreset("update-image-malformed")).toEqual({ kind: "refused" });
    expect(await imageOfPreset({})).toEqual({ kind: "none" });
  });

  it("reads the status however the fake prints it: over several lines, on one, or after GP_INTERFACE", async () => {
    for (const scenario of [{}, { statusFormat: "compact" }, "status-compact-with-preamble", { statusPreamble: true }]) {
      const fake = fakeWith(scenario);
      fake.seed({ condition: "running" });
      expect(readStatus(await statusFrom(fake)).kind, JSON.stringify(scenario)).toBe("status");
    }
  });
});

describe("gpLines", () => {
  it("is the GP_ lines of stdout by key, and nothing else", () => {
    const lines = gpLines("GP_INTERFACE=1\nA line for people.\nGP_ERROR=no-updater\r\nGP_ERROR_MESSAGE=There is no helper.\n  GP_INDENTED=x\nGP_lower=x\nGP_=x\nnot GP_A=b\n");
    expect([...lines.entries()]).toEqual([
      ["INTERFACE", "1"],
      ["ERROR", "no-updater"],
      ["ERROR_MESSAGE", "There is no helper."],
    ]);
  });

  it("keeps the last value of a key printed twice, and an empty value", () => {
    expect(gpLines("GP_A=1\nGP_A=2\nGP_B=\n").get("A")).toBe("2");
    expect(gpLines("GP_B=\n").get("B")).toBe("");
  });

  it("keeps an equals sign inside a value", () => {
    expect(gpLines("GP_CLAUDE_LOGIN_URL=https://x.example/login?a=b\n").get("CLAUDE_LOGIN_URL")).toBe("https://x.example/login?a=b");
  });
});
