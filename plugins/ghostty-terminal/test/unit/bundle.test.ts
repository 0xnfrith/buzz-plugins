import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { LIMIT_BYTES, problemsOf } from "../../scripts/check-bundle.mjs";
import { GHOSTTY_WEB } from "../../scripts/pins.mjs";

const wasm = readFileSync(createRequire(import.meta.url).resolve("ghostty-web/ghostty-vt.wasm")).toString("base64");

/** A bundle that passes every rule, small enough to edit: the banner, the pinned WASM once, and the two exports. */
const good = `/*!
* Ghostty terminal for Buzz (a prototype), Apache-2.0 like the repository it is in. This file bundles:
* ghostty-web ${GHOSTTY_WEB} (JavaScript and ghostty-vt.wasm), under the licence in its package:
* MIT License
* Copyright (c) 2025 Coder
* ghostty-vt.wasm is built from Ghostty, MIT, Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors
*/
const bytes = "data:application/wasm;base64,${wasm}";
const inject = ["react"];
function apply(ctx) {}
export { apply, inject };
`;

describe("check-bundle", () => {
  it("accepts a bundle with the notice, the pinned WASM once, and inject and apply", () => {
    expect(problemsOf(good)).toEqual([]);
  });

  it("refuses a way into the app's own terminal, however it is quoted", () => {
    for (const call of ['invoke("terminal_spawn", {})', "invoke('terminal_read', {})", "invoke(`terminal_create_owner`)", 'cmd = "terminal_close_owner"']) {
      expect(problemsOf(`${good}${call};\n`), call).toEqual([expect.stringMatching(/app's own terminal/)]);
    }
  });

  it("does not mistake ghostty-web's own WASM exports for it", () => {
    const own = "exports.ghostty_terminal_write(); exports.ghostty_terminal_resize(); exports.ghostty_terminal_read();";
    expect(problemsOf(`${good}${own}\n`)).toEqual([]);
  });

  it("refuses Tauri's IPC", () => {
    for (const reach of ["window.__TAURI_INTERNALS__.invoke", 'import("@tauri-apps/api/core")', 'fetch("http://ipc.localhost/x")']) {
      expect(problemsOf(`${good}${reach};\n`), reach).toEqual([expect.stringMatching(/app's own IPC/)]);
    }
  });

  it("refuses dynamic code", () => {
    // Safe: these strings are fed to the check as text; this test evaluates nothing.
    expect(problemsOf(`${good}eval("1");\n`)).toHaveLength(1);
    expect(problemsOf(`${good}new Function("return 1");\n`)).toHaveLength(1);
  });

  it("refuses a missing banner, a missing Ghostty copyright line, a missing or doubled or changed WASM", () => {
    expect(problemsOf(good.replace("/*!", "/*"))).toEqual([expect.stringMatching(/banner/)]);
    expect(problemsOf(good.replace("Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors", ""))).toEqual([expect.stringMatching(/Ghostty's copyright/)]);
    expect(problemsOf(good.replace("Copyright (c) 2025 Coder", ""))).toEqual([expect.stringMatching(/MIT notice/)]);
    expect(problemsOf(good.replace(/data:application\/wasm;base64,[A-Za-z0-9+/=]+/, "data:,"))).toEqual([expect.stringMatching(/0 WASM payloads/)]);
    expect(problemsOf(`${good}const again = "data:application/wasm;base64,${wasm}";\n`)).toEqual([expect.stringMatching(/2 WASM payloads/)]);
    const changed = Buffer.from(wasm, "base64");
    changed[100] ^= 1;
    expect(problemsOf(good.replace(wasm, changed.toString("base64")))).toEqual([expect.stringMatching(/not the pinned one/)]);
  });

  it("refuses a bundle without apply or inject, or over Buzz's 8 MiB limit", () => {
    expect(problemsOf(good.replace("function apply(ctx) {}\nexport { apply, inject };", "export {};"))).toEqual([
      expect.stringMatching(/export apply/),
      expect.stringMatching(/export inject/),
    ]);
    expect(problemsOf(good.replace(/inject/g, "x").replace("export { apply, x }", "export { apply }"))).toEqual([expect.stringMatching(/inject/)]);
    expect(problemsOf(good + "x".repeat(LIMIT_BYTES))).toEqual([expect.stringMatching(/over Buzz's/)]);
  });
});

describe("the built plugin.js", () => {
  // Present after `pnpm run build`, which CI runs first; not committed, because a prototype is never offered for install.
  const built = new URL("../../plugin.js", import.meta.url);
  it.skipIf(!existsSync(built))("passes the same rules", () => {
    expect(problemsOf(readFileSync(built, "utf8"))).toEqual([]);
  });
});
