# MEGATECH

**[megatech.systems](https://megatech.systems)**

## Buzz plugins

Plugins for [Buzz](https://github.com/block/buzz-app), Block's open-source chat app. Buzz 1.0 has a plugin system: a plugin is a folder with a `manifest.json` and one `plugin.js`, loaded into the desktop app from a folder or a Git repository.

## What's here

```
plugins/              plugins you can install, one folder each
  vim/                vim mode for Buzz
  beeper/             your Beeper inbox inside Buzz
  artifacts/          your saved web pages in a sidebar page, opened in Buzz's browser
  key-probe/          a measuring tool used by the vim tests
docs/
  building.md         how we build plugins
  install.md          how to install one
.github/workflows/    the checks every pull request runs
CONTRIBUTING.md       how to send a change (and the key-latency rule for vim mode)
```

## Plugins

| Plugin | What it does | Folder | Status |
| --- | --- | --- | --- |
| Vim mode | Move through Buzz with vim keys: normal, insert and visual modes, `j` `k` through messages and channels, `h` `l` between panes, threads, pages and communities by key, and vim editing inside the message box | [`plugins/vim`](plugins/vim) | Working concept |
| Beeper | Your Beeper chats inside Buzz: a list of chats with network, unread count and time, a chat with its recent messages, and a reply box, read and sent through Beeper Desktop's local API on the same computer. Each person pastes their own access token | [`plugins/beeper`](plugins/beeper) | Built and tested against a fake Beeper; not yet run against a real one |
| Artifacts | A sidebar page with your saved web pages (for example Claude artifact links), opened in Buzz's built-in browser with the sign-in kept between restarts. You add, rename and remove the links in Settings; no address is built in. Needs the macOS desktop app, macOS 14 or later | [`plugins/artifacts`](plugins/artifacts) | Prototype; unit-tested, not yet run in a live Buzz |
| Key probe | Times every key from press to paint, for measuring other plugins. Not needed to use anything | [`plugins/key-probe`](plugins/key-probe) | Tool for the vim tests |

## Install a plugin

In the Buzz desktop app:

1. **Settings → Plugins → Manage plugins.**
2. Press **Add**. Load a **folder** (for example `plugins/vim` from a clone of this repository), or enter `https://github.com/0xnfrith/buzz-plugins` as the **Git or GitHub repository** and press **Find**.
3. Pick the plugin, press **Continue**, review its access, and press **Install plugin**.

Details, including updating and turning a plugin off: [`docs/install.md`](docs/install.md).

Plugins run as trusted code inside the app, not in a sandbox. Read the code before you install it; it is all plain JavaScript.

## Build a plugin

Start from Block's own starter (`buzzodz plugin init`, see [Block's plugin docs](https://github.com/block/buzz-app/blob/main/docs/plugin-architecture.md)), and follow [`docs/building.md`](docs/building.md): the plugin API first, the page DOM only where the API stops; colours from the host's theme; everything cleaned up when the plugin is updated; no network, no keys and no eval, except a connector to one declared service with the user's own credential; measure before and after big changes; test against Buzz's own web build.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). One rule worth knowing first: a change to a key of vim mode must add the key to the latency suite, which fails a pull request whose p99 key-to-paint time is over 50 ms.

## Credits

Buzz is made by [Block](https://github.com/block/buzz-app). Everything here is by [0xnfrith](https://github.com/0xnfrith).

## License

Apache License 2.0, the same license as Buzz. See [`LICENSE`](LICENSE).
