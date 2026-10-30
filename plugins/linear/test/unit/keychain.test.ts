import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEYCHAIN_TERMINAL_COMMAND, createKeyStore, type SecretCommand } from "../../src/linear/keys";
import { declaredCommands, runCommand } from "../host-sim.mjs";

// The key store against the real processes of the manifest's `security` commands, run as Buzz would run them, with the
// stand-in `security` of test/fake-security. The stand-in follows how the real program is documented to behave; it was
// never compared with a Mac. What these tests prove is what the plugin does with a program that behaves that way: the key
// goes in on standard input and never on a command line, it is checked by reading it back, a program that refuses (or is
// missing, or waits on a terminal) is reported, not trusted, and a key already in the profile is never lost on its way
// to the Keychain.
const KEY = "test-key-not-real-0123456789";
const OLD = "test-key-old-not-real-9876543210";
const PROFILE_KEY = "megatech.linear.api-key.v1";

function sandbox(mode?: string, delay?: number) {
  const dir = mkdtempSync(join(tmpdir(), "linear-keychain-"));
  const env: Record<string, string> = { LINEAR_FAKE_KEYCHAIN: join(dir, "keychain.json"), LINEAR_FAKE_KEYCHAIN_LOG: join(dir, "log.jsonl") };
  if (mode) env.LINEAR_FAKE_KEYCHAIN_MODE = mode;
  if (delay) env.LINEAR_FAKE_KEYCHAIN_DELAY = String(delay);
  const run = (command: SecretCommand, input?: string) => runCommand(command, input, { env });
  const storage = new Map<string, string>();
  const profile = {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => void storage.set(name, value),
    removeItem: (name: string) => void storage.delete(name),
  };
  const calls = () => (existsSync(env.LINEAR_FAKE_KEYCHAIN_LOG!) ? readFileSync(env.LINEAR_FAKE_KEYCHAIN_LOG!, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : []);
  const kept = () => (existsSync(env.LINEAR_FAKE_KEYCHAIN!) ? (JSON.parse(readFileSync(env.LINEAR_FAKE_KEYCHAIN!, "utf8")) as Record<string, string>) : {});
  /** What the person does by hand, in Terminal, with nothing refusing. */
  const byHand = (value: string) => runCommand("keychain-save", `${value}\n${value}\n`, { env: { ...env, LINEAR_FAKE_KEYCHAIN_MODE: "" } });
  const store = (options: { mode?: string | undefined; keychain?: boolean } = {}) =>
    createKeyStore(profile, { ...(options.keychain === false ? {} : { store: "keychain" as const }), run: "mode" in options ? (command, input) => runCommand(command, input, { env: { ...env, LINEAR_FAKE_KEYCHAIN_MODE: options.mode ?? "" } }) : run });
  return { env, run, storage, profile, calls, kept, byHand, store };
}

const adds = (calls: string[][]) => calls.filter((call) => call[0] === "add-generic-password").length;

describe("the manifest's Keychain commands", () => {
  const byId = (id: string) => declaredCommands().find((command: { id: string }) => command.id === id);

  it("name the one item, and take no secret as an argument", () => {
    for (const id of ["keychain-read", "keychain-save", "keychain-delete"]) {
      const command = byId(id);
      expect(command.program).toBe("security");
      expect(command.args).toEqual(expect.arrayContaining(["-s", "buzz-linear", "-a", "linear"]));
    }
    // `-w` last and with no value is how the program is made to ask for the password.
    expect(byId("keychain-save").args.at(-1)).toBe("-w");
    expect(byId("keychain-read").args.at(-1)).toBe("-w");
    expect(byId("keychain-delete").args).not.toContain("-w");
    expect(byId("keychain-read").maxInputBytes).toBeUndefined();
    expect(byId("keychain-save").maxInputBytes).toBeLessThanOrEqual(2048);
    expect(declaredCommands().map((command: { id: string }) => command.id).sort()).toEqual(["keychain-delete", "keychain-read", "keychain-save", "secret-delete", "secret-read", "secret-save"]);
  });

  it("are what the card tells a person to type in Terminal", () => {
    expect(KEYCHAIN_TERMINAL_COMMAND).toBe(`security ${byId("keychain-save").args.join(" ")}`);
  });
});

describe("saving to a Keychain that behaves as assumed", () => {
  it("keeps the key, reads it back in a later session, and never put it on a command line or in the profile", async () => {
    const box = sandbox();
    const keys = box.store();
    await keys.ready;
    expect(keys.has()).toBe(false);
    expect((await keys.save(KEY)).kept).toBe(true);
    expect([keys.read(), keys.place()]).toEqual([KEY, "keychain"]);
    expect(Object.values(box.kept())).toEqual([KEY]);
    expect(box.storage.size).toBe(0);
    for (const call of box.calls()) expect(call.join(" ")).not.toContain(KEY);
    // The first look (when the store starts), then the save, then the read that checks it.
    expect(box.calls().map((call) => call[0])).toEqual(["find-generic-password", "add-generic-password", "find-generic-password"]);
    // A new session finds it, in the Keychain, with nothing in the profile.
    const later = box.store();
    await later.ready;
    expect([later.read(), later.place()]).toEqual([KEY, "keychain"]);
    expect(box.storage.size).toBe(0);
    expect(await later.clear()).toBe(true);
    expect(box.kept()).toEqual({});
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
      // The stand-in's own process (a script run by node), not a shell whose command line happens to quote the test.
      if (/fake-security\/+security/.test(line) && (line.includes("add-generic-password") || line.includes("find-generic-password"))) {
        seen += 1;
        expect(line).not.toContain(KEY);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect((await saving).kept).toBe(true);
  }, 30000);

  it("asks for the password twice, and a mismatch saves nothing", async () => {
    const box = sandbox();
    expect(await box.run("keychain-save", "one\ntwo\n")).toBeNull();
    expect(box.kept()).toEqual({});
    expect(await box.run("keychain-save", "")).toBeNull();
    expect(await box.run("keychain-save", "same\nsame\n")).toBe("");
    expect(Object.values(box.kept())).toEqual(["same"]);
  });

  it("replaces a key that is there", async () => {
    const box = sandbox();
    const keys = box.store();
    await keys.ready;
    expect((await keys.save(OLD)).kept).toBe(true);
    const version = keys.version();
    expect((await keys.save(KEY)).kept).toBe(true);
    expect(Object.values(box.kept())).toEqual([KEY]);
    expect(keys.version()).toBeGreaterThan(version);
  });

  it("does not take a key longer than the command accepts", async () => {
    const box = sandbox();
    const keys = box.store();
    await keys.ready;
    expect((await keys.save("x".repeat(3000))).kept).toBe(false);
    expect(box.kept()).toEqual({});
    expect(keys.has()).toBe(false);
  });
});

describe("a Keychain that will not take the key", () => {
  it("is reported, nothing is kept anywhere, and the person can put it there by hand and have the plugin look again", async () => {
    const box = sandbox("refuse-add");
    const keys = box.store();
    await keys.ready;
    expect((await keys.save(KEY)).kept).toBe(false);
    expect(keys.has()).toBe(false);
    expect(box.storage.size).toBe(0);
    expect(box.kept()).toEqual({});
    await box.byHand(KEY);
    await keys.reload();
    expect([keys.read(), keys.place()]).toEqual([KEY, "keychain"]);
  });

  it("leaves a saved key as it was when a replacement is refused", async () => {
    const box = sandbox();
    await box.byHand(OLD);
    const keys = box.store({ mode: "refuse-add" });
    await keys.ready;
    expect([keys.read(), keys.place()]).toEqual([OLD, "keychain"]);
    expect((await keys.save(KEY)).kept).toBe(false);
    expect([keys.read(), keys.place()]).toEqual([OLD, "keychain"]);
    expect(Object.values(box.kept())).toEqual([OLD]);
  });

  it("does not say saved when what the Keychain gives back is not what was sent", async () => {
    const box = sandbox("mismatch");
    const keys = box.store();
    await keys.ready;
    expect((await keys.save(KEY)).kept).toBe(false);
    expect(keys.has()).toBe(false);
    expect(box.storage.size).toBe(0);
  });

  it("does not wait for ever on a program that asks a terminal (Buzz started from one): the deadline ends it, and nothing is kept", async () => {
    const box = sandbox();
    const keys = createKeyStore(box.profile, { store: "keychain", run: (command, input) => runCommand(command, input, { env: { ...box.env, LINEAR_FAKE_KEYCHAIN_MODE: "terminal" }, deadlineMs: 400 }) });
    await keys.ready;
    expect((await keys.save(KEY)).kept).toBe(false);
    expect(keys.has()).toBe(false);
    expect(box.kept()).toEqual({});
    expect(box.storage.size).toBe(0);
  }, 15000);

  it("finds nothing, without complaint, where the program does not exist (every command is null)", async () => {
    const storage = new Map<string, string>();
    const profile = {
      getItem: (name: string) => storage.get(name) ?? null,
      setItem: (name: string, value: string) => void storage.set(name, value),
      removeItem: (name: string) => void storage.delete(name),
    };
    const keys = createKeyStore(profile, { store: "keychain", run: async () => null });
    await keys.ready;
    expect(keys.has()).toBe(false);
    expect((await keys.save(KEY)).kept).toBe(false);
    expect(keys.has()).toBe(false);
    expect(storage.size).toBe(0);
  });

  it("treats a command that throws like one that failed", async () => {
    const keys = createKeyStore(new Map() as never, {
      store: "keychain",
      run: async () => {
        throw new Error("the host refused");
      },
    });
    await keys.ready;
    expect(keys.has()).toBe(false);
    expect((await keys.save(KEY)).kept).toBe(false);
  });
});

describe("removing the key", () => {
  it("deletes the Keychain item and any copy in the profile, and afterwards nothing is readable from either", async () => {
    const box = sandbox();
    const keys = box.store();
    await keys.ready;
    await keys.save(KEY);
    box.storage.set(PROFILE_KEY, "a stale plain copy");
    expect(await keys.clear()).toBe(true);
    expect(box.kept()).toEqual({});
    expect(box.storage.size).toBe(0);
    expect(keys.has()).toBe(false);
    const later = box.store();
    await later.ready;
    expect(later.has()).toBe(false);
  });

  it("says so when the Keychain would not give the key up, and the key stays in use", async () => {
    const box = sandbox();
    await box.byHand(KEY);
    const keys = box.store({ mode: "refuse-delete" });
    await keys.ready;
    expect(await keys.clear()).toBe(false);
    expect([keys.read(), keys.place()]).toEqual([KEY, "keychain"]);
    expect(Object.values(box.kept())).toEqual([KEY]);
  });
});

describe("a key already in the profile (saved by an earlier version)", () => {
  it("is moved to the Keychain at the first look, read back, and only then is the plain copy removed", async () => {
    const box = sandbox();
    box.storage.set(PROFILE_KEY, KEY);
    const keys = box.store();
    await keys.ready;
    expect([keys.read(), keys.place()]).toEqual([KEY, "keychain"]);
    expect(Object.values(box.kept())).toEqual([KEY]);
    expect(box.storage.size).toBe(0);
    expect(keys.version()).toBe(0); // the same key: nothing to start over
    for (const call of box.calls()) expect(call.join(" ")).not.toContain(KEY);
    expect(box.calls().map((call) => call[0])).toEqual(["find-generic-password", "add-generic-password", "find-generic-password"]);
  });

  it("is not moved again once it has been", async () => {
    const box = sandbox();
    box.storage.set(PROFILE_KEY, KEY);
    await box.store().ready;
    const before = adds(box.calls());
    for (let session = 0; session < 3; session += 1) {
      const later = box.store();
      await later.ready;
      expect([later.read(), later.place()]).toEqual([KEY, "keychain"]);
    }
    expect(adds(box.calls())).toBe(before);
  });

  it("is kept, in use, and labelled, when the Keychain will not take it, and is tried again at the next start", async () => {
    const box = sandbox();
    box.storage.set(PROFILE_KEY, KEY);
    const refused = box.store({ mode: "refuse-add" });
    await refused.ready;
    expect([refused.read(), refused.place()]).toEqual([KEY, "profile"]);
    expect(box.storage.get(PROFILE_KEY)).toBe(KEY);
    expect(box.kept()).toEqual({});
    // The next start has a Keychain that works.
    const later = box.store();
    await later.ready;
    expect([later.read(), later.place()]).toEqual([KEY, "keychain"]);
    expect(Object.values(box.kept())).toEqual([KEY]);
    expect(box.storage.size).toBe(0);
  });

  it("is not lost when what the Keychain gives back is not it, or the program is missing, or it waits on a terminal", async () => {
    for (const mode of ["mismatch", "terminal"]) {
      const box = sandbox();
      box.storage.set(PROFILE_KEY, KEY);
      const keys = createKeyStore(box.profile, { store: "keychain", run: (command, input) => runCommand(command, input, { env: { ...box.env, LINEAR_FAKE_KEYCHAIN_MODE: mode }, deadlineMs: 400 }) });
      await keys.ready;
      expect([keys.read(), keys.place(), box.storage.get(PROFILE_KEY)], mode).toEqual([KEY, "profile", KEY]);
    }
    const storage = new Map([[PROFILE_KEY, KEY]]);
    const missing = createKeyStore({ getItem: (n) => storage.get(n) ?? null, setItem: (n, v) => void storage.set(n, v), removeItem: (n) => void storage.delete(n) }, { store: "keychain", run: async () => null });
    await missing.ready;
    expect([missing.read(), missing.place(), storage.get(PROFILE_KEY)]).toEqual([KEY, "profile", KEY]);
  }, 20000);

  it("can be moved by hand from the card, and a refusal leaves it where it was", async () => {
    const box = sandbox();
    box.storage.set(PROFILE_KEY, KEY);
    const refused = box.store({ mode: "refuse-add" });
    await refused.ready;
    expect(await refused.moveToStore()).toBe(false);
    expect([refused.read(), refused.place(), box.storage.get(PROFILE_KEY)]).toEqual([KEY, "profile", KEY]);
    const later = box.store();
    await later.ready; // moved here already, by the start
    expect(await later.moveToStore()).toBe(false); // nothing left in the profile to move
    expect(later.place()).toBe("keychain");
  });

  it("gives way to a key already in the Keychain: the Keychain's is the one that counts, and the stale copy goes", async () => {
    const box = sandbox();
    await box.byHand(OLD);
    box.storage.set(PROFILE_KEY, KEY);
    const before = adds(box.calls());
    const keys = box.store();
    await keys.ready;
    expect([keys.read(), keys.place()]).toEqual([OLD, "keychain"]);
    expect(box.storage.size).toBe(0);
    expect(adds(box.calls())).toBe(before); // nothing was written over it
  });

  it("drops the plain copy that a crash between the two steps left beside the same key", async () => {
    const box = sandbox();
    await box.byHand(KEY);
    box.storage.set(PROFILE_KEY, KEY);
    const keys = box.store();
    await keys.ready;
    expect([keys.read(), keys.place()]).toEqual([KEY, "keychain"]);
    expect(box.storage.size).toBe(0);
  });
});

describe("where there is no Keychain (not a Mac)", () => {
  it("never runs `security`, and keeps the key in the profile as plain text, said to be so by place()", async () => {
    const box = sandbox();
    const keys = box.store({ keychain: false });
    await keys.ready;
    expect(keys.store()).toBeUndefined();
    expect((await keys.save(KEY)).kept).toBe(true);
    expect([keys.read(), keys.place(), box.storage.get(PROFILE_KEY)]).toEqual([KEY, "profile", KEY]);
    expect(await keys.clear()).toBe(true);
    expect(box.storage.size).toBe(0);
    expect(box.calls()).toEqual([]);
    expect(await keys.moveToStore()).toBe(false);
  });
});
