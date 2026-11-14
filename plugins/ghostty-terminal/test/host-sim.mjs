// Stands in for Buzz's `ctx.host.spawn`, which the web build does not have ("Processes require an installed desktop plugin"). It starts
// the real process the manifest declares, on this machine, and gives it what the desktop host gives a plugin's process. It follows
// block/buzz-app at v1.0.2 (51d63954), and each rule below names the file it comes from:
//   src/features/host/service.ts     spawn(): the returned { write, end, kill, exited }; a write goes out in pieces of 256 Ki UTF-16 units
//   src-tauri/src/host_process.rs     the declared process only; its arguments, then the caller's (at most 256); piped stdin, stdout and
//                                     stderr; its own process group; stdout and stderr as lossy UTF-8; the environment of set_environment();
//                                     SIGTERM to the group, SIGKILL 3 s later; the group is killed once the process has exited
//   crates/plugin-manager/src/lib.rs  valid_program(): a bare program name of at most 80 bytes, at most 16 arguments of at most 1024 bytes
// It does not model the Tauri channel, so the speed of the real transport is not measured here.
import { spawn as startProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const WRITE_UNITS = 256 * 1024; // service.ts
export const STOP_GRACE_MS = 3000; // host_process.rs STOP_GRACE
const MAX_PROCESSES = 64; // host_process.rs
const MAX_CALLER_ARGS = 256; // host_process.rs
/** Options of the real `spawn` that this plugin must not use: each hands the process something beyond a plain shell. */
const REFUSED_OPTIONS = ["mcp", "protection", "agentCredential", "protectedAgent", "secrets"];

const bytes = (text) => new TextEncoder().encode(text).length;

/** The problems with a manifest's `host.processes`, by Buzz's rules (lib.rs valid_program, and at most 16 processes). */
export function processProblems(manifest) {
  const problems = [];
  const processes = manifest.host?.processes ?? [];
  if (processes.length > 16) problems.push("more than 16 processes");
  for (const process of processes) {
    const { id, program, args = [], ...rest } = process;
    for (const key of Object.keys(rest)) if (!["bundled", "artifact"].includes(key)) problems.push(`process ${id}: unknown key ${key}`);
    if (!program || bytes(program) > 80 || !/^[A-Za-z0-9._-]+$/.test(program)) problems.push(`process ${id}: program must be a bare name of 1-80 bytes of [A-Za-z0-9._-]`);
    if (args.length > 16) problems.push(`process ${id}: more than 16 arguments`);
    args.forEach((argument, at) => {
      if (bytes(argument) > 1024) problems.push(`process ${id}: argument ${at + 1} is ${bytes(argument)} bytes, over 1024`);
      if (argument.includes("\0")) problems.push(`process ${id}: argument ${at + 1} has a NUL`);
    });
  }
  return problems;
}

/** A splitter that cuts every read of output at pseudo-random offsets (down to a single byte), as the host's reads can end anywhere. */
export function randomSplit(seed = 1, max = 997) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (chunk) => {
    const pieces = [];
    for (let at = 0; at < chunk.length; ) {
      const size = 1 + Math.floor(next() * max);
      pieces.push(chunk.subarray(at, at + size));
      at += size;
    }
    return pieces;
  };
}

/**
 * @param manifest the plugin's manifest.json, parsed
 * @param options  env: the app's own environment; version: what the app reports as BUZZ_VERSION; home: what "~" means;
 *                 split(buffer) => buffers: how a read of output is cut
 */
export function createHost(manifest, { env = process.env, version = "1.0.2", home = homedir(), split = (chunk) => [chunk] } = {}) {
  const problems = processProblems(manifest);
  if (problems.length) throw new Error(`The manifest would be refused by Buzz: ${problems.join("; ")}`);
  const live = new Set();
  /** What each spawn() was given, and the environment the process was started with. */
  const calls = [];

  async function spawn(id, options = {}) {
    const { args = [], cwd, env: added = {}, onStdout, onStderr, ...unknown } = options;
    for (const key of Object.keys(unknown)) {
      throw new Error(REFUSED_OPTIONS.includes(key) ? `fixture: this plugin must not pass ${key} to spawn` : `fixture: unknown spawn option ${key}`);
    }
    const declared = manifest.host?.processes?.find((process) => process.id === id);
    if (!declared) throw new Error("Process is not declared");
    if (args.length > MAX_CALLER_ARGS || args.some((argument) => argument.includes("\0"))) throw new Error("Invalid process arguments");
    if (live.size >= MAX_PROCESSES) throw new Error("Too many processes");

    // set_environment(): the app's own environment less BUZZ_* and NOSTR_*, then the plugin's, then BUZZ_VERSION.
    const environment = {};
    for (const [name, value] of Object.entries(env)) if (!name.startsWith("BUZZ_") && !name.startsWith("NOSTR_")) environment[name] = value;
    for (const [name, value] of Object.entries(added)) {
      if (!name || name.includes("=") || name.includes("\0")) throw new Error("Invalid environment variable");
      if (value === null) delete environment[name];
      else environment[name] = value;
    }
    environment.BUZZ_VERSION = version;

    const directory = cwd === undefined ? undefined : cwd === "~" ? home : cwd.startsWith("~/") ? join(home, cwd.slice(2)) : cwd;
    if (directory) mkdirSync(directory, { recursive: true });

    const child = startProcess(declared.program, [...(declared.args ?? []), ...args], {
      env: environment,
      cwd: directory,
      detached: true, // its own process group, so the whole group can be signalled
      stdio: ["pipe", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    calls.push({ id, args, cwd: directory, added, environment: { ...environment } });

    let exit;
    const exited = new Promise((resolve) => {
      exit = resolve;
    });
    // host_process.rs: the process's exit is what is waited for, not its pipes. The group is killed at once ("descendants that outlived it
    // go with it"), the readers then drain what is left, and only then is the exit reported, so output always comes before it.
    child.once("exit", () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    });
    child.once("close", (code) => {
      live.delete(handle);
      exit(code);
    });
    child.stdin.on("error", () => {});

    // Output is text, decoded as UTF-8 with U+FFFD for bad bytes; a character cut by a read waits for the rest (take_text()).
    const forward = (stream, callback) => {
      const decoder = new TextDecoder("utf-8");
      stream.on("data", (chunk) => {
        for (const piece of split(chunk)) {
          const text = decoder.decode(piece, { stream: true });
          if (text) callback?.(text);
        }
      });
    };
    forward(child.stdout, onStdout);
    forward(child.stderr, onStderr);

    // A write goes out in pieces of WRITE_UNITS UTF-16 units, never cutting a surrogate pair, one after another.
    let queue = Promise.resolve();
    const writePieces = async (data, close) => {
      let at = 0;
      do {
        let end = Math.min(data.length, at + WRITE_UNITS);
        if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1] ?? "")) end--;
        const piece = data.slice(at, end);
        if (piece) await new Promise((resolve, reject) => child.stdin.write(piece, (error) => (error ? reject(error) : resolve())));
        at = end;
      } while (at < data.length);
      if (close) child.stdin.end();
    };
    const enqueue = (work) => {
      const done = queue.then(work);
      queue = done.catch(() => {});
      return done;
    };

    let killing;
    const kill = () => {
      if (!killing) {
        killing = (async () => {
          const signalGroup = (signal) => {
            try {
              process.kill(-child.pid, signal);
            } catch {
              // already gone
            }
          };
          signalGroup("SIGTERM");
          const timer = setTimeout(() => signalGroup("SIGKILL"), STOP_GRACE_MS);
          await exited;
          clearTimeout(timer);
        })();
      }
      return killing;
    };

    const handle = Object.freeze({
      pid: child.pid,
      write: (data) => enqueue(() => writePieces(data, false)),
      end: (data = "") => enqueue(() => writePieces(data, true)),
      kill,
      exited,
    });
    live.add(handle);
    return handle;
  }

  return {
    spawn,
    calls,
    live: () => live.size,
    /** Stops everything still running; a test that leaves a process behind fails in its own afterEach. */
    async stopAll() {
      await Promise.all([...live].map((handle) => handle.kill()));
    },
  };
}
