// Runs `docker` through the one process the manifest declares: the bare program, with every argument chosen by this plugin when it asks.
// The declaration fixes none, so what `docker` may be asked is decided here, and only by src/commands.ts: nothing a person typed, and
// nothing GHOST Protocol or Docker printed, becomes an argument except a name that src/slug.ts has checked.
import type { Host } from "./buzz";

/** The id of the process in manifest.json's `host.processes`. */
export const PROCESS_ID = "docker";
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
export type Runner = (args: readonly string[], timeoutMs?: number) => Promise<Ran | undefined>;

/** Characters kept of what a GHOST Protocol call prints: a status is a few hundred, written over several lines. */
export const KEPT_OF_GP = 65_536;

/** A runner for one host, which stops its calls with `signal`. */
export const runnerFor =
  (host: Host, signal: AbortSignal): Runner =>
  (args, timeoutMs = TIMEOUT_MS) =>
    runDocker(host, args, { signal, timeoutMs, keep: KEPT_OF_GP });

/**
 * Runs `docker` with `args` and waits for it to end. Resolves with `undefined` when `options.signal` aborts first: the process is then
 * stopped and the caller has gone. It never rejects.
 */
export async function runDocker(host: Host, args: readonly string[], options: RunOptions = {}): Promise<Ran | undefined> {
  const { signal, timeoutMs = TIMEOUT_MS, keep = KEPT } = options;
  if (typeof host.spawn !== "function") return { kind: "unsupported" };
  let stdout = "";
  let stderr = "";
  let process;
  try {
    // Called on `host`: the host's `spawn` is a method that reads the calling plugin from its receiver. The arguments follow the ones the
    // manifest declares, which are none.
    process = await host.spawn(PROCESS_ID, {
      args,
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

/** `docker version`, asking for the server's version alone. */
export const VERSION_ARGS = ["version", "--format", "{{.Server.Version}}"] as const;

/**
 * Asks Docker for its server's version. Resolves with `undefined` when `signal` aborts first: the process is then stopped and the caller
 * has gone. It never rejects.
 */
export async function checkDocker(host: Host, signal?: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<Check | undefined> {
  const ran = await runDocker(host, VERSION_ARGS, { signal, timeoutMs });
  if (ran === undefined) return undefined;
  if (ran.kind === "unsupported") return { state: "unsupported" };
  if (ran.kind === "unavailable" || ran.code !== 0) return { state: "unavailable" };
  const version = versionOf(ran.stdout);
  return version === undefined ? { state: "unavailable" } : { state: "ready", version };
}
