import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "vite";
import { GHOSTTY_WEB, WASM_SHA256 } from "./scripts/pins.mjs";

// Builds src/index.ts into plugin.js, next to manifest.json: the pair Buzz imports from a folder. API v1 is one self-contained module, so
// ghostty-web and its WASM are bundled in. The bundle is not minified: a plugin runs unsandboxed in the app's page, so what a person
// adds should be readable. manifest.json is written by `pnpm run manifest`, not here. A prototype's plugin.js is never committed.

// ghostty-web ships its LICENSE in the package; the build reads it from there and puts it at the top of plugin.js. MIT asks for the
// notice in copies of the software, and the bundle carries the package's JavaScript and its WASM.
const packageDir = dirname(createRequire(import.meta.url).resolve("ghostty-web/ghostty-vt.wasm"));
const license = readFileSync(join(packageDir, "LICENSE"), "utf8").trim();
const manifestOf = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
if (manifestOf.name !== "ghostty-web" || manifestOf.version !== GHOSTTY_WEB) throw new Error(`Expected ghostty-web ${GHOSTTY_WEB}, found ${manifestOf.version}`);
if (manifestOf.license !== "MIT" || !/^MIT License\n\nCopyright \(c\) 2025 Coder\n/.test(license) || !license.includes("Permission is hereby granted"))
  throw new Error("The LICENSE in the ghostty-web package is not the MIT licence this build was written for: read it, then update THIRD_PARTY_NOTICES.md");
const wasmBytes = readFileSync(join(packageDir, "ghostty-vt.wasm"));
const wasm = createHash("sha256").update(wasmBytes).digest("hex");
if (wasm !== WASM_SHA256) throw new Error(`ghostty-vt.wasm is ${wasm}, not the ${WASM_SHA256} this build pins`);
const WASM_MODULE = "ghostty-web/ghostty-vt.wasm?inline";

const banner = `/*!
 * Ghostty terminal for Buzz (a prototype), Apache-2.0 like the repository it is in. This file bundles:
 *
 * ghostty-web ${GHOSTTY_WEB} (JavaScript and ghostty-vt.wasm), under the licence in its package:
 *
${license
  .split("\n")
  .map((line) => ` * ${line}`.trimEnd())
  .join("\n")}
 *
 * ghostty-vt.wasm is built from Ghostty, MIT, Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors, under the same permission
 * notice. See THIRD_PARTY_NOTICES.md for what has and has not been checked.
 */`;

export default defineConfig({
  publicDir: false,
  oxc: { jsx: { runtime: "classic" } },
  build: {
    outDir: ".",
    emptyOutDir: false,
    minify: false,
    lib: { entry: "src/index.ts", formats: ["es"], fileName: () => "plugin.js" },
    rolldownOptions: { output: { codeSplitting: false, banner } },
  },
  plugins: [
    {
      // The WASM as a data: URL string, from the file whose hash was just checked. API v1 has no way to load a second file.
      name: "inline-wasm",
      enforce: "pre",
      resolveId: (id) => (id === WASM_MODULE ? `\0${WASM_MODULE}` : null),
      load: (id) => (id === `\0${WASM_MODULE}` ? `export default ${JSON.stringify(`data:application/wasm;base64,${wasmBytes.toString("base64")}`)};` : null),
    },
    {
      // ghostty-web carries a second copy of its WASM, as a data: URL for its own loader (Ghostty.load()). This plugin never calls that
      // loader (it builds the terminal from the instance it made, src/term.ts), so the copy is only 564 KB of text. It is removed, and the
      // build fails if ghostty-web stops having exactly one: that is the sign to look again.
      name: "drop-unused-wasm-copy",
      transform(code, id) {
        if (!/[\\/]ghostty-web[\\/]dist[\\/]ghostty-web\.js$/.test(id.split("?")[0])) return null;
        const copy = /data:application\/wasm;base64,[A-Za-z0-9+/=]+/g;
        const copies = code.match(copy) ?? [];
        if (copies.length !== 1) throw new Error(`Expected one embedded WASM in ghostty-web.js, found ${copies.length}`);
        return { code: code.replace(copy, "data:application/wasm;base64,"), map: null };
      },
    },
    {
      name: "plugin-contract",
      enforce: "pre",
      resolveId(id) {
        // Buzz supplies React and its own services; a plugin cannot import them.
        if (/^react(?:-dom)?(?:\/|$)/.test(id) || id === "@buzz/author" || id.startsWith("@deepseek-ai/cordis"))
          throw new Error("Host capabilities are supplied by Buzz; use type-only imports");
        return null;
      },
      generateBundle(_options, bundle) {
        const outputs = Object.values(bundle);
        const entry = outputs[0];
        if (outputs.length !== 1 || entry?.type !== "chunk" || entry.imports.length)
          throw new Error("A plugin is one self-contained JS module, without separate assets");
        if (!entry.exports.includes("apply") || !entry.exports.includes("inject")) throw new Error("Export inject and apply(ctx)");
      },
    },
  ],
});
