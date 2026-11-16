// Asks Docker for its server's version through the one process the manifest declares: `docker version --format {{.Server.Version}}`,
// its arguments fixed there. The plugin passes none of its own, so nothing a person or a page typed can reach the command line.
import type { Host } from "./buzz";

/** The id of the process in manifest.json's `host.processes`. */
export const PROCESS_ID = "docker-version";
/** How long Docker has to answer before the check gives up. A daemon that is starting can leave the command waiting. */
export const TIMEOUT_MS = 15_000;
/** Characters of output kept: a version is a few, so anything longer is not one. */
const KEPT = 4096;

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

// What `docker version` prints for a server: 27.3.1, 28.0.0-rc.1, 24.0.7-ce, 20.10.24+dfsg1. One line, no spaces: an error message, a
// banner or a template's "<no value>" is not a version, even if the command exited with 0.
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+~-]{0,63}$/;

export function versionOf(output: string): string | undefined {
  const lines = output.trim().split(/\r?\n/);
  const [line] = lines;
  return lines.length === 1 && line !== undefined && VERSION.test(line) ? line : undefined;
}

/**
 * Runs the check. Resolves with the outcome, or with `undefined` when `signal` aborts first: the process is then stopped and the caller
 * has gone. It never rejects.
 */
export async function checkDocker(host: Host, signal?: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<Check | undefined> {
  if (typeof host.spawn !== "function") return { state: "unsupported" };
  let output = "";
  let process;
  try {
    // Called on `host`: the host's `spawn` is a method that reads the calling plugin from its receiver. Only the output handlers are
    // passed: no arguments, no working directory, no environment. Stderr is not kept.
    process = await host.spawn(PROCESS_ID, {
      onStdout(text) {
        if (output.length < KEPT) output += text;
      },
      onStderr() {},
    });
  } catch {
    // The program could not be started: there is no `docker` on the PATH.
    return signal?.aborted ? undefined : { state: "unavailable" };
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
      return result === "abort" ? undefined : { state: "unavailable" };
    }
    const version = result === 0 ? versionOf(output) : undefined;
    return version === undefined ? { state: "unavailable" } : { state: "ready", version };
  } catch {
    await process.kill().catch(() => undefined);
    return signal?.aborted ? undefined : { state: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
