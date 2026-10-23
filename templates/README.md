# Templates

Starting points for new Buzz plugins. They are **source, not installable plugins**: none of them ships a built `plugin.js` beside its `manifest.json`, so Buzz's Git import never offers one for install. Only the folders under [`plugins/`](../plugins) are installable.

To use a template, copy its folder out (into `plugins/<your-plugin>/` here, or a repository of your own), give it its own id, and build it:

| Template | What you start with | To get a `plugin.js` |
| --- | --- | --- |
| [`page-plugin`](page-plugin) | Block's `buzzodz plugin init` starter: TypeScript and React | `pnpm build` writes `dist/manifest.json` and `dist/plugin.js` |
| [`agent-plugin`](agent-plugin) | A minimal working agent type, already plain JavaScript | Rename `plugin.example.js` to `plugin.js` |
| [`keys-plugin`](keys-plugin) | Coming, cut from the vim plugin after its refactor | |

Then follow [`docs/building.md`](../docs/building.md), and install it as in [`docs/install.md`](../docs/install.md).

When you browse this repository with Buzz's Git import, the page and agent templates appear under "Folders skipped" (each has a `manifest.json` and no built `plugin.js`). That is expected.
