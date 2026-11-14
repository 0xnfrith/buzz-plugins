import { defineConfig } from "vite";
import { license, inlineWasm } from "./scripts/ghostty-package.mjs";
import { GHOSTTY_WEB } from "./scripts/pins.mjs";

// Builds src/index.ts into plugin.js, next to manifest.json: the pair Buzz imports from a folder. API v1 is one self-contained module, so
// ghostty-web and its WASM are bundled in. The bundle is not minified: a plugin runs unsandboxed in the app's page, so what a person
// adds should be readable. manifest.json is written by `pnpm run manifest`, not here. A prototype's plugin.js is never committed.
// scripts/ghostty-package.mjs refuses to load if the ghostty-web on disk is not the one this was written against.

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
    inlineWasm(),
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
