import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { inlineWasm } from "../../scripts/ghostty-package.mjs";

// The bench page: this plugin's terminal and xterm side by side. Built to test/bench/dist (not committed) and opened by run.mjs.
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  base: "./",
  plugins: [inlineWasm()],
  build: { outDir: "dist", emptyOutDir: true, minify: false },
});
