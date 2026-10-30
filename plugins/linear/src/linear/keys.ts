import type { LinearErrorKind } from "./client";

/** The part of `localStorage` the plugin uses, so tests can hand it a Map-backed one. */
export type KeyValue = {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
};

// Buzz has no storage or credential API for plugins. Where the system has a credential store that a declared command can
// reach, the key goes there: on macOS, the Keychain, through the `security` program (see manifest.json). Everywhere else the
// key is kept in the app profile's localStorage, under this plugin's id, in plain text, and the settings card says so. It is
// sent only to api.linear.app, never shown again after saving, and never logged.
const KEY = "megatech.linear.api-key.v1";

/** The commands the manifest declares for the Keychain. */
export type SecretCommand = "keychain-read" | "keychain-save" | "keychain-delete";
export type SecretRun = (command: SecretCommand, input?: string) => Promise<string | null>;

/** Where the saved key is. */
export type KeyPlace = "keychain" | "profile";

export type KeyStoreOptions = {
  /** Runs one of the Keychain commands: `null` is any failure (the host does not say which). */
  run?: SecretRun;
  /** The Keychain can be used here (macOS). */
  keychain?: boolean;
};

/** The one command, to run in Terminal, that asks for the key and saves it where the plugin looks. It carries no secret. */
export const KEYCHAIN_TERMINAL_COMMAND = "security add-generic-password -U -s buzz-linear -a linear -w";

const withoutLineBreak = (text: string | null | undefined) => text?.replace(/\r?\n$/, "");

export function createKeyStore(storage: KeyValue, { run, keychain = false }: KeyStoreOptions = {}) {
  const listeners = new Set<() => void>();
  let version = 0;
  // `restart` says the key itself is another one (saved, replaced, removed, found elsewhere), so what was read with the old one is stale.
  // Moving the same key between places, or the first look for it, tells the listeners but does not restart anything.
  const notify = (restart: boolean) => {
    if (restart) version += 1;
    listeners.forEach((listener) => listener());
  };
  const usable = keychain && run !== undefined;
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
      // A copy that cannot be removed is not read while the Keychain has the key.
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

  /** Puts a key in the Keychain and reads it back to be sure: the program's own exit status is not trusted to say. */
  async function toKeychain(value: string): Promise<boolean> {
    if (!usable) return false;
    // `-w` last, with no value, makes the program ask for the password and then for it again: on its standard input here.
    await secret("keychain-save", `${value}\n${value}\n`);
    if (withoutLineBreak(await secret("keychain-read")) !== value) return false;
    // Only now, with the Keychain confirmed to hold it, does a copy in the profile go.
    dropProfileCopy();
    return true;
  }

  /** Looks for the key: the Keychain first, then the profile. A key found in the profile on a Mac is moved to the Keychain. */
  async function load(initial: boolean): Promise<void> {
    const [before, placeBefore] = [key, place];
    const kept = usable ? withoutLineBreak(await secret("keychain-read")) || undefined : undefined;
    const plain = profileCopy();
    if (kept) {
      [key, place] = [kept, "keychain"];
      // The Keychain is the one that counts; a copy left in the profile is the same key or an older one.
      if (plain !== undefined) dropProfileCopy();
    } else if (plain !== undefined) {
      [key, place] = [plain, "profile"];
      // The move: the Keychain takes it, is read back, and only then does the plain copy go. If it will not, the copy stays, in use, and is tried again next start.
      if (usable && (await toKeychain(plain))) place = "keychain";
    } else {
      [key, place] = [undefined, undefined];
    }
    if (initial || key !== before || place !== placeBefore) notify(!initial && key !== before);
  }

  const ready = serial(() => load(true));

  return {
    /** Changes whenever the key is another one, for effects that must start over. */
    version: () => version,
    /** Settles when the first look for the key (and the move out of the profile) is over. */
    ready,
    /** Looks again (the Keychain may have been given the key from outside). */
    reload: () => serial(() => load(false)),
    /** The saved key, for the client only. Nothing else should hold on to it. */
    read: () => key,
    has: () => key !== undefined,
    place: () => place,
    keychainAvailable: () => usable,
    /**
     * Keeps a key: in the Keychain where there is one (false when it would not take it, with nothing kept and a saved key
     * unchanged), otherwise in the profile as plain text.
     */
    save: (value: string): Promise<boolean> =>
      serial(async () => {
        if (usable) {
          if (!(await toKeychain(value))) return false;
          [key, place] = [value, "keychain"];
        } else {
          storage.setItem(KEY, value);
          [key, place] = [value, "profile"];
        }
        notify(true);
        return true;
      }),
    /** Moves a key kept in the profile to the Keychain; false when it would not take it and the key stays where it was. */
    moveToKeychain: (): Promise<boolean> =>
      serial(async () => {
        if (key === undefined || place !== "profile" || !(await toKeychain(key))) return false;
        place = "keychain";
        notify(false);
        return true;
      }),
    /** Removes the key from the Keychain and the profile. False when one still has it afterwards (it then stays in use). */
    clear: (): Promise<boolean> =>
      serial(async () => {
        dropProfileCopy();
        let left = profileCopy();
        let where: KeyPlace | undefined = left === undefined ? undefined : "profile";
        if (usable) {
          await secret("keychain-delete");
          const kept = withoutLineBreak(await secret("keychain-read")) || undefined;
          if (kept) [left, where] = [kept, "keychain"];
        }
        [key, place] = [left, where];
        notify(true);
        return left === undefined;
      }),
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
