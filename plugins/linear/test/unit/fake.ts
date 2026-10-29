import { createClient } from "../../src/linear/client";
import { createBoardStore } from "../../src/linear/store";
// @ts-expect-error plain ES module without declarations
import { createFakeLinear } from "../fake-linear/server.mjs";

export type Fake = ReturnType<typeof createFakeLinear> & { control: any };

export function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (name: string) => map.get(name) ?? null,
    setItem: (name: string, value: string) => void map.set(name, value),
    removeItem: (name: string) => void map.delete(name),
  };
}

/** A store wired to a fresh fake Linear, with a key that the fake accepts. */
export function setup(options: { key?: string | undefined } = {}) {
  const fake: Fake = createFakeLinear();
  const key = "key" in options ? options.key : fake.keys.good;
  const storage = memoryStorage();
  const client = createClient((request) => fake.handle(request), () => key);
  const store = createBoardStore(client, storage);
  return { fake, store, client, storage };
}
