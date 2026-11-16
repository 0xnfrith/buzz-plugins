import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Host, HostProcess, SpawnOptions } from "../../src/buzz";
import { KEPT_OF_GP, PROCESS, TIMEOUT_MS, VERSION_CALL, WORDS, checkDocker, runDocker, runnerFor, textOf, versionOf, type Call } from "../../src/docker";

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

describe("checkDocker", () => {
  it("shows the server version when docker exits 0 and prints it", async () => {
    const { host } = prints("27.3.1\n");
    expect(await checkDocker(host)).toEqual({ state: "ready", version: "27.3.1" });
  });

  it("accepts the shapes Docker's versions take, with a Windows line ending or none", async () => {
    for (const [printed, version] of [["28.0.0-rc.1\r\n", "28.0.0-rc.1"], ["24.0.7-ce", "24.0.7-ce"], ["20.10.24+dfsg1\n", "20.10.24+dfsg1"], ["  27.3.1  \n\n", "27.3.1"]] as const) {
      expect(await checkDocker(prints(printed).host)).toEqual({ state: "ready", version });
    }
  });

  it("joins output that arrives in pieces", async () => {
    const { host } = stubHost((options, exit) => {
      for (const piece of ["2", "7.3", ".1", "\n"]) options.onStdout?.(piece);
      exit(0);
    });
    expect(await checkDocker(host)).toEqual({ state: "ready", version: "27.3.1" });
  });

  it("spawns the declared `version` process, whose words are all fixed in the manifest, with the output handlers: no working directory, no environment", async () => {
    const { host, calls } = prints("27.3.1\n");
    await checkDocker(host);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe(PROCESS.version);
    expect(PROCESS.version).toBe("version");
    expect(calls[0]?.options?.args).toEqual([]);
    expect(VERSION_CALL).toEqual({ process: "version", args: [] });
    expect(Object.keys(calls[0]?.options ?? {}).sort()).toEqual(["args", "onStderr", "onStdout"]);
    // `spawn` is a method that reads the calling plugin from its receiver: it must be called on the host.
    expect(calls[0]?.receiver).toBe(host);
  });

  it("shows the Docker Desktop text when docker exits non-zero, whatever it printed", async () => {
    for (const code of [1, 2, 125, 127, null]) {
      expect(await checkDocker(prints("27.3.1\n", code).host)).toEqual({ state: "unavailable" });
    }
  });

  it("shows the Docker Desktop text when there is no docker to run (spawn rejects)", async () => {
    const host: Host = { spawn: async () => Promise.reject(new Error("program not found: docker")) };
    expect(await checkDocker(host)).toEqual({ state: "unavailable" });
  });

  it("shows the Docker Desktop text when exit 0 comes with nothing that is a version", async () => {
    for (const printed of ["", "\n", "<no value>\n", "Cannot connect to the Docker daemon at unix:///var/run/docker.sock\n", "27.3.1\n28.0.0\n", "27 3 1", "null", "error", "unknown", "undefined", "true", "v27.3.1", "-27.3.1", ".1", "x".repeat(65), "\u0000"]) {
      expect(await checkDocker(prints(printed).host), JSON.stringify(printed)).toEqual({ state: "unavailable" });
    }
  });

  it("does not read stderr: a version printed there is not a version", async () => {
    const { host } = stubHost((options, exit) => {
      options.onStderr?.("27.3.1\n");
      exit(0);
    });
    expect(await checkDocker(host)).toEqual({ state: "unavailable" });
  });

  it("keeps a bounded amount of output, so a runaway process cannot grow it", async () => {
    const { host } = stubHost((options, exit) => {
      for (let at = 0; at < 100; at++) options.onStdout?.("x".repeat(1024));
      exit(0);
    });
    expect(await checkDocker(host)).toEqual({ state: "unavailable" });
  });

  it("ignores output past the first 4096 characters, so a runaway process cannot grow what is kept", async () => {
    const { host } = stubHost((options, exit) => {
      for (const piece of ["27.3.1\n", "\n".repeat(5000), "extra\n"]) options.onStdout?.(piece);
      exit(0);
    });
    expect(await checkDocker(host)).toEqual({ state: "ready", version: "27.3.1" });
  });

  it("gives Docker 15 seconds, as the README says", () => {
    expect(TIMEOUT_MS).toBe(15_000);
  });

  it("says so, and starts nothing, when this Buzz has no way to start a process", async () => {
    expect(await checkDocker({})).toEqual({ state: "unsupported" });
  });

  it("still answers the Docker Desktop text when the host's own failure is a throw of something that is not an Error", async () => {
    const host: Host = { spawn: () => Promise.reject("nope") };
    expect(await checkDocker(host)).toEqual({ state: "unavailable" });
  });
});

describe("checkDocker, when docker does not answer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stops the process and shows the Docker Desktop text after the time is up", async () => {
    const { host, killed } = stubHost(() => {});
    const result = checkDocker(host);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(killed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ state: "unavailable" });
    expect(killed).toHaveBeenCalledTimes(1);
  });

  it("does not stop a process that answered in time, and leaves no timer behind", async () => {
    const { host, killed } = prints("27.3.1\n");
    expect(await checkDocker(host)).toEqual({ state: "ready", version: "27.3.1" });
    expect(vi.getTimerCount()).toBe(0);
    expect(killed).not.toHaveBeenCalled();
  });

  it("stops the process and answers nothing when the caller leaves", async () => {
    const { host, killed } = stubHost(() => {});
    const abort = new AbortController();
    const result = checkDocker(host, abort.signal);
    await vi.advanceTimersByTimeAsync(10);
    abort.abort();
    expect(await result).toBeUndefined();
    expect(killed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops a process that only started after the caller had left", async () => {
    const abort = new AbortController();
    const { host, killed } = stubHost(() => {});
    abort.abort();
    expect(await checkDocker(host, abort.signal)).toBeUndefined();
    expect(killed).toHaveBeenCalledTimes(1);
  });

  it("answers nothing when the caller leaves while spawn is still failing", async () => {
    const abort = new AbortController();
    const host: Host = {
      spawn: async () => {
        abort.abort();
        throw new Error("gone");
      },
    };
    expect(await checkDocker(host, abort.signal)).toBeUndefined();
  });

  it("is not left waiting by a kill that fails", async () => {
    const host: Host = { spawn: async () => ({ exited: new Promise(() => {}), kill: () => Promise.reject(new Error("already gone")) }) };
    const result = checkDocker(host);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(await result).toEqual({ state: "unavailable" });
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
  it("are the Docker Desktop text for a failure, and a plain line for each other state", () => {
    expect(textOf("unavailable")).toBe("Install or start Docker Desktop");
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
