// Stands in for Buzz's `host.runCommand`: runs the program a manifest declares, with the
// arguments the manifest fixes, the caller's stdin, no shell, a deadline and an output
// limit; any failure is `null`. It follows src-tauri/src/host_command.rs in block/buzz-app
// (read at f4e95770), so the plugin is tested against the real curl, not a stub of it.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

export function declaredCommands() {
  return manifest.host.commands;
}

export function runCommand(id, input, { deadlineMs = 5000 } = {}) {
  const command = manifest.host.commands.find((candidate) => candidate.id === id);
  if (!command) return Promise.resolve(null);
  const limitIn = command.maxInputBytes;
  if (input !== undefined && (limitIn === undefined || Buffer.byteLength(input) > limitIn)) return Promise.resolve(null);
  const limitOut = command.maxOutputBytes ?? 4096;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child;
    try {
      child = spawn(command.program, command.args ?? [], { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"], detached: false });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, deadlineMs);
    const chunks = [];
    let size = 0;
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitOut) {
        child.kill("SIGKILL");
        finish(null);
      } else chunks.push(chunk);
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      if (code !== 0) return finish(null);
      try {
        finish(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        finish(null);
      }
    });
    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}
