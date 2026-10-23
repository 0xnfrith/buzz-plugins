import { describe, expect, test } from "vitest";
import { checkKey, createKeyStore } from "../../src/linear/keys";
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
