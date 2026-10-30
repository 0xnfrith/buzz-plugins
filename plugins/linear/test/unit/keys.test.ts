import { describe, expect, test } from "vitest";
import { checkKey, createKeyStore, judgeKey } from "../../src/linear/keys";
import type { LinearErrorKind } from "../../src/linear/client";
import { memoryStorage } from "./fake";

describe("checkKey", () => {
  test("takes what was pasted, without Bearer or surrounding space", () => {
    expect(checkKey("  test-key-good\n")).toEqual({ ok: true, key: "test-key-good" });
    expect(checkKey("Bearer test-key-good")).toEqual({ ok: true, key: "test-key-good" });
  });

  test("refuses empty, short, long, spaced and non-ASCII input", () => {
    for (const bad of ["", "   ", "short", "x".repeat(201), "two words here", "tab\tseparated-key", "key-with-ünicode-chars"])
      expect(checkKey(bad).ok, JSON.stringify(bad)).toBe(false);
  });

  test("does not insist on any prefix", () => {
    expect(checkKey("some-other-token-format").ok).toBe(true);
  });
});

describe("key store", () => {
  test("saves, reads, clears, and tells subscribers each time", () => {
    const keys = createKeyStore(memoryStorage());
    const seen: number[] = [];
    const stop = keys.subscribe(() => seen.push(keys.version()));
    expect(keys.has()).toBe(false);
    keys.save("test-key-good");
    expect(keys.read()).toBe("test-key-good");
    keys.clear();
    expect(keys.has()).toBe(false);
    stop();
    keys.save("test-key-other");
    expect(seen).toEqual([1, 2]);
  });

  test("a storage that throws reads as no key", () => {
    const keys = createKeyStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(keys.read()).toBeUndefined();
  });
});

describe("what happens to a key once Linear has been asked about it", () => {
  const cannotAsk: LinearErrorKind[] = ["network", "server", "rate-limited"];

  test("a key Linear accepts is saved, whether or not one was saved before", () => {
    expect(judgeKey("ok", true, "")).toEqual({ save: true, message: null });
    expect(judgeKey("ok", false, "")).toEqual({ save: true, message: null });
  });

  test("a key Linear refuses is never saved, with or without a saved one", () => {
    for (const kind of ["auth", "rejected"] as const)
      for (const hadKey of [true, false]) expect(judgeKey(kind, hadKey, "Linear did not accept the API key."), `${kind} ${hadKey}`).toEqual({ save: false, message: null });
  });

  test("a replacement that cannot be checked (unreachable, 5xx, rate limited) keeps the saved key and says to try again", () => {
    for (const kind of cannotAsk) {
      const ruling = judgeKey(kind, true, "the client's text");
      expect(ruling.save, kind).toBe(false);
      expect(ruling.message, kind).toContain("Your saved key is unchanged; try again");
      expect(ruling.message, kind).toContain("new key");
    }
    expect(judgeKey("network", true, "x").message).toBe("Couldn't reach Linear to check the new key. Your saved key is unchanged; try again.");
    expect(judgeKey("rate-limited", true, "x").message).toContain("try again in a minute");
  });

  test("the first key is saved even when Linear cannot be asked, and the message says it was not checked", () => {
    for (const kind of cannotAsk) {
      const ruling = judgeKey(kind, false, "Could not reach Linear.");
      expect(ruling.save, kind).toBe(true);
      expect(ruling.message, kind).toBe("Could not reach Linear. The key was saved without being checked; test it again in a moment.");
    }
  });
});
