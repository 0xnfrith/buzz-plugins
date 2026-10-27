import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEYCHAIN_TERMINAL_COMMAND, createConfigStore, type SecretCommand } from "../../src/beeper/config";
import { declaredCommands, runCommand } from "../host-sim.mjs";

// The config store against the real processes of the manifest's `security` commands, run as Buzz would run them, with the
// stand-in `security` of test/fake-security. The stand-in follows how the real program is documented to behave; it was
// never compared with a Mac. What these tests prove is what the plugin does with a program that behaves that way:
// the token goes in on standard input and never on a command line, it is checked by reading it back, and a program that
// refuses is reported, not trusted.
const TOKEN = "test-token-not-real-0123456789";

function sandbox(mode?: string, delay?: number) {
  const dir = mkdtempSync(join(tmpdir(), "beeper-keychain-"));
  const env: Record<string, string> = { BEEPER_FAKE_KEYCHAIN: join(dir, "keychain.json"), BEEPER_FAKE_KEYCHAIN_LOG: join(dir, "log.jsonl") };
  if (mode) env.BEEPER_FAKE_KEYCHAIN_MODE = mode;
  if (delay) env.BEEPER_FAKE_KEYCHAIN_DELAY = String(delay);
  const run = (command: SecretCommand, input?: string) => runCommand(command, input, { env });
  const storage = new Map<string, string>();
  const profile = {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => void storage.set(name, value),
    removeItem: (name: string) => void storage.delete(name),
  };
  const calls = () => (existsSync(env.BEEPER_FAKE_KEYCHAIN_LOG!) ? readFileSync(env.BEEPER_FAKE_KEYCHAIN_LOG!, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : []);
  const kept = () => (existsSync(env.BEEPER_FAKE_KEYCHAIN!) ? (JSON.parse(readFileSync(env.BEEPER_FAKE_KEYCHAIN!, "utf8")) as Record<string, string>) : {});
  return { env, run, storage, profile, calls, kept };
}

describe("the manifest's Keychain commands", () => {
  const byId = (id: string) => declaredCommands().find((command: { id: string }) => command.id === id);

  it("name the one item, and take no secret as an argument", () => {
    for (const id of ["keychain-read", "keychain-save", "keychain-delete"]) {
      const command = byId(id);
      expect(command.program).toBe("security");
      expect(command.args).toEqual(expect.arrayContaining(["-s", "buzz-beeper", "-a", "beeper"]));
    }
    // `-w` last and with no value is how the program is made to ask for the password.
    expect(byId("keychain-save").args.at(-1)).toBe("-w");
    expect(byId("keychain-read").args.at(-1)).toBe("-w");
    expect(byId("keychain-read").maxInputBytes).toBeUndefined();
  });

  it("are what the card tells a person to type in Terminal", () => {
    expect(KEYCHAIN_TERMINAL_COMMAND).toBe(`security ${byId("keychain-save").args.join(" ")}`);
  });
});

describe("saving to a Keychain that behaves as assumed", () => {
  it("keeps the token, reads it back in a later session, and never put it on a command line", async () => {
    const box = sandbox();
    const config = createConfigStore(box.profile, { keychain: true, run: box.run });
    await config.ready;
    expect(config.hasToken()).toBe(false);
    expect(await config.saveToKeychain(TOKEN)).toBe(true);
    expect(Object.values(box.kept())).toEqual([TOKEN]);
    expect(box.storage.size).toBe(0);
    for (const call of box.calls()) expect(call.join(" ")).not.toContain(TOKEN);
    // The first look (when the store starts), then the save, then the read that checks it.
    expect(box.calls().map((call) => call[0])).toEqual(["find-generic-password", "add-generic-password", "find-generic-password"]);
    // A new session finds it.
    const later = createConfigStore(box.profile, { keychain: true, run: box.run });
    await later.ready;
    expect([later.token(), later.place()]).toEqual([TOKEN, "keychain"]);
    expect(await later.clearToken()).toBe(true);
    expect(box.kept()).toEqual({});
  });

  it("is not on any command line while the program runs", async () => {
    if (process.platform !== "linux") return;
    const box = sandbox("slow", 1500);
    const config = createConfigStore(box.profile, { keychain: true, run: box.run });
    const saving = config.saveToKeychain(TOKEN);
    await new Promise((resolve) => setTimeout(resolve, 500));
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
        expect(line).not.toContain(TOKEN);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(await saving).toBe(true);
  }, 15000);

  it("asks for the password twice, and a mismatch saves nothing", async () => {
    const box = sandbox();
    expect(await box.run("keychain-save", "one\ntwo\n")).toBeNull();
    expect(box.kept()).toEqual({});
    expect(await box.run("keychain-save", "")).toBeNull();
    expect(await box.run("keychain-save", "same\nsame\n")).toBe("");
    expect(Object.values(box.kept())).toEqual(["same"]);
  });

  it("updates an item that is there", async () => {
    const box = sandbox();
    const config = createConfigStore(box.profile, { keychain: true, run: box.run });
    await config.ready;
    expect(await config.saveToKeychain("first-token-value")).toBe(true);
    expect(await config.saveToKeychain("second-token-value")).toBe(true);
    expect(Object.values(box.kept())).toEqual(["second-token-value"]);
  });

  it("does not take a token longer than the command accepts", async () => {
    const box = sandbox();
    const config = createConfigStore(box.profile, { keychain: true, run: box.run });
    await config.ready;
    expect(await config.saveToKeychain("x".repeat(3000))).toBe(false);
    expect(box.kept()).toEqual({});
  });
});

describe("a Keychain that will not take the token", () => {
  it("is reported, nothing is kept, and the person can put it there by hand and have the plugin look again", async () => {
    const box = sandbox("refuse-add");
    const config = createConfigStore(box.profile, { keychain: true, run: box.run });
    await config.ready;
    expect(await config.saveToKeychain(TOKEN)).toBe(false);
    expect(config.hasToken()).toBe(false);
    expect(box.storage.size).toBe(0);
    // The person runs the Terminal command (here: the stand-in, with the mode off, reading the token from standard input).
    const byHand = createConfigStore(box.profile, { keychain: true, run: (command, input) => runCommand(command, input, { env: { ...box.env, BEEPER_FAKE_KEYCHAIN_MODE: "" } }) });
    await byHand.ready;
    expect(await byHand.saveToKeychain(TOKEN)).toBe(true);
    await config.reload();
    expect([config.token(), config.place()]).toEqual([TOKEN, "keychain"]);
  });

  it("finds nothing, without complaint, where the program does not exist", async () => {
    const config = createConfigStore(new Map<string, string>() as never, { keychain: true, run: async () => null });
    await config.ready.catch(() => {});
    expect(config.hasToken()).toBe(false);
  });
});
