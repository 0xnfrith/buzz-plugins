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

export type KeyCheck = { ok: true; key: string } | { ok: false; message: string };

/** What was pasted, made safe to put in a header: no `Bearer`, no spaces or line breaks. */
export function checkKey(pasted: string): KeyCheck {
  const key = pasted.trim().replace(/^bearer\s+/i, "");
  if (!key) return { ok: false, message: "Paste your Linear API key." };
  if (key.length < 8 || key.length > 200 || !/^[\x21-\x7e]+$/.test(key))
    return { ok: false, message: "That does not look like a Linear API key." };
  return { ok: true, key };
}
