// Drives the real bridge on a real PTY through the host simulator, the way the plugin does: the bridge's lines are reassembled and
// decoded with src/protocol.ts, and input goes out as its frames.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHost } from "../host-sim.mjs";
import manifest from "../../manifest.json" with { type: "json" };
import { LineAssembler, encodeInput, encodeResize, fromBase64 } from "../../src/protocol";

export const ALLOWLIST =
  "HOME USER LOGNAME LANG LC_ALL LC_CTYPE TZ TMPDIR PATH TERM COLORTERM TERM_PROGRAM BUZZ_VERSION BUZZ_CHANNEL_ID BUZZ_CHANNEL BUZZ_NPUB BUZZ_RELAY_URL BUZZ_THREAD_ID".split(" ");
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Shell = Awaited<ReturnType<typeof openShell>>;

type Options = {
  args?: string[];
  env?: Record<string, string | null>;
  cwd?: string;
  /** What the app itself was started with, which the host passes on (less BUZZ_* and NOSTR_*). This machine's, when not given. */
  baseEnv?: Record<string, string>;
  /** More for the app's environment, on top of that. */
  appEnv?: Record<string, string>;
  split?: (chunk: Buffer) => Buffer[];
};

/** A scratch HOME, so no profile of the machine's user is read by the login shell. */
export function scratchHome() {
  const home = mkdtempSync(join(tmpdir(), "ghostty-terminal-"));
  return { home, remove: () => rmSync(home, { recursive: true, force: true }) };
}

export async function openShell(home: string, options: Options = {}) {
  const host = createHost(manifest, {
    env: { ...(options.baseEnv ?? (process.env as Record<string, string>)), HOME: home, ...options.appEnv },
    home,
    ...(options.split ? { split: options.split } : {}),
  });
  const lines = new LineAssembler();
  const chunks: Buffer[] = [];
  let stderr = "";
  const waiting = new Set<() => void>();
  const wake = () => waiting.forEach((check) => check());
  const proc = await host.spawn("pty", {
    args: options.args ?? [],
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: { TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Buzz", ...options.env },
    onStdout: (text: string) => {
      for (const line of lines.push(text)) chunks.push(Buffer.from(fromBase64(line)));
      wake();
    },
    onStderr: (text: string) => {
      stderr += text;
      wake();
    },
  });
  let exitCode: number | null | undefined;
  const exited = proc.exited.then((code: number | null) => {
    exitCode = code;
    wake();
    return code;
  });

  const bytes = () => Buffer.concat(chunks);
  const text = () => bytes().toString("utf8");

  /** Resolves with the output so far once `done` accepts it; rejects with the output if it does not within `ms`. */
  function until(done: (output: string) => boolean, what: string, ms = 20_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (done(text())) {
          cleanup();
          resolve(text());
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timed out after ${ms} ms waiting for ${what}\noutput so far: ${JSON.stringify(text().slice(-600))}\nstderr: ${JSON.stringify(stderr)}`));
      }, ms);
      const cleanup = () => {
        clearTimeout(timer);
        waiting.delete(check);
      };
      waiting.add(check);
      check();
    });
  }

  return {
    host,
    proc,
    pid: proc.pid as number,
    bytes,
    text,
    stderr: () => stderr,
    exited,
    exitCode: () => exitCode,
    until,
    waitFor: (needle: string | RegExp, ms?: number) =>
      until((output) => (typeof needle === "string" ? output.includes(needle) : needle.test(output)), String(needle), ms),
    /** Types `text` as the plugin would send it. */
    async send(input: string) {
      for (const frame of encodeInput(input)) await proc.write(frame);
    },
    resize: (cols: number, rows: number) => proc.write(encodeResize(cols, rows)),
    /**
     * Runs a shell command and returns what it printed. One typed line, so the terminal echoes it once, before the markers it prints; the
     * output is what lies between them.
     */
    async run(command: string, ms?: number): Promise<string> {
      const id = Math.random().toString(36).slice(2, 8);
      await this.send(`echo START-${id}-$((6*7)); ${command}; echo END-${id}-$((6*7))\n`);
      const output = await this.waitFor(`END-${id}-42`, ms);
      const from = output.indexOf(`START-${id}-42`) + `START-${id}-42`.length;
      return output.slice(from, output.lastIndexOf(`END-${id}-42`)).replace(/\r/g, "").trim();
    },
  };
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function gone(pid: number, ms = 5000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await delay(50)) if (!alive(pid)) return true;
  return !alive(pid);
}
