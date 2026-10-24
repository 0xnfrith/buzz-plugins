/** The part of `localStorage` the plugin uses, so tests can hand it a Map-backed one. */
export type KeyValue = {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
};

// Buzz has no storage or credential API for plugins yet, so the token lives in the app
// profile's localStorage, under this plugin's id, on this machine only. It is sent only to
// Beeper Desktop on this computer, never shown again after saving, and never logged.
const TOKEN = "megatech.beeper.token.v1";
const BASE_URL = "megatech.beeper.base-url.v1";

/** Where Beeper Desktop listens by default. */
export const DEFAULT_BASE_URL = "http://127.0.0.1:23373";

export function createConfigStore(storage: KeyValue) {
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version += 1;
    listeners.forEach((listener) => listener());
  };
  const read = (name: string) => {
    try {
      return storage.getItem(name) || undefined;
    } catch {
      return undefined;
    }
  };
  return {
    /** Changes whenever the token or the address changes, for effects that must start over. */
    version: () => version,
    /** The saved token, for the client only. Nothing else should hold on to it. */
    token: () => read(TOKEN),
    hasToken: () => read(TOKEN) !== undefined,
    saveToken(token: string): void {
      storage.setItem(TOKEN, token);
      changed();
    },
    clearToken(): void {
      storage.removeItem(TOKEN);
      changed();
    },
    // Checked again here, not only when typed: whatever is in the profile's storage, only this computer is ever called.
    baseUrl(): string {
      const stored = read(BASE_URL);
      const checked = stored === undefined ? undefined : checkBaseUrl(stored);
      return checked?.ok ? checked.value : DEFAULT_BASE_URL;
    },
    /** `undefined` puts the default back. */
    saveBaseUrl(url: string | undefined): void {
      if (url === undefined || url === DEFAULT_BASE_URL) storage.removeItem(BASE_URL);
      else storage.setItem(BASE_URL, url);
      changed();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type ConfigStore = ReturnType<typeof createConfigStore>;

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** What was pasted, made safe to put in a header: no `Bearer`, no spaces or line breaks. */
/** Longer than any real token; the cap leaves room in one request for a long message. */
const MAX_TOKEN = 500;

export function checkToken(pasted: string): Checked<string> {
  const token = pasted.trim().replace(/^bearer\s+/i, "");
  if (!token) return { ok: false, message: "Paste your Beeper access token." };
  if (token.length < 8 || token.length > MAX_TOKEN || !/^[\x21-\x7e]+$/.test(token))
    return { ok: false, message: "That does not look like a Beeper access token." };
  return { ok: true, value: token };
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The address of Beeper Desktop: plain http, on this computer only, nothing after the port. */
export function checkBaseUrl(typed: string): Checked<string> {
  const text = typed.trim();
  if (!text) return { ok: true, value: DEFAULT_BASE_URL };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    return { ok: false, message: `Type an address like ${DEFAULT_BASE_URL}.` };
  }
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname) || url.username || url.password)
    return { ok: false, message: "Beeper Desktop runs on this computer: use http://127.0.0.1 or http://localhost with its port." };
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash)
    return { ok: false, message: "Give only the address and port, nothing after it." };
  return { ok: true, value: url.origin };
}
