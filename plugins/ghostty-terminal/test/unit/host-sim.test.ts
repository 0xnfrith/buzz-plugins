// The host simulator is what the bridge and browser tests stand on, so each rule it copies from Buzz's host (see the header of
// test/host-sim.mjs) is held here against drifting.
import { afterEach, describe, expect, it } from "vitest";
import { STOP_GRACE_MS, WRITE_UNITS, createHost, processProblems, randomSplit } from "../host-sim.mjs";
import { alive, delay, gone } from "./shell";

const declare = (program: string, args: string[] = []) => ({ host: { processes: [{ id: "p", program, args }] } });
const hosts: ReturnType<typeof createHost>[] = [];
const make = (manifest: object, options = {}) => {
  const host = createHost(manifest, options);
  hosts.push(host);
  return host;
};
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stopAll()));
});

/** Runs `sh -c script` and returns its stdout once it has exited. */
async function run(script: string, options: Record<string, unknown> = {}, hostOptions = {}) {
  const host = make(declare("sh", ["-c", script]), hostOptions);
  let out = "";
  const proc = await host.spawn("p", { ...options, onStdout: (text: string) => (out += text) });
  await proc.exited;
  return { out, host };
}

describe("what a plugin may ask for", () => {
  it("only starts a process the manifest declares", async () => {
    const host = make(declare("sh", ["-c", "true"]));
    await expect(host.spawn("other")).rejects.toThrow("Process is not declared");
  });

  it("refuses more than 256 caller arguments and a NUL in one", async () => {
    const host = make(declare("sh", ["-c", "true"]));
    await expect(host.spawn("p", { args: Array(257).fill("x") })).rejects.toThrow("Invalid process arguments");
    await expect(host.spawn("p", { args: ["a\0b"] })).rejects.toThrow("Invalid process arguments");
  });

  it("refuses the host features this plugin must not use, and any option it does not know", async () => {
    const host = make(declare("sh", ["-c", "true"]));
    for (const option of ["mcp", "protection", "agentCredential", "protectedAgent", "secrets"]) {
      await expect(host.spawn("p", { [option]: true }), option).rejects.toThrow(`must not pass ${option}`);
    }
    await expect(host.spawn("p", { shell: true })).rejects.toThrow("unknown spawn option shell");
  });

  it("refuses a manifest Buzz would refuse", () => {
    expect(() => createHost(declare("/bin/sh"))).toThrow(/would be refused by Buzz/);
    expect(() => createHost(declare("sh", ["x".repeat(1025)]))).toThrow(/over 1024/);
  });

  it("puts the declared arguments first and the caller's after them", async () => {
    const host = make(declare("sh", ["-c", 'echo "$0 $1 $2"', "declared"]));
    let out = "";
    const proc = await host.spawn("p", { args: ["one", "two"], onStdout: (text: string) => (out += text) });
    await proc.exited;
    expect(out.trim()).toBe("declared one two");
    expect(host.calls[0].args).toEqual(["one", "two"]);
  });
});

describe("the environment (host_process.rs set_environment)", () => {
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", APP_ONLY: "app", BUZZ_FROM_APP: "identity", NOSTR_FROM_APP: "key" };
  const names = "echo \"[$APP_ONLY][${BUZZ_FROM_APP-gone}][${NOSTR_FROM_APP-gone}][${PLUGIN_ADDED-none}][$BUZZ_VERSION]\"";

  it("passes the app's environment, less BUZZ_* and NOSTR_*, and adds the plugin's, with BUZZ_VERSION last", async () => {
    const { out } = await run(names, { env: { PLUGIN_ADDED: "yes", BUZZ_VERSION: "plugin-cannot-set-this" } }, { env, version: "9.9.9" });
    expect(out.trim()).toBe("[app][gone][gone][yes][9.9.9]");
  });

  it("lets the plugin set a BUZZ_* name of its own, and remove one of the app's with null", async () => {
    const { out } = await run('echo "[${BUZZ_MINE-none}][${APP_ONLY-removed}]"', { env: { BUZZ_MINE: "set", APP_ONLY: null } }, { env });
    expect(out.trim()).toBe("[set][removed]");
  });

  it("refuses an empty name, a name with = and one with a NUL", async () => {
    const host = make(declare("sh", ["-c", "true"]));
    for (const name of ["", "A=B", "A\0B"]) await expect(host.spawn("p", { env: { [name]: "x" } }), JSON.stringify(name)).rejects.toThrow("Invalid environment variable");
  });

  it("starts in the directory asked for, ~ meaning the home it was given", async () => {
    const { out } = await run("pwd", { cwd: "~/made/here" }, { home: "/tmp" });
    expect(out.trim()).toBe("/tmp/made/here");
  });
});

describe("output (host_process.rs take_text)", () => {
  it("is text: a byte that is not UTF-8 becomes U+FFFD", async () => {
    const { out } = await run("printf 'a\\377b'");
    expect(out).toBe("a�b");
  });

  it("waits for the rest of a character that a read cuts, however small the reads", async () => {
    const { out } = await run("printf '\\303\\251\\346\\227\\245\\360\\237\\230\\200'", {}, { split: randomSplit(5, 1) });
    expect(out).toBe("é日😀");
  });

  it("keeps stderr apart from stdout", async () => {
    const host = make(declare("sh", ["-c", "echo out; echo err >&2"]));
    let out = "";
    let err = "";
    const proc = await host.spawn("p", { onStdout: (text: string) => (out += text), onStderr: (text: string) => (err += text) });
    await proc.exited;
    expect([out.trim(), err.trim()]).toEqual(["out", "err"]);
  });
});

describe("input (service.ts: writes go out in pieces)", () => {
  it("delivers a write of several pieces, a surrogate pair on a boundary included, whole and in order", async () => {
    const host = make(declare("cat"));
    let out = "";
    const proc = await host.spawn("p", { onStdout: (text: string) => (out += text) });
    const text = `${"x".repeat(WRITE_UNITS - 1)}😀${"y".repeat(WRITE_UNITS)}end`; // the pair's halves fall either side of the first cut
    await proc.write(text);
    await proc.end();
    await proc.exited;
    expect(out).toBe(text);
  });

  it("keeps writes in the order they were made", async () => {
    const host = make(declare("cat"));
    let out = "";
    const proc = await host.spawn("p", { onStdout: (text: string) => (out += text) });
    await Promise.all(["a", "b", "c", "d"].map((letter) => proc.write(letter.repeat(100_000))));
    await proc.end();
    await proc.exited;
    expect(out).toBe("a".repeat(100_000) + "b".repeat(100_000) + "c".repeat(100_000) + "d".repeat(100_000));
  });
});

describe("stopping (host_process.rs)", () => {
  it("sends SIGTERM to the process's group first", async () => {
    const host = make(declare("sh", ["-c", "sleep 100"]));
    const proc = await host.spawn("p");
    const started = Date.now();
    await proc.kill();
    expect(Date.now() - started).toBeLessThan(STOP_GRACE_MS);
    expect(await proc.exited).toBeNull(); // ended by a signal
  });

  it("sends SIGKILL after the 3 s grace to a process that ignores SIGTERM", async () => {
    const host = make(declare("sh", ["-c", "trap '' TERM; while :; do sleep 0.1; done"]));
    const proc = await host.spawn("p");
    await delay(200);
    const started = Date.now();
    await proc.kill();
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(STOP_GRACE_MS - 100);
    expect(took).toBeLessThan(STOP_GRACE_MS + 2000);
  });

  it("kills the group once the process has exited, so a child it left behind does not outlive it", async () => {
    const { out } = await run("sleep 4246 & echo $!");
    const child = Number(out.trim());
    expect(await gone(child, 3000), "the child outlived its parent's group").toBe(true);
  });

  it("does not follow a child that left the group (setsid): that is the limit the bridge's own hang-up exists for", async () => {
    const pidfile = `/tmp/ghostty-sim-${process.pid}-${Date.now()}.pid`;
    // The detached child writes its own pid and lets go of the pipes, which would otherwise hold the exit back.
    await run(`setsid sh -c 'echo $$ > "$0"; exec sleep 4247' ${pidfile} </dev/null >/dev/null 2>&1 & sleep 0.5`);
    const child = Number((await import("node:fs")).readFileSync(pidfile, "utf8").trim());
    (await import("node:fs")).rmSync(pidfile);
    try {
      await delay(300);
      expect(alive(child)).toBe(true);
    } finally {
      process.kill(child, "SIGKILL");
    }
  });
});
