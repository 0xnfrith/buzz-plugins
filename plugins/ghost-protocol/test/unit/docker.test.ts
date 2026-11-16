import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Host, HostProcess, SpawnOptions } from "../../src/buzz";
import { COMMAND, KEPT_OF_GP, TIMEOUT_MS, WORDS, checkDocker, runDocker, runnerFor, textOf, versionOf, type Call } from "../../src/docker";

/**
 * A host whose `spawn` is a stub. `run` is the program that "docker" is: it gets the handlers the plugin passed, and decides what is
 * printed and how it exits. The stub records every call so a test can see exactly what was asked of the host.
 */
function stubHost(run: (options: SpawnOptions, exit: (code: number | null) => void) => void | Promise<void>) {
  const calls: { id: string; options: SpawnOptions | undefined; receiver: unknown }[] = [];
  const killed = vi.fn(async () => {});
  const host: Host = {
    async spawn(this: unknown, id, options) {
      calls.push({ id, options, receiver: this });
      let exit!: (code: number | null) => void;
      const exited = new Promise<number | null>((resolve) => (exit = resolve));
      const process: HostProcess = { kill: killed, exited };
      // Output arrives after spawn has returned, as it does from the desktop host.
      queueMicrotask(() => void run(options ?? {}, exit));
      return process;
    },
  };
  return { host, calls, killed };
}

const prints = (text: string, code: number | null = 0) => stubHost((options, exit) => {
  options.onStdout?.(text);
  exit(code);
});

/**
 * A host whose `runCommand` is a stub: `answer` is what the declared command "prints" (a string), or null when anything went wrong, as
 * the real host says it. Every call is recorded with its receiver, since the host's method reads the calling plugin from it.
 */
function commandHost(answer: (id: string) => string | null | Promise<string | null>) {
  const calls: { id: string; input: string | undefined; receiver: unknown }[] = [];
  const host: Host = {
    async runCommand(this: unknown, id, input) {
      calls.push({ id, input, receiver: this });
      return answer(id);
    },
  };
  return { host, calls };
}
const answers = (text: string | null) => commandHost(() => text);

describe("checkDocker", () => {
  it("shows the server version when the command prints it", async () => {
    expect(await checkDocker(answers("27.3.1\n").host)).toEqual({ state: "ready", version: "27.3.1" });
  });

  it("accepts the shapes Docker's versions take, with a Windows line ending or none", async () => {
    for (const [printed, version] of [["28.0.0-rc.1\r\n", "28.0.0-rc.1"], ["24.0.7-ce", "24.0.7-ce"], ["20.10.24+dfsg1\n", "20.10.24+dfsg1"], ["  27.3.1  \n\n", "27.3.1"]] as const) {
      expect(await checkDocker(answers(printed).host)).toEqual({ state: "ready", version });
    }
  });

  it("runs the declared `version` command, whose every word is fixed in the manifest, and gives it nothing: no input, no arguments", async () => {
    const { host, calls } = answers("27.3.1\n");
    await checkDocker(host);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe(COMMAND.version);
    expect(COMMAND.version).toBe("version");
    expect(calls[0]?.input).toBeUndefined();
    // `runCommand` is a method that reads the calling plugin from its receiver: it must be called on the host.
    expect(calls[0]?.receiver).toBe(host);
  });

  it("says the same words for every way it can fail, since the host says only that it did: no docker, not running, too slow", async () => {
    expect(await checkDocker(answers(null).host)).toEqual({ state: "unavailable" });
    expect(textOf("unavailable")).toBe("Docker didn't answer. Install or start Docker Desktop, then retry.");
  });

  it("says the same when the host's call itself throws, or does not give a string", async () => {
    const throws = commandHost(() => Promise.reject(new Error("host gone")));
    expect(await checkDocker(throws.host)).toEqual({ state: "unavailable" });
    const odd = commandHost(() => 5 as never);
    expect(await checkDocker(odd.host)).toEqual({ state: "unavailable" });
    const undef = commandHost(() => undefined as never);
    expect(await checkDocker(undef.host)).toEqual({ state: "unavailable" });
  });

  it("says the same when it prints something that is not a version, whatever the host thought of it", async () => {
    for (const printed of ["", "\n", "<no value>\n", "Cannot connect to the Docker daemon at unix:///var/run/docker.sock\n", "27.3.1\n28.0.0\n", "27 3 1", "null", "error", "unknown", "undefined", "true", "v27.3.1", "-27.3.1", ".1", "x".repeat(65), "\u0000"]) {
      expect(await checkDocker(answers(printed).host), JSON.stringify(printed)).toEqual({ state: "unavailable" });
    }
  });

  it("says this Buzz cannot run commands, and runs nothing, when the host has no `runCommand`", async () => {
    expect(await checkDocker({})).toEqual({ state: "unsupported" });
    expect(await checkDocker({ spawn: async () => Promise.reject(new Error("no")) })).toEqual({ state: "unsupported" });
  });

  it("answers nothing when the caller left while the command was running, and shows no answer late", async () => {
    const abort = new AbortController();
    let finish!: (text: string | null) => void;
    const slow = commandHost(() => new Promise<string | null>((resolve) => (finish = resolve)));
    const result = checkDocker(slow.host, abort.signal);
    abort.abort();
    finish("27.3.1\n");
    expect(await result).toBeUndefined();
    // Also a call that fails after the caller left.
    const again = new AbortController();
    const failing = commandHost(async () => {
      again.abort();
      return null;
    });
    expect(await checkDocker(failing.host, again.signal)).toBeUndefined();
    // A caller that has already left starts nothing that it will read.
    const gone = new AbortController();
    gone.abort();
    expect(await checkDocker(answers("27.3.1\n").host, gone.signal)).toBeUndefined();
  });

  it("does not start a process: the check is a command", async () => {
    const spawn = vi.fn();
    const host: Host = { runCommand: async () => "27.3.1\n", spawn };
    await checkDocker(host);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("versionOf", () => {
  it("is the one line, trimmed, or nothing", () => {
    expect(versionOf("27.3.1\n")).toBe("27.3.1");
    expect(versionOf("")).toBeUndefined();
    expect(versionOf("27.3.1\nextra")).toBeUndefined();
    expect(versionOf("<script>alert(1)</script>")).toBeUndefined();
  });
});

describe("the words", () => {
  it("are one text for a failure, which says Docker did not answer and to install or start Docker Desktop, and a plain line for each other state", () => {
    expect(textOf("unavailable")).toBe("Docker didn't answer. Install or start Docker Desktop, then retry.");
    expect(textOf("ready")).toBe("Docker is running");
    expect(textOf("checking")).toBe("Checking Docker…");
    expect(textOf("unsupported")).toBe(WORDS.unsupported);
  });
});

/** A call of the declared `exec` process, as the status call is. */
const EXEC: Call = { process: "exec", args: ["gp-x", "gp", "status", "--json"] };

describe("runDocker", () => {
  it("ends with the exit code and both streams, whole", async () => {
    const { host, calls } = stubHost((options, exit) => {
      options.onStdout?.("out ");
      options.onStderr?.("err");
      options.onStdout?.("put");
      exit(3);
    });
    expect(await runDocker(host, EXEC)).toEqual({ kind: "exit", code: 3, stdout: "out put", stderr: "err" });
    expect(calls[0]?.id).toBe("exec");
    expect(calls[0]?.options?.args).toEqual(["gp-x", "gp", "status", "--json"]);
  });

  it("ends with a null code when a signal ended the process", async () => {
    expect(await runDocker(prints("x", null).host, EXEC)).toEqual({ kind: "exit", code: null, stdout: "x", stderr: "" });
  });

  it("says unavailable when there is no docker to start, or it does not answer in time, and unsupported when there is no spawn", async () => {
    expect(await runDocker({ spawn: () => Promise.reject(new Error("no docker")) }, EXEC)).toEqual({ kind: "unavailable" });
    expect(await runDocker({}, EXEC)).toEqual({ kind: "unsupported" });
  });

  it("keeps stdout up to the length asked for and stderr up to 4096, so a runaway process cannot grow either", async () => {
    const { host } = stubHost((options, exit) => {
      for (let at = 0; at < 200; at++) {
        options.onStdout?.("o".repeat(1024));
        options.onStderr?.("e".repeat(1024));
      }
      exit(0);
    });
    const small = await runDocker(host, EXEC);
    expect(small).toMatchObject({ kind: "exit" });
    if (small?.kind === "exit") {
      expect(small.stdout.length).toBe(4096);
      expect(small.stderr.length).toBe(4096);
    }
    const large = await runDocker(host, EXEC, { keep: KEPT_OF_GP });
    if (large?.kind === "exit") {
      expect(large.stdout.length).toBe(KEPT_OF_GP);
      expect(large.stderr.length).toBe(4096);
    }
    expect(KEPT_OF_GP).toBe(65_536);
  });
});

describe("runnerFor", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs a call for the host, stops it with the signal, and keeps what a GHOST Protocol call prints", async () => {
    const { host, calls } = prints("{}\n");
    const run = runnerFor(host, new AbortController().signal);
    expect(await run(EXEC)).toEqual({ kind: "exit", code: 0, stdout: "{}\n", stderr: "" });
    expect(calls[0]?.receiver).toBe(host);
    const abort = new AbortController();
    const { host: silent, killed } = stubHost(() => {});
    const pending = runnerFor(silent, abort.signal)(EXEC);
    await vi.advanceTimersByTimeAsync(10);
    abort.abort();
    expect(await pending).toBeUndefined();
    expect(killed).toHaveBeenCalledTimes(1);
  });

  it("gives a call fifteen seconds unless it is given another time", async () => {
    const { host, killed } = stubHost(() => {});
    const run = runnerFor(host, new AbortController().signal);
    const slow = run(EXEC);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(killed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await slow).toEqual({ kind: "unavailable" });
    const { host: other, killed: otherKilled } = stubHost(() => {});
    const longer = runnerFor(other, new AbortController().signal)(EXEC, 60_000);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(otherKilled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await longer).toEqual({ kind: "unavailable" });
    expect(otherKilled).toHaveBeenCalledTimes(1);
  });
});
