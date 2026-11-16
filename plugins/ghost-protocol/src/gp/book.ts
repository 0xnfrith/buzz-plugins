// Which container belongs to which agent. Buzz tells a type's `remove` only the agent's public key, and the plugin's tab only the agent,
// while a container is named from the agent's name when it was made (a name can change after), so the plugin writes the pair down when
// it makes one. It lives in this computer's browser storage: the agents are on this computer too, and nothing in it is secret. If the
// storage is cleared the pair is gone, and a removal then touches nothing: the container stays in Docker, where the person can see it.
import { isSlug } from "../slug";

const KEY = "megatech.ghost-protocol.agents";

type Store = Pick<Storage, "getItem" | "setItem">;

export type Book = Readonly<{
  get(pubkey: string): string | undefined;
  set(pubkey: string, slug: string): void;
  delete(pubkey: string): void;
}>;

export function createBook(storage: () => Store | undefined = defaultStorage): Book {
  const read = (): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(storage()?.getItem(KEY) ?? "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => /^[0-9a-f]{64}$/.test(key) && typeof value === "string" && isSlug(value))) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const write = (next: Record<string, string>) => {
    try {
      storage()?.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage is full, or blocked: the pair is not kept.
    }
  };
  return {
    get: (pubkey) => read()[pubkey],
    set(pubkey, slug) {
      write({ ...read(), [pubkey]: slug });
    },
    delete(pubkey) {
      const { [pubkey]: _gone, ...rest } = read();
      write(rest);
    },
  };
}

function defaultStorage(): Store | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    // Reading `localStorage` throws when site data is blocked.
    return undefined;
  }
}
