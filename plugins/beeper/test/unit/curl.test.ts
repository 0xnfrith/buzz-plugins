import { describe, expect, it } from "vitest";
import { MAX_INPUT_BYTES, curlConfig, parseReply } from "../../src/beeper/curl";

describe("curlConfig", () => {
  it("writes the url, the token header and nothing else for a read", () => {
    const config = curlConfig({ url: "http://127.0.0.1:23373/v1/chats", method: "GET", token: "test-token-not-real" })!;
    expect(config.split("\n").filter(Boolean)).toEqual([
      'url = "http://127.0.0.1:23373/v1/chats"',
      'header = "Accept: application/json"',
      'header = "Authorization: Bearer test-token-not-real"',
    ]);
  });

  it("sends no Authorization header without a token", () => {
    expect(curlConfig({ url: "http://127.0.0.1:1/v1/info", method: "GET" })).not.toMatch(/authorization/i);
  });

  it("puts a body in data-raw, which curl never reads as a file name", () => {
    const config = curlConfig({ url: "http://127.0.0.1:1/x", method: "POST", token: "t".repeat(8), body: { text: "@/etc/hostname" } })!;
    expect(config).toContain('request = "POST"');
    expect(config).toContain('header = "Content-Type: application/json"');
    expect(config).toContain('data-raw = "{\\"text\\":\\"@/etc/hostname\\"}"');
    expect(config).not.toMatch(/^data = /m);
  });

  it("keeps a message from ending its line or its quote", () => {
    const text = 'a"\nurl = "http://evil.example/"\r\n\\ \t end';
    const config = curlConfig({ url: "http://127.0.0.1:1/x", method: "POST", token: "t".repeat(8), body: { text } })!;
    // Every option sits on its own line: the message added none.
    const lines = config.split("\n").filter(Boolean);
    expect(lines.map((line) => line.split(" = ")[0])).toEqual(["url", "header", "header", "request", "header", "data-raw"]);
    expect(config).not.toContain("evil.example/\"\n");
  });

  it("carries the DEL character, which JSON leaves raw, as an escape", () => {
    const config = curlConfig({ url: "http://127.0.0.1:1/x", method: "POST", token: "t".repeat(8), body: { text: "a\u007fb" } })!;
    expect(config).not.toContain("\u007f");
    expect(config).toContain("a\\\\u007fb");
  });

  it("refuses a raw control character in a value", () => {
    expect(() => curlConfig({ url: "http://127.0.0.1:1/\u0001", method: "GET" })).toThrow();
  });

  it("returns nothing when the request would not fit", () => {
    const body = { text: "x".repeat(MAX_INPUT_BYTES) };
    expect(curlConfig({ url: "http://127.0.0.1:1/x", method: "POST", token: "t".repeat(8), body })).toBeUndefined();
    const fits = { text: "x".repeat(MAX_INPUT_BYTES - 500) };
    expect(curlConfig({ url: "http://127.0.0.1:1/x", method: "POST", token: "t".repeat(8), body: fits })).toBeDefined();
  });

  it("counts bytes, not characters", () => {
    const body = { text: "é".repeat(MAX_INPUT_BYTES / 2) };
    expect(curlConfig({ url: "http://127.0.0.1:1/x", method: "POST", token: "t".repeat(8), body })).toBeUndefined();
  });
});

describe("parseReply", () => {
  it("splits the body from the status curl writes after it", () => {
    expect(parseReply('{"a":1}\n200')).toEqual({ status: 200, body: '{"a":1}' });
    expect(parseReply("\n404")).toEqual({ status: 404, body: "" });
  });
  it("keeps line breaks inside the body", () => {
    expect(parseReply('{"t":"a\nb"}\n201')).toEqual({ status: 201, body: '{"t":"a\nb"}' });
  });
  it("rejects output that does not end in a status", () => {
    expect(parseReply("")).toBeUndefined();
    expect(parseReply("{}")).toBeUndefined();
    expect(parseReply("{}\nabc")).toBeUndefined();
    expect(parseReply("{}\n000")).toBeUndefined();
  });
});

describe("fitsInRequest", () => {
  it("does not throw for any character", async () => {
    const { fitsInRequest } = await import("../../src/beeper/curl");
    const everything = Array.from({ length: 0x200 }, (_, i) => String.fromCharCode(i)).join("").repeat(10);
    expect(fitsInRequest(everything)).toBe(true);
  });

  it("agrees with the real limit, with room for the address and the longest token", async () => {
    const { fitsInRequest } = await import("../../src/beeper/curl");
    expect(fitsInRequest("short")).toBe(true);
    expect(fitsInRequest("x".repeat(60000))).toBe(true);
    expect(fitsInRequest("x".repeat(70000))).toBe(false);
    // Quotes and line breaks grow when escaped for JSON and again for the config.
    expect(fitsInRequest('"'.repeat(20000))).toBe(false);
    for (const size of [1000, 10000, 15000, 30000, 60000, 64000]) {
      for (const char of ['"', "\n", "é", "🙂", "\\"]) {
        const text = char.repeat(size);
        if (fitsInRequest(text)) {
          const real = curlConfig({ url: "http://127.0.0.1:23373/v1/chats/" + "!".repeat(200) + "/messages", method: "POST", token: "t".repeat(500), body: { text } });
          expect(real, `${JSON.stringify(char)} x ${size}`).toBeDefined();
        }
      }
    }
  });
});
