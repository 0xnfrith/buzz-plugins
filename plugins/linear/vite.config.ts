import { defineConfig } from "vite";

// Builds src/index.tsx into plugin.js, next to manifest.json: the pair Buzz imports. The
// manifest is written by hand and committed; this only produces plugin.js.
export default defineConfig({
  publicDir: false,
  oxc: { jsx: { runtime: "classic" } },
  build: {
    outDir: ".",
    emptyOutDir: false,
    minify: false,
    lib: { entry: "src/index.tsx", formats: ["es"], fileName: () => "plugin.js" },
    rolldownOptions: { output: { codeSplitting: false } },
  },
  plugins: [
    {
      name: "plugin-contract",
      enforce: "pre",
      resolveId(id) {
        // Buzz supplies React and its own services; a plugin cannot import them.
        if (/^react(?:-dom)?(?:\/|$)/.test(id) || id.startsWith("@deepseek-ai/cordis"))
          throw new Error("Host capabilities are supplied by Buzz; use type-only imports");
        return null;
      },
      generateBundle(_options, bundle) {
        const outputs = Object.values(bundle);
        const entry = outputs[0];
        if (outputs.length !== 1 || entry?.type !== "chunk" || entry.imports.length)
          throw new Error("A plugin is one self-contained JS module, without separate assets");
        if (!entry.exports.includes("apply") || !entry.exports.includes("inject"))
          throw new Error("Export inject and apply(ctx)");
      },
    },
  ],
});
