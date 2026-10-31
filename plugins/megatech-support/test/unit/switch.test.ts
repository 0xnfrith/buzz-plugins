import { describe, expect, it } from "vitest";
import { SWITCH_KEY, createSwitch } from "../../src/support/switch";

const memory = () => {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
};

describe("the saved switch", () => {
  it("is off until it is turned on, and its key is the plugin's", () => {
    const storage = memory();
    const flag = createSwitch(storage);
    expect(flag.get()).toBe(false);
    expect(SWITCH_KEY).toMatch(/^megatech\.support\./);
    flag.set(true);
    expect(storage.data.get(SWITCH_KEY)).toBe("on");
    expect(flag.get()).toBe(true);
    flag.set(false);
    expect(storage.data.get(SWITCH_KEY)).toBe("off");
    expect(flag.get()).toBe(false);
  });

  it("is on only for the exact saved word", () => {
    for (const value of ["", "ON", "true", "yes", "1", " on", "on "]) {
      const storage = memory();
      storage.data.set(SWITCH_KEY, value);
      expect(createSwitch(storage).get()).toBe(false);
    }
  });

  it("stays off, and does not throw, when the profile will not keep or give it", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const flag = createSwitch(broken);
    expect(flag.get()).toBe(false);
    expect(() => flag.set(true)).not.toThrow();
  });
});
