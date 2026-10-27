# Artifacts

A sidebar page in Buzz with your saved web pages. Click one and it opens in Buzz's built-in browser, with the sign-in kept between restarts. It was made for Claude artifact links (`https://claude.ai/artifact/<id>`), and it takes any `https://` address.

No address is built in. You add, rename and remove your own in **Settings → Artifacts**.

## Needs

- **The Buzz desktop app on macOS 14 or later.** The built-in browser (`ctx.browser`) exists only in the macOS desktop app. On the web, Windows and Linux the page says so and opens nothing.
- **block/buzz-app at b86b9f3c (2026-10-23) or later**, the commit that added the `storage` option to `browser.View` (block/buzz-app #1340). The first release tag that contains it is `desktop-v0.7.0-beta.1`. On macOS earlier than 14, or on a Buzz without the option, pages still open but each open is a private session, so you sign in again every time.
- Not run in a live Buzz yet. It was written against Block's source and its unit tests; see "What was and was not checked".

## Install

1. Get the files: clone this repository.
2. In Buzz: **Settings → Plugins → Manage plugins → Add**, choose a **folder**, pick `plugins/artifacts`.
3. Review, press **Install plugin**, make sure it is enabled.

## Use

1. Open **Settings** and find the **Artifacts** card (group Plugins). Type a name (optional) and an `https://` address, press **Add**.
2. Open **Artifacts** in the sidebar. Your pages are chips along the top. Click one to open it below.
3. Sign in to the site once. The sign-in is kept under a named browser storage, `claude`, so it survives closing the page and restarting Buzz.
4. To rename or remove a page, use its row in the Settings card.

Only `https://` addresses are saved, with no user name or password in them, up to 2,048 bytes (Buzz's own limit).

## How it works

| Part | How |
| --- | --- |
| Sidebar entry | `ctx.pages.register({ id: "artifacts", primary: true, layout: "workspace", icon })` |
| Opening a page | `ctx.browser.View({ url, storage: "claude", label })` rendered inside the page. The host owns the controls, the website and the session |
| The list | `localStorage` under the plugin id, `megatech.artifacts`, as JSON. Only on this computer, never sent anywhere |
| Settings | `ctx.settingsCards.register(...)`: add, rename, remove |
| Colours | The host's tokens (`--accent-9`, `--affordance-backdrop-pressed`, `--text-standard`, `--border-focus`), each with a fallback |
| Manifest | `id`, `name`, `apiVersion`, `description`, `discovery`. No `host` block: the plugin declares no command and no network origin |

### The no-network rule

[`docs/building.md` §4](../../docs/building.md) forbids `fetch`, WebSocket and remote media from a plugin. This plugin does none of that. Opening an address in `ctx.browser.View` is the host's browser panel loading the page, not the plugin making a request: the plugin only hands the host a string, and the host's native view loads it, without Buzz's IPC bridge. So no connector exception and no `host.networkOrigins` are needed, and the manifest asks for no permission. A test checks that `plugin.js` contains no `fetch`, WebSocket, `eval` or host-command call.

### One thing to know about the sign-in

Every page opens with the same named storage, `claude`, because that is what keeps a claude.ai sign-in. Pages from other sites opened through this plugin therefore share cookies with it. Buzz keeps that storage apart from its own, but names separate storages, not plugins, and plugins run as trusted code ([`docs/building.md`](../../docs/building.md)). Save only sites you are happy to keep signed in together.

## Tests

```
node --test plugins/artifacts/test/*.test.mjs
```

Node 22 or later, no dependencies, nothing to build: `plugin.js` is the plugin. The tests cover add (and the normalized address and default name), rename, remove, rejecting anything that is not `https://` (and addresses with credentials, over-long and garbled ones), duplicates, persistence across a reload and bad stored data, change notifications, a full storage, and `apply`: it registers the sidebar page and the settings card, and renders `browser.View` with `storage: "claude"` and the chosen address.

## What was and was not checked

- Checked: the list logic and registration, in Node; the `browser.View` signature and the `storage` rules against Block's source (see [`NOTES.md`](NOTES.md)).
- Not checked: a run in the real Buzz app. Not in Buzz's browser test harness either (it has no native browser, so `browser.View` could not be exercised there). The look of the page, the click-through into a website, the sign-in surviving a restart and the macOS 14 behaviour are unverified. Whoever installs it first should do the steps under Use and report back.
