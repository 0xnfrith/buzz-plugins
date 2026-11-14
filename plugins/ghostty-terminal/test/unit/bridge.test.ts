// src/bridge.py on a real PTY, through the host simulator (test/host-sim.mjs). Linux and macOS only, like Buzz's own terminal.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomSplit } from "../host-sim.mjs";
import { ALLOWLIST, alive, delay, gone, openShell, scratchHome, type Shell } from "./shell";

let home: ReturnType<typeof scratchHome>;
let shells: Shell[];
beforeEach(() => {
  home = scratchHome();
  shells = [];
});
afterEach(async () => {
  await Promise.all(shells.map((shell) => shell.host.stopAll()));
  home.remove();
});
const open = async (...args: Parameters<typeof openShell>) => {
  const shell = await openShell(...args);
  shells.push(shell);
  return shell;
};
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

describe("the shell", () => {
  it("runs on a terminal: a tty, TERM from the plugin, and a typed command is answered", async () => {
    const shell = await open(home.home);
    expect(await shell.run("[ -t 0 ] && [ -t 1 ] && echo TTY-YES; echo TERM=$TERM COLORTERM=$COLORTERM TERM_PROGRAM=$TERM_PROGRAM")).toBe(
      "TTY-YES\nTERM=xterm-256color COLORTERM=truecolor TERM_PROGRAM=Buzz",
    );
  });

  it("ignores arguments after its own: Buzz appends the caller's, and the bridge reads none", async () => {
    const shell = await open(home.home, { args: ["-c", "raise SystemExit(9)", "/bin/false", "--version"] });
    expect(await shell.run("echo still-here")).toBe("still-here");
    expect(shell.exitCode()).toBeUndefined();
  });

  it("sizes the terminal from the plugin's resize message, 80x24 until then", async () => {
    const shell = await open(home.home);
    expect(await shell.run("stty size")).toBe("24 80");
    await shell.resize(100, 30);
    await delay(100);
    expect(await shell.run("stty size")).toBe("30 100");
  });

  it("reports the shell's exit status once its last output has gone out", async () => {
    const shell = await open(home.home);
    await shell.send("echo BYE-$((6*7)); exit 3\n");
    expect(await shell.exited).toBe(3);
    expect(shell.text()).toContain("BYE-42");
  });
});

describe("python's isolated mode (-I)", () => {
  it("does not import a module of the same name from the working directory or from PYTHONPATH", async () => {
    const decoys = join(home.home, "decoys");
    const here = join(decoys, "cwd");
    const onPath = join(decoys, "pythonpath");
    for (const dir of [here, onPath]) mkdirSync(dir, { recursive: true });
    const marker = (name: string) => join(decoys, `${name}.ran`);
    // base64 and pty are two of the modules the bridge imports, and both are plain python files (a built-in module cannot be shadowed).
    writeFileSync(join(here, "base64.py"), `open(${JSON.stringify(marker("cwd"))}, "w").write("x")\n`);
    writeFileSync(join(onPath, "pty.py"), `open(${JSON.stringify(marker("pythonpath"))}, "w").write("x")\n`);

    // Control: without -I, python takes both decoys over the real modules, so the check below could fail.
    for (const [cwd, env] of [[here, {}], [decoys, { PYTHONPATH: onPath }]] as const) {
      try {
        execFileSync("python3", ["-c", "import base64, pty"], { cwd, env: { ...process.env, ...env }, stdio: "ignore" });
      } catch {
        // the decoy is not a real module; what matters is that it ran
      }
    }
    expect(existsSync(marker("cwd"))).toBe(true);
    expect(existsSync(marker("pythonpath"))).toBe(true);
    rmSync(marker("cwd"));
    rmSync(marker("pythonpath"));

    const shell = await open(home.home, { cwd: here, env: { PYTHONPATH: onPath } });
    expect(await shell.run("echo isolated")).toBe("isolated");
    expect(existsSync(marker("cwd"))).toBe(false);
    expect(existsSync(marker("pythonpath"))).toBe(false);
  });
});

describe("the shell's environment", () => {
  const secrets = {
    SENTINEL_SECRET: "s3cret",
    AWS_SECRET_ACCESS_KEY: "aws",
    GITHUB_TOKEN: "gh",
    NPM_TOKEN: "npm",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    DISPLAY: ":0",
    NOSTR_SECRET_KEY: "nsec",
    BUZZ_AGENT_KEY: "from the app, which the host strips",
  };

  const names = async (shell: Shell) =>
    new Map(
      (await shell.run("env"))
        .split("\n")
        .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const),
    );

  it("holds the allowlist and the plugin's BUZZ_* variables, and nothing else the app was started with", async () => {
    // A control run with the same minimal app environment and no secrets shows which names the login shell makes by itself.
    const minimal = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
    const control = await names(await open(home.home, { baseEnv: minimal }));
    const shell = await open(home.home, {
      baseEnv: minimal,
      appEnv: secrets,
      env: { BUZZ_CHANNEL_ID: "channel-1", BUZZ_CHANNEL: "general", PLUGIN_ONLY_EXTRA: "dropped" },
    });
    const variables = await names(shell);
    for (const name of Object.keys(secrets)) expect(variables.has(name), `${name} reached the shell`).toBe(false);
    expect(variables.has("PLUGIN_ONLY_EXTRA")).toBe(false);
    expect(variables.get("BUZZ_CHANNEL_ID")).toBe("channel-1");
    expect(variables.get("BUZZ_CHANNEL")).toBe("general");
    expect(variables.get("BUZZ_VERSION")).toBe("1.0.2");
    expect(variables.get("HOME")).toBe(home.home);
    expect(variables.get("TERM")).toBe("xterm-256color");
    expect(variables.get("COLORTERM")).toBe("truecolor");
    expect(variables.get("TERM_PROGRAM")).toBe("Buzz");
    expect(variables.has("PATH")).toBe(true);
    const stray = [...variables.keys()].filter((name) => !control.has(name) && !name.startsWith("BUZZ_"));
    expect(stray, "names the secrets-free control run does not have").toEqual([]);
  });

  it("is built from the bridge's own list: every name on it is in the plugin's allowlist the tests and README name", async () => {
    const source = readFileSync(new URL("../../src/bridge.py", import.meta.url), "utf8");
    const listed = /KEEP = '([^']*)'/.exec(source)?.[1].split(" ");
    expect(listed).toEqual(ALLOWLIST);
    expect(listed).not.toContain("SSH_AUTH_SOCK");
  });
});

describe("a large paste", () => {
  /** Valid text of at least `size` UTF-8 bytes, with multi-byte characters, an emoji and terminal control characters in it. */
  function text(size: number): string {
    const parts: string[] = [];
    for (let at = 0, n = 0; at < size; n++) {
      const part = `line ${n} ${"abcdefghij".repeat(6)} é日本😀\t\x1b[31mred\x1b[0m\r\n`;
      parts.push(part);
      at += Buffer.byteLength(part);
    }
    return parts.join("");
  }

  it("goes through a program that echoes it back, byte for byte, without the bridge stalling (2 MiB)", async () => {
    const shell = await open(home.home);
    // Raw mode and no echo: the bytes come back exactly as they went in.
    await shell.send("stty raw -echo; echo GO-$((6*7)); exec cat\n");
    const output = await shell.waitFor("GO-42\n");
    const offset = Buffer.byteLength(output.slice(0, output.indexOf("GO-42\n") + "GO-42\n".length));

    const pasted = text(2 * 1024 * 1024);
    const expected = Buffer.from(pasted);
    await shell.send(pasted);
    await shell.until(() => shell.bytes().length >= offset + expected.length, `${expected.length} bytes echoed`, 40_000);
    const echoed = shell.bytes().subarray(offset, offset + expected.length);
    expect(echoed.length).toBe(expected.length);
    expect(sha256(echoed)).toBe(sha256(expected));
    // And nothing extra arrived after it.
    await delay(300);
    expect(shell.bytes().length).toBe(offset + expected.length);
  });
});

describe("what a read of output can look like", () => {
  it("returns bytes that are not valid UTF-8 unchanged, though the host reads output as text and cuts it anywhere", async () => {
    const file = join(home.home, "random.bin");
    const content = randomBytes(300_000);
    writeFileSync(file, content);
    const shell = await open(home.home, { split: randomSplit(7) });
    await shell.send(`stty raw -echo; cat ${file}; echo DONE-$((6*7))\n`);
    await shell.until(() => shell.bytes().includes("DONE-42"), "DONE-42", 30_000);
    const bytes = shell.bytes();
    const end = bytes.indexOf("DONE-42");
    expect(sha256(bytes.subarray(end - content.length, end))).toBe(sha256(content));
  });
});

describe("stopping", () => {
  const pidOf = async (shell: Shell, command: string, tag: string) => Number(new RegExp(`${tag}-(\\d+)`).exec(await shell.run(command))?.[1]);

  it("hangs up a background job when the host asks the bridge to stop (SIGTERM, the close and restart path)", async () => {
    const shell = await open(home.home);
    const job = await pidOf(shell, "sleep 4242 & echo BG-$!", "BG");
    expect(alive(job)).toBe(true);
    const started = Date.now();
    await shell.proc.kill();
    expect(Date.now() - started).toBeLessThan(2500);
    expect(await gone(job, 3000), "the background job outlived the stop").toBe(true);
  });

  it("hangs up a background job when its input closes", async () => {
    const shell = await open(home.home);
    const job = await pidOf(shell, "sleep 4243 & echo BG-$!", "BG");
    await shell.proc.end();
    await shell.exited;
    expect(await gone(job, 3000), "the background job outlived the end of input").toBe(true);
  });

  it("leaves no job behind when the bridge is killed outright (the app-quit path)", async () => {
    const shell = await open(home.home);
    const job = await pidOf(shell, "sleep 4245 & echo BG-$!", "BG");
    process.kill(shell.pid, "SIGKILL");
    await shell.exited;
    expect(await gone(job, 5000), "the background job outlived a SIGKILL of the bridge").toBe(true);
  });

  it("kills a shell that ignores the hang-up after 2 s, before the host's own 3 s", async () => {
    const shell = await open(home.home);
    await shell.send("trap '' HUP\n");
    const login = await pidOf(shell, "echo SH-$$", "SH");
    const started = Date.now();
    await shell.proc.kill();
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(1800);
    expect(took).toBeLessThan(2900);
    expect(await gone(login, 1000), "the shell outlived the stop").toBe(true);
  });

  it("does not follow a job that left the terminal's session (setsid, nohup): it survives, as in any terminal (the README says so)", async () => {
    const shell = await open(home.home);
    await shell.run("setsid sleep 4244 </dev/null >/dev/null 2>&1 & echo DETACHED");
    await delay(300);
    const job = Number(execFileSync("pgrep", ["-f", "sleep 4244"]).toString().trim().split("\n")[0]);
    try {
      await shell.proc.kill();
      await delay(500);
      expect(alive(job)).toBe(true);
    } finally {
      process.kill(job, "SIGKILL");
    }
  });

  it("fails loudly on a line it cannot read: a traceback on stderr, a non-zero exit, and no shell left behind", async () => {
    const shell = await open(home.home);
    const login = await pidOf(shell, "echo SH-$$", "SH");
    await shell.proc.write("r x y\n");
    expect(await shell.exited).not.toBe(0);
    expect(shell.stderr()).toContain("Traceback");
    expect(await gone(login, 3000), "the shell outlived the bridge").toBe(true);
  });
});
