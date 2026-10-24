import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, checkBaseUrl, checkToken, createConfigStore } from "../../src/beeper/config";

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (name: string) => map.get(name) ?? null,
    setItem: (name: string, value: string) => void map.set(name, value),
    removeItem: (name: string) => void map.delete(name),
  };
}

describe("checkToken", () => {
  it("strips Bearer and surrounding space", () => {
    expect(checkToken("  Bearer  abcd1234efgh \n")).toEqual({ ok: true, value: "abcd1234efgh" });
  });
  it("refuses empty, short, spaced or non-ASCII input", () => {
    for (const bad of ["", "   ", "short", "has space inside", "tab\tinside", "line\nbreak", "naïve-token-1234", "x".repeat(501)])
      expect(checkToken(bad).ok, JSON.stringify(bad)).toBe(false);
  });
  it("does not hold the checker to one vendor's token format", () => {
    expect(checkToken("tok_1234567890-abc.def~ghi").ok).toBe(true);
  });
});

describe("checkBaseUrl", () => {
  it("defaults when empty", () => {
    expect(checkBaseUrl("  ")).toEqual({ ok: true, value: DEFAULT_BASE_URL });
  });
  it("accepts this computer on http, with or without the scheme", () => {
    expect(checkBaseUrl("http://127.0.0.1:23373")).toEqual({ ok: true, value: "http://127.0.0.1:23373" });
    expect(checkBaseUrl("localhost:23373/")).toEqual({ ok: true, value: "http://localhost:23373" });
    expect(checkBaseUrl("http://[::1]:9000")).toEqual({ ok: true, value: "http://[::1]:9000" });
    // The URL parser spells a short loopback address out; what is stored is what curl will be given.
    expect(checkBaseUrl("http://127.1:1")).toEqual({ ok: true, value: "http://127.0.0.1:1" });
  });
  it("refuses any other machine, scheme or extra part", () => {
    for (const bad of [
      "http://192.168.1.5:23373",
      "http://example.com",
      "http://127.0.0.1.example.com:1",
      "http://localhost@evil.example/",
      "http://user:pw@127.0.0.1:1",
      "https://127.0.0.1:23373",
      "ftp://127.0.0.1",
      "file:///etc/passwd",
      "http://127.0.0.1:23373/v1",
      "http://127.0.0.1:23373/?a=1",
      "http://127.0.0.1:23373/#x",
      "http://0.0.0.0:1",
      "not a url at all",
    ])
      expect(checkBaseUrl(bad).ok, bad).toBe(false);
  });
});

describe("createConfigStore", () => {
  it("keeps the token and the address, and tells listeners", () => {
    const storage = memory();
    const config = createConfigStore(storage);
    let calls = 0;
    const off = config.subscribe(() => (calls += 1));
    expect(config.hasToken()).toBe(false);
    expect(config.baseUrl()).toBe(DEFAULT_BASE_URL);
    config.saveToken("abcd1234efgh");
    config.saveBaseUrl("http://localhost:1234");
    expect(config.token()).toBe("abcd1234efgh");
    expect(config.baseUrl()).toBe("http://localhost:1234");
    config.saveBaseUrl(undefined);
    expect(config.baseUrl()).toBe(DEFAULT_BASE_URL);
    config.clearToken();
    expect(config.hasToken()).toBe(false);
    expect(calls).toBe(4);
    expect(config.version()).toBe(4);
    off();
    config.saveToken("zzzzzzzz");
    expect(calls).toBe(4);
  });
  it("checks the stored address when it is read, not only when it was typed", () => {
    const storage = memory();
    const config = createConfigStore(storage);
    for (const bad of ["http://evil.example", "http://192.168.0.2:23373", "https://127.0.0.1:23373", "http://127.0.0.1:23373/v1", "http://user@127.0.0.1:1", "not a url", "http://127.0.0.1:99999999"])
      {
        storage.setItem("megatech.beeper.base-url.v1", bad);
        expect(config.baseUrl(), bad).toBe(DEFAULT_BASE_URL);
      }
    storage.setItem("megatech.beeper.base-url.v1", "http://localhost:4242");
    expect(config.baseUrl()).toBe("http://localhost:4242");
  });

  it("survives storage that throws", () => {
    const config = createConfigStore({
      getItem() {
        throw new Error("denied");
      },
      setItem() {},
      removeItem() {},
    });
    expect(config.token()).toBeUndefined();
    expect(config.baseUrl()).toBe(DEFAULT_BASE_URL);
  });
});
