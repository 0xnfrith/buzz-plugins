import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createKeyStore, type SecretCommand } from "../../src/linear/keys";
import { runCommand } from "../host-sim.mjs";

// The key store against the REAL `secret-tool` and a real Secret Service (gnome-keyring or another, unlocked, on the session bus),
// with the manifest's own commands run as Buzz would run them. It runs only where that exists and the person asks for it:
//
//   LINEAR_REAL_SECRET_TOOL=1 pnpm exec vitest run test/unit/secret-service.real.test.ts
//
// (.github/workflows/linear-tests.yml does, under a headless keyring.) The item has fixed attributes (service buzz-linear, account
// linear), so the test refuses to run over one that is there already: it would be somebody's real key.
const enabled = process.env.LINEAR_REAL_SECRET_TOOL === "1";
const KEY = "test-key-not-real-0123456789";
const OLD = "test-key-old-not-real-9876543210";
const PROFILE_KEY = "megatech.linear.api-key.v1";
const ATTRIBUTES = ["service", "buzz-linear", "account", "linear"];

const lookup = () => spawnSync("secret-tool", ["lookup", ...ATTRIBUTES], { encoding: "utf8" });
const clear = () => spawnSync("secret-tool", ["clear", ...ATTRIBUTES], { encoding: "utf8" });
const search = () => spawnSync("secret-tool", ["search", ...ATTRIBUTES], { encoding: "utf8" });

const present = enabled && lookup().status === 0;
if (enabled && present) console.warn("secret-service.real.test: an item service=buzz-linear account=linear is already in the keyring; the real tests are skipped so as not to touch it");

function session(env: Record<string, string> = {}) {
  const storage = new Map<string, string>();
  const profile = {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => void storage.set(name, value),
    removeItem: (name: string) => void storage.delete(name),
  };
  const run = (command: SecretCommand, input?: string) => runCommand(command, input, { real: true, env });
  return { storage, profile, store: () => createKeyStore(profile, { store: "secret-service", run }) };
}

describe.skipIf(!enabled || present)("the real secret-tool and a real Secret Service", () => {
  it("keeps the key, reads it back in a later session, labels the item, and has nothing in the profile", async () => {
    try {
      const box = session();
      const keys = box.store();
      await keys.ready;
      expect(keys.has()).toBe(false);
      expect(await keys.save(KEY)).toEqual({ kept: true, degraded: false });
      expect([keys.read(), keys.place()]).toEqual([KEY, "secret-service"]);
      expect(box.storage.size).toBe(0);
      // What the store holds is exactly the key, and the item carries the fixed label (the arguments are the manifest's).
      const direct = lookup();
      expect([direct.status, direct.stdout]).toEqual([0, KEY]);
      expect(search().stdout).toContain("Linear API key (Buzz)");
      const later = box.store();
      await later.ready;
      expect([later.read(), later.place()]).toEqual([KEY, "secret-service"]);
    } finally {
      clear();
    }
  });

  it("replaces the key, and Remove key empties the store (secret-tool lookup finds nothing afterwards)", async () => {
    try {
      const box = session();
      const keys = box.store();
      await keys.ready;
      await keys.save(OLD);
      expect((await keys.save(KEY)).kept).toBe(true);
      expect(lookup().stdout).toBe(KEY);
      box.storage.set(PROFILE_KEY, "a stale plain copy");
      expect(await keys.clear()).toBe(true);
      const after = lookup();
      expect([after.status, after.stdout]).toEqual([1, ""]);
      expect(box.storage.size).toBe(0);
      expect(keys.has()).toBe(false);
    } finally {
      clear();
    }
  });

  it("moves a key from the profile into the store at the first look, and not again", async () => {
    try {
      const box = session();
      box.storage.set(PROFILE_KEY, KEY);
      const keys = box.store();
      await keys.ready;
      expect([keys.read(), keys.place(), box.storage.size]).toEqual([KEY, "secret-service", 0]);
      expect(lookup().stdout).toBe(KEY);
      const later = box.store();
      await later.ready;
      expect([later.read(), later.place(), box.storage.size]).toEqual([KEY, "secret-service", 0]);
    } finally {
      clear();
    }
  });

  it("with no Secret Service to talk to (no bus), keeps the key in the profile, labelled, and loses nothing", async () => {
    try {
      const box = session({ DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent/linear-test-bus" });
      box.storage.set(PROFILE_KEY, OLD);
      const keys = box.store();
      await keys.ready;
      expect([keys.read(), keys.place(), box.storage.get(PROFILE_KEY)]).toEqual([OLD, "profile", OLD]);
      expect(await keys.save(KEY)).toEqual({ kept: true, degraded: true });
      expect([keys.read(), keys.place(), box.storage.get(PROFILE_KEY)]).toEqual([KEY, "profile", KEY]);
      expect(lookup().status).toBe(1);
      // The next start has a store that works: the key moves.
      const working = createKeyStore(box.profile, { store: "secret-service", run: (command, input) => runCommand(command, input, { real: true }) });
      await working.ready;
      expect([working.read(), working.place(), box.storage.size, lookup().stdout]).toEqual([KEY, "secret-service", 0, KEY]);
    } finally {
      clear();
    }
  });
});
