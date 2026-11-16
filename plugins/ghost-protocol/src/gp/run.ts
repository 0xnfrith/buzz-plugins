// Runs one `docker` command through the host's declared process and says how it ended. Never rejects: a program that cannot start, a
// command that outlasts its time and a caller that gave up are each an outcome. Output is read as text and kept in part (a pull prints a
// lot); nothing is logged, and stdin carries whatever must not be an argument.
import type { Call, Handlers, Proc, StartDocker } from "../docker";
import { parseGp, type Gp } from "./protocol";

export type { Proc, StartDocker };

export type Outcome =
  | Readonly<{ kind: "exit"; code: number | null; stdout: string; stderr: string; gp: Gp }>
  /** No `docker` to run. */
  | Readonly<{ kind: "cannot-start" }>
  | Readonly<{ kind: "timeout" }>
  /** `signal` aborted first: the process is stopped and the caller has gone. */
  | Readonly<{ kind: "aborted" }>;

export type Options = Readonly<{
  /** Written to stdin, which is then closed. Without it stdin is closed at once. */
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  /** Each complete line of stdout, as it comes. */
  onLine?(line: string): void;
}>;

/** Characters of each stream kept: a status or a GP answer is a few hundred; a pull's progress is the rest. */
const KEPT = 256 * 1024;

const lines = (emit: (line: string) => void) => {
  let pending = "";
  return {
    push(data: string) {
      pending += data;
      const parts = pending.split(/\r\n|\n|\r/);
      pending = parts.pop() ?? "";
      for (const line of parts) if (line !== "") emit(line);
    },
    flush() {
      if (pending !== "") emit(pending);
      pending = "";
    },
  };
};

/** A command that is still running, for the one that talks (`gp claude login` prints an address and waits for a code). */
export type Running = Readonly<{
  write(data: string): Promise<void>;
  end(data?: string): Promise<void>;
  kill(): Promise<void>;
  done: Promise<Outcome>;
}>;

export async function startRun(start: StartDocker, command: Call, options: Pick<Options, "signal" | "timeoutMs" | "onLine">): Promise<Running> {
  const { signal, timeoutMs, onLine } = options;
  let stdout = "";
  let stderr = "";
  const reader = lines((line) => onLine?.(line));
  let proc: Proc;
  try {
    proc = await start(command, {
      onStdout(data) {
        if (stdout.length < KEPT) stdout += data;
        reader.push(data);
      },
      onStderr(data) {
        if (stderr.length < KEPT) stderr += data;
      },
    });
  } catch {
    const outcome: Outcome = signal?.aborted ? { kind: "aborted" } : { kind: "cannot-start" };
    const gone = () => Promise.resolve();
    return { write: gone, end: gone, kill: gone, done: Promise.resolve(outcome) };
  }
  const stop = () => proc.kill().catch(() => undefined);
  const done = (async (): Promise<Outcome> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const interrupted = new Promise<"timeout" | "abort">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
        if (signal?.aborted) resolve("abort");
        else {
          onAbort = () => resolve("abort");
          signal?.addEventListener("abort", onAbort, { once: true });
        }
      });
      const result = await Promise.race([proc.exited, interrupted]);
      if (result === "timeout" || result === "abort") {
        await stop();
        return { kind: result === "abort" ? "aborted" : "timeout" };
      }
      reader.flush();
      return { kind: "exit", code: result, stdout, stderr, gp: parseGp(stdout) };
    } catch {
      await stop();
      return signal?.aborted ? { kind: "aborted" } : { kind: "cannot-start" };
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  })();
  return { write: (data) => proc.write(data), end: (data) => proc.end(data), kill: stop, done };
}

/** Runs the command to its end. */
export async function run(start: StartDocker, command: Call, options: Options): Promise<Outcome> {
  const running = await startRun(start, command, options);
  // stdin is closed in every case: a command that reads it would otherwise wait for ever.
  await (options.stdin === undefined ? running.end() : running.end(options.stdin)).catch(() => undefined);
  return running.done;
}

/** The last non-empty line docker or GP printed on stderr, trimmed to one short line for a message. */
export function lastLine(text: string, max = 160): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .pop();
  return line === undefined ? "" : line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
