import type { LinearErrorKind } from "./client";

/** The part of `localStorage` the plugin uses, so tests can hand it a Map-backed one. */
export type KeyValue = {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
};

// Buzz has no storage or credential API for plugins. Where the system has a credential store that a declared command can
// reach, the key goes there: on macOS the Keychain, through the `security` program; on Linux the Secret Service (gnome-keyring,
// KWallet, ...), through `secret-tool` (see manifest.json). Where there is none, or on Linux when none is running, the key is
// kept in the app profile's localStorage, under this plugin's id, in plain text, and the settings card says so. It is sent only
// to api.linear.app, never shown again after saving, and never logged.
const KEY = "megatech.linear.api-key.v1";

/** The commands the manifest declares for the system stores. */
export type SecretCommand =
  | "keychain-read"
  | "keychain-save"
  | "keychain-delete"
  | "secret-read"
  | "secret-save"
  | "secret-delete";
export type SecretRun = (command: SecretCommand, input?: string) => Promise<string | null>;

/** The system stores this plugin can use: the macOS Keychain, the Linux Secret Service. */
export type StoreKind = "keychain" | "secret-service";

/** Where the saved key is. */
export type KeyPlace = StoreKind | "profile";

export type KeyStoreOptions = {
  /** Runs one of the store commands: `null` is any failure (the host does not say which). */
  run?: SecretRun;
  /** The store this system has, if any. */
  store?: StoreKind;
};

/** How each store is driven, and what a save that is not confirmed means there. */
const STORES: Record<StoreKind, { read: SecretCommand; save: SecretCommand; delete: SecretCommand; input(value: string): string; plainFallback: boolean }> = {
  keychain: {
    read: "keychain-read",
    save: "keychain-save",
    delete: "keychain-delete",
    // `-w` last, with no value, makes `security` ask for the password and then for it again: on its standard input here.
    input: (value) => `${value}\n${value}\n`,
    // On a Mac a save that is not confirmed keeps nothing, and the card shows the command to run in Terminal.
    plainFallback: false,
  },
  "secret-service": {
    read: "secret-read",
    save: "secret-save",
    delete: "secret-delete",
    // `secret-tool store` reads standard input to the end and keeps what it gets, a trailing line break included.
    input: (value) => value,
    // On Linux a save that is not confirmed (no Secret Service running, a locked keyring nobody can unlock) goes to the profile, labelled.
    plainFallback: true,
  },
};

/** What the card calls each store. */
export const STORE_NAME: Record<StoreKind, string> = { keychain: "your Keychain", "secret-service": "the system secret store (Secret Service)" };

/** The one command, to run in Terminal, that asks for the key and saves it where the plugin looks on a Mac. It carries no secret. */
export const KEYCHAIN_TERMINAL_COMMAND = "security add-generic-password -U -s buzz-linear -a linear -w";

/** Which store this system has, from what the page says it runs on. */
export function detectStore(platform: string | undefined, userAgent: string | undefined): StoreKind | undefined {
  const [p, ua] = [platform ?? "", userAgent ?? ""];
  if (/^Mac/i.test(p) || /Macintosh/.test(ua)) return "keychain";
  if ((/^Linux/i.test(p) || /Linux/.test(ua)) && !/Android/i.test(ua)) return "secret-service";
  return undefined;
}

const withoutLineBreak = (text: string | null | undefined) => text?.replace(/\r?\n$/, "");

export function createKeyStore(storage: KeyValue, { run, store }: KeyStoreOptions = {}) {
  const listeners = new Set<() => void>();
  let version = 0;
  // `restart` says the key itself is another one (saved, replaced, removed, found elsewhere), so what was read with the old one is stale.
  // Moving the same key between places, or the first look for it, tells the listeners but does not restart anything.
  const notify = (restart: boolean) => {
    if (restart) version += 1;
    listeners.forEach((listener) => listener());
  };
  const kind = run !== undefined ? store : undefined;
  const driver = kind ? STORES[kind] : undefined;
  const secret = (command: SecretCommand, input?: string) => (run ? run(command, input).catch(() => null) : Promise.resolve(null));

  const profileCopy = (): string | undefined => {
    try {
      return storage.getItem(KEY) || undefined;
    } catch {
      return undefined;
    }
  };
  const dropProfileCopy = () => {
    try {
      storage.removeItem(KEY);
    } catch {
      // A copy that cannot be removed is not read while the store has the key.
    }
  };

  // The key is read once and held in memory, so a request does not start a program to find it.
  let key: string | undefined;
  let place: KeyPlace | undefined;

  // One thing at a time: a save cannot start while the first look (and the move out of the profile) is under way.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T,>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task, task);
    tail = next.catch(() => undefined);
    return next;
  };

  const readStore = async (): Promise<string | undefined> => (driver ? withoutLineBreak(await secret(driver.read)) || undefined : undefined);

  /** Puts a key in the store and reads it back to be sure: the program's own exit status is not trusted to say. */
  async function toStore(value: string): Promise<boolean> {
    if (!driver) return false;
    await secret(driver.save, driver.input(value));
    if ((await readStore()) !== value) return false;
    // Only now, with the store confirmed to hold it, does a copy in the profile go.
    dropProfileCopy();
    return true;
  }

  /**
   * Looks for the key: the store first, then the profile. A key in the profile where there is a store is moved to it. When both
   * hold a key and they differ, which is newer depends on the system. Where a key that the store would not take is kept in the
   * profile (Linux: `plainFallback`), the profile's is the newer one, written while the store could not be reached, so it is moved
   * over the store's with the same read-back, the older key staying in the store until the read-back says the newer one is there.
   * Where nothing is ever kept in the profile (a Mac), a copy there is always an older one, from an earlier version or from a move
   * that did not work, and the key the person put in the store since wins, whatever tool put it there; the old plain copy goes.
   */
  async function load(initial: boolean): Promise<void> {
    const [before, placeBefore] = [key, place];
    const kept = await readStore();
    const plain = profileCopy();
    const profileIsNewer = driver?.plainFallback === true;
    if (kept && (plain === undefined || plain === kept || !profileIsNewer)) {
      [key, place] = [kept, kind];
      // The same key twice (a crash between "saved" and "deleted"), or an older one: the copy in the profile goes, now that the store's key is the one in use.
      if (plain !== undefined) dropProfileCopy();
    } else if (plain !== undefined) {
      [key, place] = [plain, "profile"];
      // The move: the store takes it, is read back, and only then does the plain copy go. If it will not, the copy stays, in use, and is tried again next start.
      if (driver && (await toStore(plain))) place = kind;
    } else {
      [key, place] = [undefined, undefined];
    }
    if (initial || key !== before || place !== placeBefore) notify(!initial && key !== before);
  }

  // The first look is not made when the plugin loads but the first time something asks for the key (the Linear page or its
  // card opening, a request, a save), so a locked keyring or a Keychain that asks does not ask at every start of Buzz.
  let started: Promise<void> | undefined;
  const begin = (): Promise<void> => (started ??= serial(() => load(true)));

  return {
    /** Changes whenever the key is another one, for effects that must start over. */
    version: () => version,
    /** Settles when the first look for the key (and the move out of the profile) is over; asking for it makes the look. */
    get ready(): Promise<void> {
      return begin();
    },
    /** Looks again (the store may have been given the key from outside). */
    reload: () => {
      begin();
      return serial(() => load(false));
    },
    /** The saved key, for the client only. Nothing else should hold on to it. */
    read: () => key,
    has: () => key !== undefined,
    place: () => place,
    /** The store this system has and the plugin can drive, if any. */
    store: () => kind,
    /**
     * Keeps a key, in the store where there is one, otherwise in the profile as plain text. When the store does not confirm it:
     * on a Mac nothing is kept (`kept: false`, a saved key unchanged); on Linux the key goes to the profile, labelled
     * (`degraded: true`), unless the store already holds a key, which a plain copy would only shadow (`kept: false`).
     */
    save: (value: string): Promise<{ kept: boolean; degraded: boolean }> => {
      begin();
      return serial(async () => {
        let degraded = false;
        if (driver) {
          if (await toStore(value)) {
            [key, place] = [value, kind];
          } else if (driver.plainFallback && place !== kind) {
            storage.setItem(KEY, value);
            [key, place] = [value, "profile"];
            degraded = true;
          } else {
            return { kept: false, degraded: false };
          }
        } else {
          storage.setItem(KEY, value);
          [key, place] = [value, "profile"];
        }
        notify(true);
        return { kept: true, degraded };
      });
    },
    /** Moves a key kept in the profile to the store; false when it would not take it and the key stays where it was. */
    moveToStore: (): Promise<boolean> => {
      begin();
      return serial(async () => {
        if (key === undefined || place !== "profile" || !(await toStore(key))) return false;
        place = kind;
        notify(false);
        return true;
      });
    },
    /** Removes the key from the store and the profile. False when one still has it afterwards (it then stays in use). */
    clear: (): Promise<boolean> => {
      begin();
      return serial(async () => {
        dropProfileCopy();
        let left = profileCopy();
        let where: KeyPlace | undefined = left === undefined ? undefined : "profile";
        if (driver) {
          await secret(driver.delete);
          const kept = await readStore();
          if (kept) [left, where] = [kept, kind];
        }
        [key, place] = [left, where];
        notify(true);
        return left === undefined;
      });
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
