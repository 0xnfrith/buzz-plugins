// The fake's memory between two commands: one folder (FAKE_DOCKER_STATE) holding state.json (what docker would know: images, volumes,
// containers), calls.jsonl (one line per command the fake was run with) and scenario.json (written by the test). Commands run side by
// side (the plugin polls the status while it runs another command), so every change to state.json happens under a lock, and the file is
// replaced whole (written next to it, then renamed), so a reader never sees half of it.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A pause that blocks this process without spinning, on every platform node runs on.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export const emptyState = () => ({ counter: 0, images: {}, volumes: {}, containers: {} });

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 5_000; // a lock older than this belongs to a process that was killed while it held it

function lock(dir) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "lock");
  const give = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(path);
      return path;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) rmSync(path, { recursive: true, force: true });
      } catch {
        // the lock went away between the two calls: try again
      }
      if (Date.now() > give) throw new Error("the fake's state folder is locked by another command");
      sleep(5);
    }
  }
}

function locked(dir, work) {
  const path = lock(dir);
  try {
    return work();
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
}

function replace(dir, name, text) {
  const temporary = join(dir, `${name}.${process.pid}.tmp`);
  writeFileSync(temporary, text);
  renameSync(temporary, join(dir, name));
}

export function readState(dir) {
  const file = join(dir, "state.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : emptyState();
}

/**
 * Runs `change(state)` on the stored state and stores the result. Nothing is stored when `change` throws, so a command that refuses
 * does so before it changes anything. Returns what `change` returns.
 */
export function withState(dir, change) {
  return locked(dir, () => {
    const state = readState(dir);
    const result = change(state);
    replace(dir, "state.json", JSON.stringify(state, null, 2));
    return result;
  });
}

const callsFile = (dir) => join(dir, "calls.jsonl");
const lines = (dir) => (existsSync(callsFile(dir)) ? readFileSync(callsFile(dir), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);

/** Adds a record to calls.jsonl when a command starts (so a command that never ends is there too). Returns its number. */
export function startCall(dir, record) {
  return locked(dir, () => {
    const calls = lines(dir);
    const n = calls.length + 1;
    calls.push({ n, ...record });
    replace(dir, "calls.jsonl", calls.map((call) => JSON.stringify(call)).join("\n") + "\n");
    return n;
  });
}

/** Adds what is known when the command ends (its exit code, what it read) to its record. */
export function finishCall(dir, n, more) {
  locked(dir, () => {
    const calls = lines(dir);
    const call = calls.find((candidate) => candidate.n === n);
    if (call) Object.assign(call, more);
    replace(dir, "calls.jsonl", calls.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  });
}

export const readCalls = (dir) => lines(dir);
