# Page plugin template

A starting point for a plugin that adds a page (or, with the same setup, a panel or a Settings card) to Buzz.

## Where these files come from

`manifest.json`, `package.json`, `tsconfig.json`, `src/index.tsx`, `vite.config.ts` and `.gitignore` are what Block's `buzzodz plugin init DIR example.page "My page"` writes (`crates/plugin-manager/src/main.rs`, `fn init`, in [block/buzz-app](https://github.com/block/buzz-app) at commit `c2210b45`). They are copied unchanged, except that the JSON files are pretty-printed with a trailing newline. That code is © Block, Inc., licensed under the Apache License 2.0; a copy of the license is in [`LICENSE-APACHE-2.0`](LICENSE-APACHE-2.0). This README is ours.

## Use it

1. Copy this folder and rename it.
2. Change `id` and `name` in `manifest.json`, and `name` in `package.json`. An id is lowercase letters, digits, dots and hyphens, and starts with a letter.
3. Get the type-only author package. `@buzz/author` is **not on npm**: it is built from a block/buzz-app checkout and installed from the packed file:

   ```sh
   # in a block/buzz-app checkout
   pnpm author:build
   (cd dist-author && pnpm pack --pack-destination ..)
   # in your plugin folder
   pnpm add -D /path/to/buzz-app/buzz-author-0.0.0-preview.1.tgz
   ```

   Without it, `tsc` fails on `import type { Context } from '@buzz/author'`.
4. `pnpm install`, then `pnpm build` (or `buzzodz plugin build .`). It type-checks and writes `dist/manifest.json` and `dist/plugin.js`, one self-contained module.
5. Load `dist/` in Buzz: see [`docs/install.md`](../../docs/install.md).

Buzz never builds a plugin. A Git import only finds folders that already hold a built `manifest.json` and `plugin.js`, so commit `dist/` (remove it from `.gitignore`) if people should install from the repository.

## Our rules on top of Block's

The full list is [`docs/building.md`](../../docs/building.md). The ones that bite first in a page plugin:

- **Plugin API first.** Use `ctx.pages`, `ctx.panels`, `ctx.navigation`, `ctx.relay` and the `conversation` components before touching the host's markup. Reach into the page DOM only where the API stops, and say so in a comment.
- **Imports are type-only.** React and Cordis come from the host (`ctx.react`); the build rejects runtime imports of them. One JS module, no separate CSS or assets: use inline styles or host classes such as `ui-card`.
- **Colours come from the host's theme tokens** (`var(--accent-9)`, `var(--surface-popover)`, `var(--text-standard)`), so the page follows Settings → Appearance.
- **Everything the plugin starts outside React is cleaned up in `ctx.effect(() => cleanup)`**, so Update disposes the old revision completely. React effects clean up with the page.
- **No network, no keys, no `eval`.**
- **Measure** speed and memory before and after a big change.
