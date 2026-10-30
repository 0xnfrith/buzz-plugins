import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createKeyStore, detectStore, type SecretCommand } from "../../src/linear/keys";
import { declaredCommands, runCommand } from "../host-sim.mjs";

// The key store on Linux, against the real processes of the manifest's `secret-tool` commands, run as Buzz would run them, with
// the stand-in `secret-tool` of test/fake-secret-tool (which does what the real program was seen to do; the real one is run in
// secret-service.real.test.ts where a Secret Service is available). What these tests prove is what the plugin does with a store
// that behaves that way, or refuses, or is not there: the key goes in on standard input and never on a command line, it is read
// back, and when the store does not confirm it the key is kept in the profile, labelled, and moved when the store works again.
const KEY = "test-key-not-real-0123456789";
const OLD = "test-key-old-not-real-9876543210";
const PROFILE_KEY = "megatech.linear.api-key.v1";

function sandbox(mode?: string, delay?: number) {
  const dir = mkdtempSync(join(tmpdir(), "linear-secret-"));
  const env: Record<string, string> = { LINEAR_FAKE_SECRET: join(dir, "secret.json"), LINEAR_FAKE_SECRET_LOG: join(dir, "log.jsonl") };
  if (mode) env.LINEAR_FAKE_SECRET_MODE = mode;
  if (delay) env.LINEAR_FAKE_SECRET_DELAY = String(delay);
  const runWith = (extra: Record<string, string>) => (command: SecretCommand, input?: string) => runCommand(command, input, { env: { ...env, ...extra } });
  const run = runWith({});
  const storage = new Map<string, string>();
  const profile = {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => void storage.set(name, value),
    removeItem: (name: string) => void storage.delete(name),
  };
  const calls = () => (existsSync(env.LINEAR_FAKE_SECRET_LOG!) ? readFileSync(env.LINEAR_FAKE_SECRET_LOG!, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : []);
  const kept = () => (existsSync(env.LINEAR_FAKE_SECRET!) ? Object.values(JSON.parse(readFileSync(env.LINEAR_FAKE_SECRET!, "utf8")) as Record<string, string>) : []);
  /** What the person (or another program) does to the store directly, with nothing refusing. */
  const direct = (value: string) => runWith({ LINEAR_FAKE_SECRET_MODE: "" })("secret-save", value);
  const store = (extra: Record<string, string> | undefined = undefined) => createKeyStore(profile, { store: "secret-service", run: extra ? runWith(extra) : run });
  return { env, run, storage, profile, calls, kept, direct, store };
}

const stores = (calls: string[][]) => calls.filter((call) => call[0] === "store").length;

describe("the manifest's secret-tool commands", () => {
  const byId = (id: string) => declaredCommands().find((command: { id: string }) => command.id === id);

  it("name the one item, and take no secret as an argument", () => {
    for (const id of ["secret-read", "secret-save", "secret-delete"]) {
      const command = byId(id);
      expect(command.program).toBe("secret-tool");
      expect(command.args.slice(-4)).toEqual(["service", "buzz-linear", "account", "linear"]);
    }
    expect(byId("secret-read").args[0]).toBe("lookup");
    expect(byId("secret-save").args[0]).toBe("store");
    expect(byId("secret-delete").args[0]).toBe("clear");
    // A fixed label, as one argument: the key is on standard input, which `store` reads to the end when it is not a terminal.
    expect(byId("secret-save").args.filter((arg: string) => arg.startsWith("--label="))).toHaveLength(1);
    expect(byId("secret-save").maxInputBytes).toBeLessThanOrEqual(2048);
    expect(byId("secret-read").maxInputBytes).toBeUndefined();
    expect(byId("secret-delete").maxInputBytes).toBeUndefined();
  });

  it("run only the three programs' fixed subcommands, and nothing else is declared", () => {
    const programs = declaredCommands().map((command: { program: string; args: string[] }) => `${command.program} ${command.args[0]}`).sort();
    expect(programs).toEqual([
      "secret-tool clear",
      "secret-tool lookup",
      "secret-tool store",
      "security add-generic-password",
      "security delete-generic-password",
      "security find-generic-password",
    ]);
  });
});

describe("which store a system has", () => {
  it("is the Keychain on a Mac, the Secret Service on Linux, and none elsewhere", () => {
    expect(detectStore("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("keychain");
    expect(detectStore("", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("keychain");
    expect(detectStore("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15")).toBe("secret-service");
    expect(detectStore(undefined, "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:130.0)")).toBe("secret-service");
    expect(detectStore("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBeUndefined();
    expect(detectStore("Linux armv81", "Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBeUndefined();
    expect(detectStore(undefined, undefined)).toBeUndefined();
  });
});

describe("saving to a Secret Service that behaves as seen", () => {
  it("keeps the key, reads it back in a later session, and never put it on a command line or in the profile", async () => {
    const box = sandbox();
    const keys = box.store();
    await keys.ready;
    expect(keys.has()).toBe(false);
    expect(await keys.save(KEY)).toEqual({ kept: true, degraded: false });
    expect([keys.read(), keys.place()]).toEqual([KEY, "secret-service"]);
    expect(box.kept()).toEqual([KEY]); // exactly the key: no line break was added on its way in
    expect(box.storage.size).toBe(0);
    for (const call of box.calls()) expect(call.join(" ")).not.toContain(KEY);
    // The first look (when the store starts), then the save, then the read that checks it.
    expect(box.calls().map((call) => call[0])).toEqual(["lookup", "store", "lookup"]);
    const later = box.store();
    await later.ready;
    expect([later.read(), later.place()]).toEqual([KEY, "secret-service"]);
    expect(box.storage.size).toBe(0);
    expect(await later.clear()).toBe(true);
    expect(box.kept()).toEqual([]);
    expect([later.has(), box.storage.size]).toEqual([false, 0]);
  });

  it("is not on any command line while the program runs", async () => {
    if (process.platform !== "linux") return;
    const box = sandbox("slow", 1500);
    const keys = box.store();
    const saving = keys.save(KEY);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    let seen = 0;
    for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
      let line = "";
      try {
        line = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      } catch {
        continue;
      }
      if (/fake-secret-tool\/+secret-tool/.test(line) && (line.includes("store") || line.includes("lookup"))) {
        seen += 1;
        expect(line).not.toContain(KEY);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect((await saving).kept).toBe(true);
  }, 30000);

  it("replaces a key that is there, and starts the board over", async () => {
    const box = sandbox();
    const keys = box.store();
    await keys.ready;
    await keys.save(OLD);
    const version = keys.version();
    expect((await keys.save(KEY)).kept).toBe(true);
    expect(box.kept()).toEqual([KEY]);
    expect(keys.version()).toBeGreaterThan(version);
  });

  it("does not take a key longer than the command accepts, and keeps it in the profile like any other refusal", async () => {
    const box = sandbox();
    const keys = box.store();
    await keys.ready;
    const long = "x".repeat(3000);
    expect(await keys.save(long)).toEqual({ kept: true, degraded: true });
    expect(box.kept()).toEqual([]);
    expect(keys.place()).toBe("profile");
  });
});

describe("a Secret Service that will not keep the key (none running, a locked keyring, a refusal)", () => {
  it("mismatch: what the store gives back is not what was sent, so the key is kept in the profile and the store's answer is not trusted", async () => {
    const box = sandbox("mismatch");
    const keys = box.store();
    await keys.ready;
    expect(await keys.save(KEY)).toEqual({ kept: true, degraded: true });
    expect([keys.read(), keys.place(), box.storage.get(PROFILE_KEY)]).toEqual([KEY, "profile", KEY]);
  });

  for (const mode of ["unreachable", "refuse-store"]) {
    it(`${mode}: the key is kept in the profile, said to be degraded, and moved to the store once it works`, async () => {
      const box = sandbox(mode);
      const keys = box.store();
      await keys.ready;
      expect(await keys.save(KEY)).toEqual({ kept: true, degraded: true });
      expect([keys.read(), keys.place(), box.storage.get(PROFILE_KEY)]).toEqual([KEY, "profile", KEY]);
      expect(box.kept().every((value) => value !== KEY)).toBe(true);
      // The next start has a store that works: the key moves, and the plain copy goes.
      const later = box.store({ LINEAR_FAKE_SECRET_MODE: "" });
      await later.ready;
      expect([later.read(), later.place(), box.storage.size]).toEqual([KEY, "secret-service", 0]);
      expect(box.kept()).toEqual([KEY]);
    });
  }

  it("is not told apart from a missing program: every command is null, and the key is kept in the profile", async () => {
    const storage = new Map<string, string>();
    const profile = {
      getItem: (name: string) => storage.get(name) ?? null,
      setItem: (name: string, value: string) => void storage.set(name, value),
      removeItem: (name: string) => void storage.delete(name),
    };
    const keys = createKeyStore(profile, { store: "secret-service", run: async () => null });
    await keys.ready;
    expect(keys.has()).toBe(false);
    expect(await keys.save(KEY)).toEqual({ kept: true, degraded: true });
    expect([keys.read(), keys.place(), storage.get(PROFILE_KEY)]).toEqual([KEY, "profile", KEY]);
  });

  it("never lets a plain copy shadow a key the store already holds: a replacement it refuses keeps the saved key and keeps nothing else", async () => {
    const box = sandbox();
    await box.direct(OLD);
    const keys = box.store({ LINEAR_FAKE_SECRET_MODE: "refuse-store" });
    await keys.ready;
    expect([keys.read(), keys.place()]).toEqual([OLD, "secret-service"]);
    expect(await keys.save(KEY)).toEqual({ kept: false, degraded: false });
    expect([keys.read(), keys.place()]).toEqual([OLD, "secret-service"]);
    expect(box.kept()).toEqual([OLD]);
    expect(box.storage.size).toBe(0);
  });

  it("a save made before the first look has finished waits for it, so a key the store holds is not shadowed by a plain copy", async () => {
    const box = sandbox();
    await box.direct(OLD);
    const refusing = (command: SecretCommand, input?: string) => runCommand(command, input, { env: { ...box.env, LINEAR_FAKE_SECRET_MODE: "refuse-store" } });
    // The first look at the store is slow (its first read takes 400 ms), and the save does not wait for `ready`.
    let slowed = false;
    const run = async (command: SecretCommand, input?: string) => {
      if (command === "secret-read" && !slowed) {
        slowed = true;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      return refusing(command, input);
    };
    const keys = createKeyStore(box.profile, { store: "secret-service", run });
    expect(await keys.save(KEY)).toEqual({ kept: false, degraded: false });
    expect([keys.read(), keys.place(), box.storage.size, box.kept()]).toEqual([OLD, "secret-service", 0, [OLD]]);
  });

  it("does not wait for ever: the deadline ends a program that hangs, and the key is kept in the profile", async () => {
    const box = sandbox("slow", 20000);
    const keys = createKeyStore(box.profile, { store: "secret-service", run: (command, input) => runCommand(command, input, { env: box.env, deadlineMs: 400 }) });
    await keys.ready;
    expect(await keys.save(KEY)).toEqual({ kept: true, degraded: true });
    expect(box.storage.get(PROFILE_KEY)).toBe(KEY);
  }, 20000);
});

describe("removing the key", () => {
  it("deletes the store's item and any copy in the profile, and afterwards nothing is readable from either", async () => {
    const box = sandbox();
    const keys = box.store();
    await keys.ready;
    await keys.save(KEY);
    box.storage.set(PROFILE_KEY, "a stale plain copy");
    expect(await keys.clear()).toBe(true);
    expect(box.kept()).toEqual([]);
    expect(box.storage.size).toBe(0);
    expect(keys.has()).toBe(false);
    const later = box.store();
    await later.ready;
    expect(later.has()).toBe(false);
  });

  it("says so when the store would not give the key up, and the key stays in use", async () => {
    const box = sandbox();
    await box.direct(KEY);
    const keys = box.store({ LINEAR_FAKE_SECRET_MODE: "refuse-clear" });
    await keys.ready;
    expect(await keys.clear()).toBe(false);
    expect([keys.read(), keys.place()]).toEqual([KEY, "secret-service"]);
    expect(box.kept()).toEqual([KEY]);
  });
});

describe("a key already in the profile (saved by an earlier version)", () => {
  it("is moved to the Secret Service at the first look, read back, and only then is the plain copy removed, once", async () => {
    const box = sandbox();
    box.storage.set(PROFILE_KEY, KEY);
    const keys = box.store();
    await keys.ready;
    expect([keys.read(), keys.place()]).toEqual([KEY, "secret-service"]);
    expect(box.kept()).toEqual([KEY]);
    expect(box.storage.size).toBe(0);
    expect(keys.version()).toBe(0);
    for (const call of box.calls()) expect(call.join(" ")).not.toContain(KEY);
    expect(box.calls().map((call) => call[0])).toEqual(["lookup", "store", "lookup"]);
    const before = stores(box.calls());
    for (let session = 0; session < 3; session += 1) {
      const later = box.store();
      await later.ready;
      expect([later.read(), later.place()]).toEqual([KEY, "secret-service"]);
    }
    expect(stores(box.calls())).toBe(before);
  });

  it("stays in the profile, in use, when the store will not take it, and is tried again at the next start", async () => {
    const box = sandbox();
    box.storage.set(PROFILE_KEY, KEY);
    const refused = box.store({ LINEAR_FAKE_SECRET_MODE: "unreachable" });
    await refused.ready;
    expect([refused.read(), refused.place(), box.storage.get(PROFILE_KEY)]).toEqual([KEY, "profile", KEY]);
    expect(box.kept()).toEqual([]);
    expect(await refused.moveToStore()).toBe(false);
    const later = box.store({ LINEAR_FAKE_SECRET_MODE: "" });
    await later.ready;
    expect([later.read(), later.place(), box.storage.size]).toEqual([KEY, "secret-service", 0]);
  });

  it("drops the plain copy that a crash between the two steps left beside the same key, without writing it again", async () => {
    const box = sandbox();
    await box.direct(KEY);
    box.storage.set(PROFILE_KEY, KEY);
    const written = stores(box.calls());
    const keys = box.store();
    await keys.ready;
    expect([keys.read(), keys.place(), box.storage.size]).toEqual([KEY, "secret-service", 0]);
    expect(stores(box.calls())).toBe(written);
  });

  it("a look again that comes first is still the first look: it restarts nothing", async () => {
    const box = sandbox();
    await box.direct(KEY);
    const keys = box.store();
    await keys.reload(); // nothing asked for the key before this
    expect([keys.read(), keys.place(), keys.version()]).toEqual([KEY, "secret-service", 0]);
  });

  it("takes the profile's key as the newer one when it differs from the store's: moved over it, read back, and only then is the plain copy removed", async () => {
    const box = sandbox();
    await box.direct(OLD);
    box.storage.set(PROFILE_KEY, KEY);
    const keys = box.store();
    await keys.ready;
    expect([keys.read(), keys.place(), box.storage.size, box.kept()]).toEqual([KEY, "secret-service", 0, [KEY]]);
    for (const call of box.calls()) expect(call.join(" ")).not.toContain(KEY);
  });

  it("keeps both and uses the profile's key when the store will not take it over the older one", async () => {
    const box = sandbox();
    await box.direct(OLD);
    box.storage.set(PROFILE_KEY, KEY);
    const keys = box.store({ LINEAR_FAKE_SECRET_MODE: "refuse-store" });
    await keys.ready;
    expect([keys.read(), keys.place(), box.storage.get(PROFILE_KEY), box.kept()]).toEqual([KEY, "profile", KEY, [OLD]]);
  });

  it("loses no key when the store is down for a start, a newer key is pasted, and the store comes back: the newer key is in use and in the store", async () => {
    const box = sandbox();
    await box.direct(OLD); // key 1 is in the store
    // A start with the store down: it cannot be read, so the card sees no key, and key 2 is pasted and kept in the profile, labelled.
    const down = box.store({ LINEAR_FAKE_SECRET_MODE: "unreachable" });
    await down.ready;
    expect(down.has()).toBe(false);
    expect(await down.save(KEY)).toEqual({ kept: true, degraded: true });
    expect([down.read(), down.place(), box.storage.get(PROFILE_KEY), box.kept()]).toEqual([KEY, "profile", KEY, [OLD]]);
    // The store comes back, and Buzz is started again.
    const back = box.store({ LINEAR_FAKE_SECRET_MODE: "" });
    await back.ready;
    expect([back.read(), back.place(), box.storage.size, box.kept()]).toEqual([KEY, "secret-service", 0, [KEY]]);
    // And once more: nothing is repeated, nothing changes.
    const stores = (calls: string[][]) => calls.filter((call) => call[0] === "store").length;
    const before = stores(box.calls());
    const again = box.store();
    await again.ready;
    expect([again.read(), again.place(), box.kept()]).toEqual([KEY, "secret-service", [KEY]]);
    expect(stores(box.calls())).toBe(before);
  });
});
