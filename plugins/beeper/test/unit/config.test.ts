import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, checkBaseUrl, checkToken, createConfigStore, type SecretRun } from "../../src/beeper/config";

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

describe("createConfigStore, without a Keychain", () => {
  it("keeps the token and the address, and tells listeners", async () => {
    const storage = memory();
    const config = createConfigStore(storage);
    await config.ready;
    let calls = 0;
    const off = config.subscribe(() => (calls += 1));
    expect(config.hasToken()).toBe(false);
    expect(config.keychainAvailable()).toBe(false);
    expect(config.baseUrl()).toBe(DEFAULT_BASE_URL);
    await config.saveToProfile("abcd1234efgh");
    config.saveBaseUrl("http://localhost:1234");
    expect(config.token()).toBe("abcd1234efgh");
    expect(config.place()).toBe("profile");
    expect(config.baseUrl()).toBe("http://localhost:1234");
    config.saveBaseUrl(undefined);
    expect(config.baseUrl()).toBe(DEFAULT_BASE_URL);
    expect(await config.clearToken()).toBe(true);
    expect(config.hasToken()).toBe(false);
    expect(calls).toBe(4);
    expect(config.version()).toBe(4);
    off();
    await config.saveToProfile("zzzzzzzz");
    expect(calls).toBe(4);
  });

  it("finds a token saved in an earlier session", async () => {
    const storage = memory();
    storage.setItem("megatech.beeper.token.v1", "from-the-profile");
    const config = createConfigStore(storage);
    await config.ready;
    expect(config.token()).toBe("from-the-profile");
    expect(config.place()).toBe("profile");
  });

  it("will not use the Keychain even if asked to, when it is not available", async () => {
    const config = createConfigStore(memory(), { keychain: false, run: async () => "should-not-be-asked" });
    await config.ready;
    expect(config.hasToken()).toBe(false);
    expect(await config.saveToKeychain("abcd1234efgh")).toBe(false);
    expect(await config.moveToKeychain()).toBe(false);
  });

  it("survives storage that throws", async () => {
    const config = createConfigStore({
      getItem() {
        throw new Error("denied");
      },
      setItem() {},
      removeItem() {},
    });
    await config.ready;
    expect(config.token()).toBeUndefined();
    expect(config.baseUrl()).toBe(DEFAULT_BASE_URL);
  });
});

/** A Keychain kept in memory, behaving as the plugin assumes the real one does. `broken` makes saving and deleting do nothing. */
function keychainOf(initial?: string) {
  const state = { item: initial, broken: false, saves: [] as string[], calls: [] as string[] };
  const run: SecretRun = async (command, input) => {
    state.calls.push(command);
    if (command === "keychain-read") return state.item === undefined ? null : `${state.item}\n`;
    if (command === "keychain-save") {
      state.saves.push(input ?? "");
      const [first, second] = (input ?? "").split("\n");
      if (!state.broken && first && first === second) state.item = first;
      return "";
    }
    if (!state.broken) state.item = undefined;
    return "";
  };
  return { state, run };
}

describe("createConfigStore, with a Keychain", () => {
  it("prefers the Keychain, and falls back to the profile when it has nothing", async () => {
    const both = memory();
    both.setItem("megatech.beeper.token.v1", "profile-token");
    const a = createConfigStore(both, { keychain: true, run: keychainOf("keychain-token").run });
    await a.ready;
    expect([a.token(), a.place()]).toEqual(["keychain-token", "keychain"]);
    const only = memory();
    only.setItem("megatech.beeper.token.v1", "profile-token");
    const b = createConfigStore(only, { keychain: true, run: keychainOf().run });
    await b.ready;
    expect([b.token(), b.place()]).toEqual(["profile-token", "profile"]);
    const c = createConfigStore(memory(), { keychain: true, run: keychainOf().run });
    await c.ready;
    expect(c.hasToken()).toBe(false);
  });

  it("reads the Keychain once, however often the token is asked for", async () => {
    const { state, run } = keychainOf("keychain-token");
    const config = createConfigStore(memory(), { keychain: true, run });
    await config.ready;
    for (let i = 0; i < 20; i += 1) config.token();
    expect(state.calls).toEqual(["keychain-read"]);
  });

  it("saves to the Keychain on standard input, checks by reading it back, and drops the profile copy", async () => {
    const storage = memory();
    storage.setItem("megatech.beeper.token.v1", "old-profile-token");
    const { state, run } = keychainOf();
    const config = createConfigStore(storage, { keychain: true, run });
    await config.ready;
    expect(config.place()).toBe("profile");
    let calls = 0;
    config.subscribe(() => (calls += 1));
    expect(await config.saveToKeychain("new-keychain-token")).toBe(true);
    // The token goes in twice, one line each: the program asks for it, and then for it again.
    expect(state.saves).toEqual(["new-keychain-token\nnew-keychain-token\n"]);
    expect(state.item).toBe("new-keychain-token");
    expect([config.token(), config.place()]).toEqual(["new-keychain-token", "keychain"]);
    expect(storage.map.has("megatech.beeper.token.v1")).toBe(false);
    expect(calls).toBe(1);
  });

  it("does not say it saved when reading it back does not give the token, and keeps what it had", async () => {
    const storage = memory();
    storage.setItem("megatech.beeper.token.v1", "old-profile-token");
    const { state, run } = keychainOf();
    state.broken = true;
    const config = createConfigStore(storage, { keychain: true, run });
    await config.ready;
    expect(await config.saveToKeychain("new-keychain-token")).toBe(false);
    expect([config.token(), config.place()]).toEqual(["old-profile-token", "profile"]);
    expect(storage.map.get("megatech.beeper.token.v1")).toBe("old-profile-token");
  });

  it("does not take an old Keychain token for a new one that did not get saved", async () => {
    const { state, run } = keychainOf("old-keychain-token");
    state.broken = true;
    const config = createConfigStore(memory(), { keychain: true, run });
    await config.ready;
    expect(await config.saveToKeychain("new-keychain-token")).toBe(false);
    expect(config.token()).toBe("old-keychain-token");
  });

  it("saves to the profile only when asked, and removes the Keychain copy so it does not come back", async () => {
    const storage = memory();
    const { state, run } = keychainOf("keychain-token");
    const config = createConfigStore(storage, { keychain: true, run });
    await config.ready;
    await config.saveToProfile("profile-token");
    expect(storage.map.get("megatech.beeper.token.v1")).toBe("profile-token");
    expect(state.item).toBeUndefined();
    expect([config.token(), config.place()]).toEqual(["profile-token", "profile"]);
  });

  it("moves a profile token to the Keychain", async () => {
    const storage = memory();
    storage.setItem("megatech.beeper.token.v1", "profile-token");
    const { state, run } = keychainOf();
    const config = createConfigStore(storage, { keychain: true, run });
    await config.ready;
    expect(await config.moveToKeychain()).toBe(true);
    expect(state.item).toBe("profile-token");
    expect(storage.map.has("megatech.beeper.token.v1")).toBe(false);
    expect(await config.moveToKeychain()).toBe(false); // already there
  });

  it("removes the token from both places, and says so when the Keychain will not let go", async () => {
    const storage = memory();
    storage.setItem("megatech.beeper.token.v1", "profile-token");
    const { state, run } = keychainOf("keychain-token");
    const config = createConfigStore(storage, { keychain: true, run });
    await config.ready;
    expect(await config.clearToken()).toBe(true);
    expect(state.item).toBeUndefined();
    expect(storage.map.size).toBe(0);
    expect(config.hasToken()).toBe(false);
    const stuck = keychainOf("keychain-token");
    stuck.state.broken = true;
    const kept = createConfigStore(memory(), { keychain: true, run: stuck.run });
    await kept.ready;
    expect(await kept.clearToken()).toBe(false);
    expect([kept.token(), kept.place()]).toEqual(["keychain-token", "keychain"]);
  });

  it("looks again when asked, for a token put in the Keychain from outside", async () => {
    const { state, run } = keychainOf();
    const config = createConfigStore(memory(), { keychain: true, run });
    await config.ready;
    expect(config.hasToken()).toBe(false);
    let calls = 0;
    config.subscribe(() => (calls += 1));
    await config.reload();
    expect(calls).toBe(0);
    state.item = "put-there-by-hand";
    await config.reload();
    expect([config.token(), config.place()]).toEqual(["put-there-by-hand", "keychain"]);
    expect(calls).toBe(1);
  });

  it("treats a program that fails, or throws, as a Keychain with nothing in it", async () => {
    const config = createConfigStore(memory(), {
      keychain: true,
      run: async () => {
        throw new Error("no such program");
      },
    });
    await config.ready;
    expect(config.hasToken()).toBe(false);
    expect(await config.saveToKeychain("abcd1234efgh")).toBe(false);
  });
});

describe("the stored address", () => {
  it("is checked when it is read, not only when it was typed", () => {
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
});
