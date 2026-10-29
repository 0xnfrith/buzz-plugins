import type { LinearErrorKind } from "./client";

/** The part of `localStorage` the plugin uses, so tests can hand it a Map-backed one. */
export type KeyValue = {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
};

// Buzz has no storage or credential API for plugins yet, so the key lives in the app
// profile's localStorage, under this plugin's id, on this machine only. It is never sent
// anywhere but api.linear.app, never shown again after saving, and never logged.
const KEY = "megatech.linear.api-key.v1";

export function createKeyStore(storage: KeyValue) {
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version += 1;
    listeners.forEach((listener) => listener());
  };
  return {
    /** Changes whenever a key is saved or removed, for effects that must start over. */
    version: () => version,
    /** The saved key, for the client only. Nothing else should hold on to it. */
    read(): string | undefined {
      try {
        return storage.getItem(KEY) || undefined;
      } catch {
        return undefined;
      }
    },
    has(): boolean {
      return this.read() !== undefined;
    },
    save(key: string): void {
      storage.setItem(KEY, key);
      changed();
    },
    clear(): void {
      storage.removeItem(KEY);
      changed();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type KeyStore = ReturnType<typeof createKeyStore>;

/**
 * What to do with a pasted key once Linear has been asked about it. A key Linear refuses is never saved. A key Linear
 * could not be asked about (unreachable, down, rate limiting) replaces nothing: when a key is already saved it stays and
 * the user is told to try again; only when there is no key yet is the new one saved, and the message says it was not checked.
 * `message` is the whole text to show, or null to show the client's own text for the refusal.
 */
export function judgeKey(
  verdict: LinearErrorKind | "ok",
  hadKey: boolean,
  clientText: string,
): { save: boolean; message: string | null } {
  if (verdict === "ok") return { save: true, message: null };
  if (verdict === "auth" || verdict === "rejected") return { save: false, message: null };
  if (!hadKey) return { save: true, message: `${clientText} The key was saved without being checked; test it again in a moment.` };
  const why =
    verdict === "network"
      ? "Couldn't reach Linear to check the new key."
      : verdict === "rate-limited"
        ? "Linear is rate limiting requests, so the new key could not be checked."
        : "Linear is having trouble right now, so the new key could not be checked.";
  return { save: false, message: `${why} Your saved key is unchanged; try again${verdict === "rate-limited" ? " in a minute" : ""}.` };
}

export type KeyCheck = { ok: true; key: string } | { ok: false; message: string };

/** What was pasted, made safe to put in a header: no `Bearer`, no spaces or line breaks. */
export function checkKey(pasted: string): KeyCheck {
  const key = pasted.trim().replace(/^bearer\s+/i, "");
  if (!key) return { ok: false, message: "Paste your Linear API key." };
  if (key.length < 8 || key.length > 200 || !/^[\x21-\x7e]+$/.test(key))
    return { ok: false, message: "That does not look like a Linear API key." };
  return { ok: true, key };
}
