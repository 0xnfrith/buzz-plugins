import { describe, expect, it } from "vitest";
import { TERMINAL_ENV, bech32, npub, relayUrl, shellEnv, type ChannelContext } from "../../src/env";

const context: ChannelContext = {
  scope: "community-a",
  channelId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
  channelName: "General Chat",
  viewer: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  relayUrl: "wss://relay.example.com",
  threadId: "ab".repeat(32),
};

describe("npub", () => {
  // Expected values from the BIP-173 reference algorithm, written independently of this code (in python), for keys that belong to no one.
  it("encodes a public key as NIP-19 does, byte for byte", () => {
    expect(npub("00".repeat(32))).toBe("npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzqujme");
    expect(npub("ff".repeat(32))).toBe("npub1lllllllllllllllllllllllllllllllllllllllllllllllllllsq7lrjw");
    expect(npub("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")).toBe("npub1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0st5hsmq");
  });

  it("matches BIP-173's own published checksum for an empty input", () => {
    expect(bech32("a", new Uint8Array())).toBe("a12uel5l");
  });

  it("takes upper-case hex as well", () => {
    expect(npub("000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F")).toBe("npub1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0st5hsmq");
  });

  it("refuses anything that is not 64 hex characters", () => {
    for (const bad of ["", "xyz", "3bf0", `${"a".repeat(63)}g`, `${"a".repeat(65)}`]) expect(npub(bad)).toBeUndefined();
  });
});

describe("relayUrl", () => {
  it("keeps a plain WebSocket URL, drops credentials, a query and a fragment", () => {
    expect(relayUrl("wss://relay.example.com")).toBe("wss://relay.example.com/");
    expect(relayUrl("wss://user:secret@relay.example.com:8443/path?token=abc#frag")).toBe("wss://relay.example.com:8443/path");
    expect(relayUrl("ws://127.0.0.1:3000")).toBe("ws://127.0.0.1:3000/");
  });

  it("refuses other schemes and text that is not a URL", () => {
    for (const bad of ["https://relay.example.com", "javascript:alert(1)", "file:///etc/passwd", "not a url", ""]) expect(relayUrl(bad)).toBeUndefined();
  });
});

describe("shellEnv", () => {
  it("is Buzz's public shell context from the panel's context", () => {
    expect(shellEnv(context)).toEqual({
      ...TERMINAL_ENV,
      BUZZ_CHANNEL_ID: context.channelId,
      BUZZ_CHANNEL: "General Chat",
      BUZZ_NPUB: "npub1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0st5hsmq",
      BUZZ_RELAY_URL: "wss://relay.example.com/",
      BUZZ_THREAD_ID: "ab".repeat(32),
    });
  });

  it("names the terminal for programs that ask, as Buzz's Terminal does", () => {
    expect(TERMINAL_ENV).toEqual({ TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Buzz" });
  });

  it("leaves out BUZZ_THREAD_ID when no thread is open", () => {
    const { threadId: _, ...noThread } = context;
    expect(shellEnv(noThread)).not.toHaveProperty("BUZZ_THREAD_ID");
  });

  it("falls back to the channel id when the name is not safe, and has no control character or newline in any value", () => {
    for (const channelName of ["", "x".repeat(65), "a\nb", "a\x1b[31mb", "$(touch /tmp/pwned)", "semi;colon", "tab\there", "é"]) {
      const env = shellEnv({ ...context, channelName });
      expect(env.BUZZ_CHANNEL, JSON.stringify(channelName)).toBe(context.channelId);
    }
  });

  it("leaves a variable out rather than pass a value that does not check out", () => {
    const env = shellEnv({
      scope: "x",
      channelId: "not-a-uuid\n",
      channelName: "ok",
      viewer: "zz",
      relayUrl: "http://example.com\nX=1",
      threadId: "not hex\n",
    });
    expect(env).toEqual({ ...TERMINAL_ENV, BUZZ_CHANNEL: "ok" });
  });

  it("never carries a control character or newline in a value, whatever the context holds", () => {
    const env = shellEnv({ ...context, channelName: "line\nbreak", relayUrl: "wss://user:p@ass@relay.example.com/a\nb", threadId: `${"ab".repeat(31)}\n\n` });
    for (const [name, value] of Object.entries(env)) expect(value, name).toMatch(/^[\x20-\x7e]*$/);
  });

  it("asks for nothing beyond the terminal's names and Buzz's public context", () => {
    expect(Object.keys(shellEnv(context)).sort()).toEqual(
      ["BUZZ_CHANNEL", "BUZZ_CHANNEL_ID", "BUZZ_NPUB", "BUZZ_RELAY_URL", "BUZZ_THREAD_ID", "COLORTERM", "TERM", "TERM_PROGRAM"].sort(),
    );
  });
});
