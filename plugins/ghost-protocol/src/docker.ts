// Runs `docker` through the processes the manifest declares: one entry per verb, each the program `docker` with its leading words fixed
// there (`exec`, `restart`, `inspect --format {{.State.Status}}`…), so the plugin can start nothing but those verbs. A call names its
// process and gives only the arguments that follow the fixed ones: what those are is decided by src/commands.ts alone, and nothing a
// person typed, and nothing GHOST Protocol or Docker printed, becomes one except a name that src/slug.ts has checked.
import type { Host } from "./buzz";

/** The ids of the processes in manifest.json's `host.processes`, and the leading arguments each fixes there. */
export const PROCESS = {
  /** `version --format {{.Server.Version}}` */
  version: "version",
  /** `exec`: the container's name and the command in it follow. */
  exec: "exec",
  /** `inspect --format {{.State.Status}}`: the container's name follows. */
  inspectState: "inspect-state",
  /** `inspect --format {{.Config.Image}}`: the container's name follows. */
  inspectImage: "inspect-image",
  /** `restart`: the container's name follows. */
  restart: "restart",
  /** `stop`: the container's name follows. */
  stop: "stop",
} as const;

export type ProcessId = (typeof PROCESS)[keyof typeof PROCESS];

/** One call: a declared process, and the arguments that follow the ones the manifest fixes for it. */
export type Call = Readonly<{ process: ProcessId; args: readonly string[] }>;
/** How long Docker has to answer before a call gives up. A daemon that is starting can leave a command waiting. */
export const TIMEOUT_MS = 15_000;
/** Characters of output kept from each stream: a version or a one-line error is a few, so anything longer is not one. */
const KEPT = 4096;

/** What a `docker` call came to. */
export type Ran =
  /** `docker` ran and ended: `code` is null when a signal ended it. */
  | Readonly<{ kind: "exit"; code: number | null; stdout: string; stderr: string }>
  /** No `docker` to run, a host that failed the call, or no answer in time. */
  | Readonly<{ kind: "unavailable" }>
  /** This Buzz has no way to start a process (it is not the desktop app). */
  | Readonly<{ kind: "unsupported" }>;

export type RunOptions = Readonly<{
  /** Stops the call and the process when it aborts. */
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
  /** Characters kept of stdout (a chunk that begins under this is kept whole). */
  keep?: number;
}>;

/** Asks for one call. Resolves with `undefined` when the signal aborts first, and never rejects. */
export type Runner = (call: Call, timeoutMs?: number) => Promise<Ran | undefined>;

/** Characters kept of what a GHOST Protocol call prints: a status is a few hundred, written over several lines. */
export const KEPT_OF_GP = 65_536;

/** A runner for one host, which stops its calls with `signal`. */
export const runnerFor =
  (host: Host, signal: AbortSignal): Runner =>
  (call, timeoutMs = TIMEOUT_MS) =>
    runDocker(host, call, { signal, timeoutMs, keep: KEPT_OF_GP });

/**
 * Runs `call` and waits for it to end. Resolves with `undefined` when `options.signal` aborts first: the process is then stopped and the
 * caller has gone. It never rejects.
 */
export async function runDocker(host: Host, call: Call, options: RunOptions = {}): Promise<Ran | undefined> {
  const { signal, timeoutMs = TIMEOUT_MS, keep = KEPT } = options;
  if (typeof host.spawn !== "function") return { kind: "unsupported" };
  let stdout = "";
  let stderr = "";
  let process;
  try {
    // Called on `host`: the host's `spawn` is a method that reads the calling plugin from its receiver. The arguments follow the ones the
    // manifest declares for this process.
    process = await host.spawn(call.process, {
      args: call.args,
      onStdout(text) {
        if (stdout.length < keep) stdout += text;
      },
      onStderr(text) {
        if (stderr.length < KEPT) stderr += text;
      },
    });
  } catch {
    // The program could not be started: there is no `docker` on the PATH.
    return signal?.aborted ? undefined : { kind: "unavailable" };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stopped = new Promise<"timeout" | "abort">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
      if (signal?.aborted) resolve("abort");
      else signal?.addEventListener("abort", () => resolve("abort"), { once: true });
    });
    const result = await Promise.race([process.exited, stopped]);
    if (result === "abort" || result === "timeout") {
      await process.kill().catch(() => undefined);
      return result === "abort" ? undefined : { kind: "unavailable" };
    }
    return { kind: "exit", code: result, stdout, stderr };
  } catch {
    await process.kill().catch(() => undefined);
    return signal?.aborted ? undefined : { kind: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export type Check =
  /** Docker's server answered with this version. */
  | Readonly<{ state: "ready"; version: string }>
  /** No `docker` to run, a non-zero exit, no answer in time, or an answer that is not a version. */
  | Readonly<{ state: "unavailable" }>
  /** This Buzz has no way to start a process (it is not the desktop app). */
  | Readonly<{ state: "unsupported" }>;

export const WORDS = {
  checking: "Checking Docker…",
  ready: "Docker is running",
  unavailable: "Install or start Docker Desktop",
  unsupported: "This Buzz cannot start programs. Use the Buzz desktop app.",
} as const;

export const textOf = (state: Check["state"] | "checking"): string => WORDS[state];

// What `docker version` prints for a server: 27.3.1, 28.0.0-rc.1, 24.0.7-ce, 20.10.24+dfsg1. One line, no spaces, and it starts with a
// digit: an error message, a banner, a template's "<no value>" or a word such as "null" is not a version, even if the command exited with 0.
const VERSION = /^[0-9][0-9A-Za-z._+~-]{0,63}$/;

export function versionOf(output: string): string | undefined {
  const lines = output.trim().split(/\r?\n/);
  const [line] = lines;
  return lines.length === 1 && line !== undefined && VERSION.test(line) ? line : undefined;
}

/** `docker version --format {{.Server.Version}}`: its words are all fixed in the manifest, so it has none of its own. */
export const VERSION_CALL: Call = { process: PROCESS.version, args: [] };

/**
 * Asks Docker for its server's version. Resolves with `undefined` when `signal` aborts first: the process is then stopped and the caller
 * has gone. It never rejects.
 */
export async function checkDocker(host: Host, signal?: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<Check | undefined> {
  const ran = await runDocker(host, VERSION_CALL, { signal, timeoutMs });
  if (ran === undefined) return undefined;
  if (ran.kind === "unsupported") return { state: "unsupported" };
  if (ran.kind === "unavailable" || ran.code !== 0) return { state: "unavailable" };
  const version = versionOf(ran.stdout);
  return version === undefined ? { state: "unavailable" } : { state: "ready", version };
}
