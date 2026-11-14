import { defineConfig } from "vitest/config";
import { inlineWasm } from "./scripts/ghostty-package.mjs";

export default defineConfig({
  // src/term.ts imports the WASM as a data: URL, as the build does.
  plugins: [inlineWasm()],
  test: {
    include: ["test/unit/**/*.test.ts"],
    // A test that starts a shell waits for real processes: give it room, and keep them from running side by side.
    testTimeout: 60_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
