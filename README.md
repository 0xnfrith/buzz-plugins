# MEGATECH

**[megatech.systems](https://megatech.systems)**

## Buzz plugins

Plugins for [Buzz](https://github.com/block/buzz-app), Block's open-source chat app. Buzz 1.0 has a plugin system: a plugin is a folder with a `manifest.json` and one `plugin.js`, loaded into the desktop app from a folder or a Git repository.

## What's here

```
plugins/              plugins you can install, one folder each
  vim/                vim mode for Buzz
  linear/             your Linear board inside Buzz
  key-probe/          a measuring tool used by the vim tests
docs/
  building.md         how we build plugins
  install.md          how to install one
```

## Plugins

| Plugin | What it does | Folder | Status |
| --- | --- | --- | --- |
| Vim mode | Move through Buzz with vim keys: normal, insert and visual modes, `j` `k` through messages and channels, `h` `l` between panes, threads, pages and communities by key, and vim editing inside the message box | [`plugins/vim`](plugins/vim) | Working concept; a refactor is coming |
| Linear | Your Linear board inside Buzz: a column for each workflow state, in Linear's order, with cards like Linear's own. Drag a card to another column to change its state; click one for details and an Open in Linear link. Each person pastes their own personal API key | [`plugins/linear`](plugins/linear) | Built and tested against a fake Linear; not yet run against a real workspace |
| Key probe | Times every key from press to paint, for measuring other plugins. Not needed to use anything | [`plugins/key-probe`](plugins/key-probe) | Tool for the vim tests |

## Install a plugin

In the Buzz desktop app:

1. **Settings → Plugins → Manage plugins.**
2. Press **Add**. Load a **folder** (for example `plugins/vim` from a clone of this repository), or enter `https://github.com/0xnfrith/buzz-plugins` as the **Git or GitHub repository** and press **Find**.
3. Pick the plugin, press **Continue**, review its access, and press **Install plugin**.

Details, including updating and turning a plugin off: [`docs/install.md`](docs/install.md).

Plugins run as trusted code inside the app, not in a sandbox. Read the code before you install it; it is all plain JavaScript.

## Build a plugin

Start from Block's own starter (`buzzodz plugin init`, see [Block's plugin docs](https://github.com/block/buzz-app/blob/main/docs/plugin-architecture.md)), and follow [`docs/building.md`](docs/building.md): the plugin API first, the page DOM only where the API stops; colours from the host's theme; everything cleaned up when the plugin is updated; no network, no keys and no eval, except a connector to one declared service with the user's own key; measure before and after big changes; test against Buzz's own web build.

## Credits

Buzz is made by [Block](https://github.com/block/buzz-app). Everything here is by [0xnfrith](https://github.com/0xnfrith).

## License

Apache License 2.0, the same license as Buzz. See [`LICENSE`](LICENSE).
