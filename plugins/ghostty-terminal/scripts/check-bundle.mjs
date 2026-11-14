// Holds the built plugin.js to what the plan says it is. Run by `pnpm run build` after vite, and by the unit tests on made-up inputs so
// that each rule is known to be able to fail. Prints each problem and exits 1 if there is one.
//
//  - It carries no way into Buzz's own terminal. The webview lets any script in it call the app's private `terminal_*` commands (a shell
//    that no install review lists), and a plugin's only supported way to a process is a declared one, so the bundle must not name them or
//    reach for Tauri's IPC at all.
//  - It carries the MIT notice for what it bundles, and exactly the WASM the build pins.
//  - It is one module that exports `inject` and `apply`, and fits Buzz's 8 MiB limit for a plugin file.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GHOSTTY_WEB, WASM_SHA256 } from "./pins.mjs";

export const LIMIT_BYTES = 8 * 1024 * 1024; // crates/plugin-manager/src/lib.rs LIMIT in block/buzz-app

/**
 * The app's own terminal commands, as a quoted string (the only way to call one: invoke("terminal_spawn", ...)). Not a bare substring:
 * ghostty-web's own WASM exports are called ghostty_terminal_write, ghostty_terminal_resize and so on.
 */
export const PRIVATE_COMMANDS = /["'`]terminal_(create_owner|spawn|read|write|resize|close|close_owner)["'`]/;
/** Tauri's IPC and the origin Buzz's content security policy allows it on, none of which this plugin may use. */
export const FORBIDDEN = ["__TAURI", "@tauri-apps", "ipc.localhost"];
/**
 * Dynamic code: ghostty-web has none, and a plugin that gained some would be reading its own input as code.
 * Safe: these are patterns searched for in the bundle's text; nothing in this script evaluates anything.
 */
const DYNAMIC = [/\beval\s*\(/, /\bnew\s+Function\s*\(/];

export function problemsOf(source) {
  const problems = [];
  const bytes = Buffer.byteLength(source);
  if (bytes > LIMIT_BYTES) problems.push(`plugin.js is ${bytes} bytes, over Buzz's ${LIMIT_BYTES}`);
  const command = PRIVATE_COMMANDS.exec(source);
  if (command) problems.push(`plugin.js names ${command[0]}: the app's own terminal, which no install review lists`);
  for (const name of FORBIDDEN) if (source.includes(name)) problems.push(`plugin.js contains "${name}": a way into the app's own IPC`);
  for (const pattern of DYNAMIC) if (pattern.test(source)) problems.push(`plugin.js contains dynamic code (${pattern})`);
  if (!/^\/\*!\n\s*\* Ghostty terminal for Buzz/.test(source)) problems.push("plugin.js does not start with the notice banner");
  if (!source.includes("MIT License") || !source.includes("Copyright (c) 2025 Coder") || !source.includes(`ghostty-web ${GHOSTTY_WEB}`))
    problems.push("plugin.js does not carry ghostty-web's MIT notice");
  if (!source.includes("Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors")) problems.push("plugin.js does not carry Ghostty's copyright line");
  const payloads = [...source.matchAll(/data:application\/wasm;base64,([A-Za-z0-9+/=]+)/g)];
  if (payloads.length !== 1) problems.push(`plugin.js holds ${payloads.length} WASM payloads, not 1`);
  else if (createHash("sha256").update(Buffer.from(payloads[0][1], "base64")).digest("hex") !== WASM_SHA256) problems.push("the WASM in plugin.js is not the pinned one");
  const exported = (name) => new RegExp(`\\bexport\\s*\\{[^}]*\\b${name}\\b[^}]*\\}|\\bexport\\s+(async\\s+)?(function|const)\\s+${name}\\b`).test(source);
  if (!exported("apply")) problems.push("plugin.js does not export apply");
  if (!exported("inject")) problems.push("plugin.js does not export inject");
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const path = fileURLToPath(new URL("../plugin.js", import.meta.url));
  const source = readFileSync(path, "utf8");
  const problems = problemsOf(source);
  for (const problem of problems) console.error(`::error::${problem}`);
  if (problems.length) process.exit(1);
  console.log(`plugin.js: ${Buffer.byteLength(source)} bytes, checked`);
}
