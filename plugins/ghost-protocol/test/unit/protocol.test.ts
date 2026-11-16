import { describe, expect, it } from "vitest";
import { parseGp, parseStatus, unknownInterface } from "../../src/gp/protocol";

const STATUS = {
  interface: 1,
  version: "0.0.0",
  state: "running",
  agent_pubkey: "a".repeat(64),
  relay_url: "wss://relay.example.com",
  relay: "connected",
  claude: "active",
  update: { available: false, version: null },
  previous_version: null,
  error: null,
};

describe("parseGp", () => {
  it("reads GP_ lines and leaves the lines for people", () => {
    const gp = parseGp("GP_INTERFACE=1\nPulling the layers\nGP_VERSION=0.0.0\nGP_AGENT_PUBKEY=" + "b".repeat(64) + "\nDone.\n");
    expect(gp.interface).toBe(1);
    expect(gp.values.get("VERSION")).toBe("0.0.0");
    expect(gp.values.get("AGENT_PUBKEY")).toBe("b".repeat(64));
    expect(gp.values.size).toBe(3);
    expect(gp.error).toBeUndefined();
  });

  it("reads an error with its message, and Windows line ends", () => {
    const gp = parseGp("GP_INTERFACE=1\r\nGP_ERROR=bad-auth-tag\r\nGP_ERROR_MESSAGE=the tag is wrong\r\n");
    expect(gp.error).toEqual({ code: "bad-auth-tag", message: "the tag is wrong" });
  });

  it("takes the last value of a key, and ignores a line that only looks like one", () => {
    const gp = parseGp("GP_CLAUDE=not-active\n  GP_CLAUDE=active\nxGP_CLAUDE=active\nGP_CLAUDE=active\n");
    expect(gp.values.get("CLAUDE")).toBe("active");
    expect(parseGp("gp_claude=active\nGP_=x\nGP_CLAUDE\n").values.size).toBe(0);
  });

  it("has no interface number when there is none, or it is not a number", () => {
    expect(parseGp("hello").interface).toBeUndefined();
    expect(parseGp("GP_INTERFACE=one").interface).toBeUndefined();
    expect(unknownInterface(parseGp("hello"))).toBe(false);
    expect(unknownInterface(parseGp("GP_INTERFACE=1"))).toBe(false);
    expect(unknownInterface(parseGp("GP_INTERFACE=2"))).toBe(true);
  });
});

describe("parseStatus", () => {
  it("reads the object on one line or many, with or without a GP_ line before it", () => {
    for (const text of [JSON.stringify(STATUS), JSON.stringify(STATUS, null, 2), `GP_INTERFACE=1\n${JSON.stringify(STATUS, null, 4)}\n`]) {
      const read = parseStatus(text);
      expect(read?.interface).toBe(1);
      expect(read?.status).toMatchObject({ state: "running", agentPubkey: "a".repeat(64), relay: "connected", claude: "active", previousVersion: null, error: null });
    }
  });

  it("reads an error and an update", () => {
    const read = parseStatus(JSON.stringify({ ...STATUS, state: "error", error: { code: "x", message: "broke" }, update: { available: true, version: "0.1.0" }, previous_version: "0.0.0" }));
    expect(read?.status).toMatchObject({ state: "error", error: { code: "x", message: "broke" }, update: { available: true, version: "0.1.0" }, previousVersion: "0.0.0" });
  });

  it("stops at an interface number it does not know, and reads nothing else", () => {
    expect(parseStatus(JSON.stringify({ interface: 2, whatever: true }))).toEqual({ interface: 2, status: undefined });
  });

  it("is undefined for anything that is not a status", () => {
    const bad = [
      "",
      "not json",
      "[]",
      "null",
      JSON.stringify({ ...STATUS, interface: "1" }),
      JSON.stringify({ ...STATUS, interface: 1.5 }),
      JSON.stringify({ ...STATUS, state: "sleeping" }),
      JSON.stringify({ ...STATUS, relay: "maybe" }),
      JSON.stringify({ ...STATUS, claude: "yes" }),
      JSON.stringify({ ...STATUS, update: null }),
      JSON.stringify({ ...STATUS, update: { available: "no", version: null } }),
      JSON.stringify({ ...STATUS, error: "broke" }),
      JSON.stringify({ ...STATUS, agent_pubkey: 5 }),
    ];
    for (const text of bad) expect(parseStatus(text), text).toBeUndefined();
  });
});
