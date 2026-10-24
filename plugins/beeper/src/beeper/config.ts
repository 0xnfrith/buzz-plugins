/** The part of `localStorage` the plugin uses, so tests can hand it a Map-backed one. */
export type KeyValue = {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
};

// Buzz has no storage or credential API for plugins yet. Where the system has a credential store that a declared
// command can reach, the token goes there: on macOS, the Keychain, through the `security` program (see manifest.json).
// Everywhere else, and when the person chooses it, the token is kept in the app profile's localStorage, under this
// plugin's id, in plain text, and the settings card says so. It is sent only to Beeper Desktop on this computer,
// never shown again after saving, and never logged. The address is not secret and always lives in localStorage.
const TOKEN = "megatech.beeper.token.v1";
const BASE_URL = "megatech.beeper.base-url.v1";

/** Where Beeper Desktop listens by default. */
export const DEFAULT_BASE_URL = "http://127.0.0.1:23373";

/** The commands the manifest declares for the Keychain. */
export type SecretCommand = "keychain-read" | "keychain-save" | "keychain-delete";
export type SecretRun = (command: SecretCommand, input?: string) => Promise<string | null>;

/** Where the saved token is. */
export type TokenPlace = "keychain" | "profile";

export type ConfigOptions = {
  /** Runs one of the Keychain commands. */
  run?: SecretRun;
  /** The Keychain can be used here (macOS). */
  keychain?: boolean;
};

/** The one command, to run in Terminal, that asks for the token and saves it where the plugin looks. It carries no secret. */
export const KEYCHAIN_TERMINAL_COMMAND = "security add-generic-password -U -s buzz-beeper -a beeper -w";

const withoutLineBreak = (text: string | null | undefined) => text?.replace(/\r?\n$/, "");

export function createConfigStore(storage: KeyValue, { run, keychain = false }: ConfigOptions = {}) {
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
  const usable = keychain && run !== undefined;
  const secret = (command: SecretCommand, input?: string) => (run ? run(command, input).catch(() => null) : Promise.resolve(null));

  // The token is read once and held in memory, so a request does not start a program to find it.
  let token: string | undefined;
  let place: TokenPlace | undefined;
  const signature = () => `${place ?? ""}:${token ?? ""}`;

  /** Looks for the token again: the Keychain first, then the profile. */
  async function load(): Promise<void> {
    const before = signature();
    let found: string | undefined;
    let where: TokenPlace | undefined;
    if (usable) {
      const kept = withoutLineBreak(await secret("keychain-read"));
      if (kept) [found, where] = [kept, "keychain"];
    }
    if (!found) {
      const stored = read(TOKEN);
      if (stored) [found, where] = [stored, "profile"];
    }
    [token, place] = [found, where];
    if (signature() !== before) changed();
  }

  /** Puts a token in the Keychain, and reads it back to be sure: the program's own exit status is not trusted to say. */
  async function toKeychain(value: string): Promise<boolean> {
    if (!usable) return false;
    // `-w` last, with no value, makes the program ask for the password and then for it again: on its standard input here.
    await secret("keychain-save", `${value}\n${value}\n`);
    if (withoutLineBreak(await secret("keychain-read")) !== value) return false;
    try {
      storage.removeItem(TOKEN);
    } catch {
      // A copy in the profile that cannot be removed is not read while the Keychain has one.
    }
    [token, place] = [value, "keychain"];
    changed();
    return true;
  }

  return {
    /** Changes whenever the token or the address changes, for effects that must start over. */
    version: () => version,
    /** Settles when the first look for the token is over. */
    ready: load(),
    /** Looks again (the Keychain may have been given the token from outside, or have asked and been answered). */
    reload: load,
    /** The saved token, for the client only. Nothing else should hold on to it. */
    token: () => token,
    hasToken: () => token !== undefined,
    place: () => place,
    keychainAvailable: () => usable,
    /** False when the Keychain would not keep it (the caller then shows how to put it there by hand). */
    saveToKeychain: toKeychain,
    /** The explicit fallback: plain text in the app's profile. */
    async saveToProfile(value: string): Promise<void> {
      storage.setItem(TOKEN, value);
      // A token left in the Keychain would be read in its place at the next start.
      if (usable) await secret("keychain-delete");
      [token, place] = [value, "profile"];
      changed();
    },
    /** Moves a token kept in the profile to the Keychain. */
    async moveToKeychain(): Promise<boolean> {
      return token !== undefined && place === "profile" ? toKeychain(token) : false;
    },
    /** False when the Keychain still has it afterwards. */
    async clearToken(): Promise<boolean> {
      storage.removeItem(TOKEN);
      if (usable) {
        await secret("keychain-delete");
        const left = withoutLineBreak(await secret("keychain-read"));
        if (left) {
          [token, place] = [left, "keychain"];
          changed();
          return false;
        }
      }
      [token, place] = [undefined, undefined];
      changed();
      return true;
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
