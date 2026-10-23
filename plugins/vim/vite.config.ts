// Builds src/ into the one self-contained module the host loads (API v1: no imports, no assets). This is the
// config `buzzodz plugin init` scaffolds, with two changes: the bundle is not minified (a plugin runs unsandboxed
// in the app's page, so what a user installs should be readable), and `pnpm build` copies it next to the manifest
// (scripts/ship.mjs) because the app installs from a folder or a Git URL and never runs a build.
import { defineConfig } from "vite";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig({
  publicDir: false,
  oxc: { jsx: { runtime: "classic" } },
  build: {
    minify: false,
    lib: { entry: "src/index.ts", formats: ["es"], fileName: () => "plugin.js" },
    rolldownOptions: { output: { codeSplitting: false } },
  },
  plugins: [
    {
      name: "page-contract",
      enforce: "pre",
      resolveId(id) {
        if (/^react(?:-dom)?(?:\/|$)/.test(id) || id === "@buzz/author" || id === "@deepseek-ai/cordis" || id.startsWith("@deepseek-ai/cordis/")) {
          throw new Error("Host capabilities are supplied by Buzz; use type-only imports");
        }
      },
      generateBundle(_options, bundle) {
        const outputs = Object.values(bundle);
        const page = outputs[0];
        if (outputs.length !== 1 || page?.type !== "chunk" || page.imports.length) {
          throw new Error("Page API v1 requires one self-contained JS module, without separate assets");
        }
        if (!page.exports.includes("apply")) throw new Error("Export apply(ctx)");
        this.emitFile({ type: "asset", fileName: "manifest.json", source: JSON.stringify(manifest, null, 2) });
      },
    },
  ],
});
