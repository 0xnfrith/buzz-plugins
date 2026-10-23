# MEGATECH

**[megatech.systems](https://megatech.systems)**

## Buzz plugins

Plugins for [Buzz](https://github.com/block/buzz-app), Block's open-source chat app, plus templates for making new ones fast. Buzz 1.0 has a plugin system: a plugin is a folder with a `manifest.json` and one `plugin.js`, loaded into the desktop app from a folder or a Git repository.

## What's here

```
plugins/              plugins you can install, one folder each
  vim/                vim mode for Buzz
  key-probe/          a measuring tool used by the vim tests
templates/            starting points for new plugins (source: copy out, then build)
  page-plugin/        adds a page or panel (Block's starter + our rules)
  keys-plugin/        keyboard and page behaviour, like vim (coming)
  agent-plugin/       an agent type: a minimal working example
docs/
  building.md         how we build plugins
  install.md          how to install one
```

## Plugins

| Plugin | What it does | Folder | Status |
| --- | --- | --- | --- |
| Vim mode | Move through Buzz with vim keys: normal, insert and visual modes, `j` `k` through messages and channels, `h` `l` between panes, threads, pages and communities by key, and vim editing inside the message box | [`plugins/vim`](plugins/vim) | Working concept; a refactor is coming |
| Key probe | Times every key from press to paint, for measuring other plugins. Not needed to use anything | [`plugins/key-probe`](plugins/key-probe) | Tool for the vim tests |

## Templates

Templates are source, not installable plugins: copy one out, give it its own id, and build it. See [`templates/README.md`](templates/README.md).

| Template | For | Status |
| --- | --- | --- |
| [`page-plugin`](templates/page-plugin) | A page, panel or Settings card in TypeScript and React, built to one `plugin.js` | Block's `buzzodz plugin init` starter, with our rules |
| [`keys-plugin`](templates/keys-plugin) | Keyboard and page behaviour | Coming, cut from the vim plugin after its refactor |
| [`agent-plugin`](templates/agent-plugin) | A new agent type (a "brain adapter") in the Agents harness picker | Minimal working example |

## Install a plugin

In the Buzz desktop app:

1. **Settings → Plugins → Manage plugins.**
2. Press **Add**. Load a **folder** (for example `plugins/vim` from a clone of this repository), or enter `https://github.com/0xnfrith/buzz-plugins` as the **Git or GitHub repository** and press **Find**.
3. Pick the plugin, press **Continue**, review its access, and press **Install plugin**.

Details, including updating and turning a plugin off: [`docs/install.md`](docs/install.md).

Plugins run as trusted code inside the app, not in a sandbox. Read the code before you install it; it is all plain JavaScript.

## Build a plugin

Start from a template, and follow [`docs/building.md`](docs/building.md): the plugin API first, the page DOM only where the API stops; colours from the host's theme; everything cleaned up when the plugin is updated; no network, no keys, no eval; measure before and after big changes; test against Buzz's own web build.

## Credits

Buzz is made by [Block](https://github.com/block/buzz-app). The page template's starter files are Block's, under the Apache License 2.0 (see [`templates/page-plugin`](templates/page-plugin)). Everything else here is by [0xnfrith](https://github.com/0xnfrith).
