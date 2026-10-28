# Artifacts

A sidebar page in Buzz with your saved web pages. Click one and it opens in Buzz's built-in browser, with the sign-in kept between restarts. It was made for Claude artifact links (`https://claude.ai/artifact/<id>`), and it takes any `https://` address.

No address is built in. You add, rename and remove your own in **Settings → Artifacts**.

## Needs

- **The Buzz desktop app on macOS 14 or later.** The built-in browser (`ctx.browser`) exists only in the macOS desktop app. On the web, Windows and Linux the page says so and opens nothing.
- **block/buzz-app at b86b9f3c (2026-10-23) or later**, the commit that added the `storage` option to `browser.View` (block/buzz-app #1340). The first release tag that contains it is `desktop-v0.7.0-beta.1`. On macOS earlier than 14, or on a Buzz without the option, pages still open but each open is a private session, so you sign in again every time.
- The page and the settings card have run in the Buzz 1.0 Linux app; the browser itself has not run anywhere yet. See "What was and was not checked".

## Install

1. Get the files: clone this repository.
2. In Buzz: **Settings → Plugins → Manage plugins → Add**, choose a **folder**, pick `plugins/artifacts`.
3. Review, press **Install plugin**, make sure it is enabled.

## Use

1. Open **Settings** and find the **Artifacts** card (group Plugins). Type a name (optional) and an `https://` address, press **Add**. The first page you add is your **default**.
2. Open **Artifacts** in the sidebar. It opens on the default page at once, with no click. Your pages are chips along the top, the default one marked with a star (its accessible name ends in "(default)"). Click another chip to look at that page instead.
3. Sign in to the site once. The sign-in is kept under a named browser storage, `claude`, so it survives closing the page and restarting Buzz.
4. To change the default, either press **Make default** on a row in the Settings card (the current default shows "★ Default"), or open the page you want in Artifacts and press **Make default** at the right of the chip bar (it appears only while you are looking at a page that is not the default).
5. To rename or remove a page, use its row in the Settings card. If you remove the default, the first page left becomes the default; with no pages left, the page shows its empty message again.

A page you chose by hand stays open until you leave the Artifacts page; opening it again goes back to the default.

Only `https://` addresses are saved, with no user name or password in them, up to 2,048 bytes (Buzz's own limit).

## How it works

| Part | How |
| --- | --- |
| Sidebar entry | `ctx.pages.register({ id: "artifacts", primary: true, layout: "workspace", icon })` |
| Opening a page | `ctx.browser.View({ url, storage: "claude", label })` rendered inside the page. The host owns the controls, the website and the session |
| The list | `localStorage` under the plugin id, `megatech.artifacts`, as JSON. Only on this computer, never sent anywhere |
| The default | The id of the default page, as plain text in `localStorage` under `megatech.artifacts.default`, beside the list. The list keeps its old format, so a list saved before defaults existed reads unchanged and its first page is the default. A saved id that matches no page (stale or hand-edited) also falls back to the first page. The first page added becomes the default; removing the default moves it to the first page left; no pages, no default |
| Opening the page | The page renders the default page's `browser.View` on its first render. Clicking a chip shows that page until you leave the page. If the page you are on is removed, it falls back to the default |
| Settings | `ctx.settingsCards.register(...)`: add, rename, remove, make default |
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

Node 22 or later, no dependencies, nothing to build: `plugin.js` is the plugin. The tests cover add (and the normalized address and default name), rename, remove, rejecting anything that is not `https://` (and addresses with credentials, over-long and garbled ones), duplicates, persistence across a reload and bad stored data, change notifications, a full storage, the default (the first page added, `setDefault` and an unknown id, removing the default, a list saved before defaults existed, a stale or garbage saved id, persistence across a reload, notifications) and `apply`: it registers the sidebar page and the settings card, renders `browser.View` with `storage: "claude"` and the chosen address, opens on the default's address on the first render with no click, marks the default chip and the default row, and changes the default from the bar and from the row.

## What was and was not checked

- Checked, in Node: the list and default logic, and `apply` on a stand-in React (the tests above).
- Checked, in the Buzz 1.0 Linux app (`0.0.0-preview.156.1`, installed from this folder): the plugin installs with no capabilities requested; the Settings card lists pages and marks the default (`★ Default`, the other rows offer **Make default**); the Artifacts page from the sidebar opens with the default chip marked and current and no click; the default changed from the Settings card, and from the page's **Make default** control, shows in both places and in the page opened again; removing the default makes the first page left the default; the default survives quitting and starting the app.
- Not checked: the browser itself. `ctx.browser.available` is false on Linux, so there the page shows its macOS-only message under the chip bar and never loads a website. That the default page's website loads on open, that its sign-in is kept, the look of the page, and the macOS 14 behaviour are covered only by the `apply` test (it renders `browser.View` with the default's address and `storage: "claude"`); they need a run in the macOS app.
