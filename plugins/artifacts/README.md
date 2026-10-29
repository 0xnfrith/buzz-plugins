# Artifacts

A sidebar page in Buzz with your saved web pages. Click one and it opens in Buzz's built-in browser, with the sign-in kept between restarts. It was made for Claude artifact links (`https://claude.ai/artifact/<id>`), and it takes any `https://` address. Pin a saved page and it also gets its own entry in Buzz's top bar, next to Messages, Reminders, Agents and Workflows: one click opens that page.

No address is built in. You add, rename and remove your own in **Settings → Artifacts**.

## Needs

- **The Buzz desktop app on macOS 14 or later.** The built-in browser (`ctx.browser`) exists only in the macOS desktop app. On the web, Windows and Linux the page says so and opens nothing.
- **block/buzz-app at b86b9f3c (2026-10-23) or later**, the commit that added the `storage` option to `browser.View` (block/buzz-app #1340). The first release tag that contains it is `desktop-v0.7.0-beta.1`. On macOS earlier than 14, or on a Buzz without the option, pages still open but each open is a private session, so you sign in again every time.
- **For pinning to the top bar: block/buzz-app at d5d414d4 (2026-10-08) or later**, the commit that added `placement` to `ctx.pages.register` (block/buzz-app #762; first release tag `v0.0.0-preview.120.1`). The commit above for `storage` already contains it. On a Buzz older than that, the docs say `placement` is ignored and a pinned page shows in the sidebar instead of the top bar; everything else works.
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

6. To pin a page to the top bar, either press **Pin to top bar** on its row in the Settings card, or open the page in Artifacts and press **Pin to top bar** at the right of the chip bar. A new entry with the page's name appears in the top bar at once, with no restart. One click on it opens that page straight in the browser, with no chip bar to pick from. **Unpin**, in the same two places, takes it off again. Renaming a page renames its entry, and removing a page unpins it. The **Artifacts** entry in the sidebar stays as it is.

A page you chose by hand stays open until you leave the Artifacts page; opening it again goes back to the default.

Buzz owns the top bar: it lists its own pages first and the rest by name, and when the window is too narrow for every entry it moves them all into a **More pages** menu (the "⋯" button). If you unpin or remove the page you are looking at from Settings, Buzz shows its own "This destination couldn't open" notice when Settings closes; pick any top-bar entry, or pin the page again and Buzz reopens it.

Only `https://` addresses are saved, with no user name or password in them, up to 2,048 bytes (Buzz's own limit).

## How it works

| Part | How |
| --- | --- |
| Sidebar entry | `ctx.pages.register({ id: "artifacts", primary: true, layout: "workspace", icon })` |
| Opening a page | `ctx.browser.View({ url, storage: "claude", label })` rendered inside the page. The host owns the controls, the website and the session |
| The list | `localStorage` under the plugin id, `megatech.artifacts`, as JSON. Only on this computer, never sent anywhere |
| The default | The id of the default page, as plain text in `localStorage` under `megatech.artifacts.default`, beside the list. The list keeps its old format, so a list saved before defaults existed reads unchanged and its first page is the default. A saved id that matches no page (stale or hand-edited) also falls back to the first page. The first page added becomes the default; removing the default moves it to the first page left; no pages, no default |
| Opening the page | The page renders the default page's `browser.View` on its first render. Clicking a chip shows that page until you leave the page. If the page you are on is removed, it falls back to the default |
| Top-bar entry | One page per pinned saved page: `ctx.pages.register({ id: "pin-<saved id>", title: <page name>, primary: true, placement: "topbar", layout: "workspace", icon })`. `pages.register` returns no disposer and a registration lasts as long as the scope that made it, so each one is registered in a child scope of the plugin (`ctx.plugin`), and unpinning ends that scope: no reload |
| The pinned page | Renders `ctx.browser.View({ url, storage: "claude", label })` for its own saved page, and nothing else: no chip bar |
| The pins | The ids of the pinned pages, as a JSON array in `localStorage` under `megatech.artifacts.pinned`, beside the list and the default. The list keeps its format. Only ids of saved pages that can make a valid page id are kept (Buzz needs `^[a-z0-9][a-z0-9._-]*$`, and the id is `pin-` plus the saved id); anything else saved there is dropped. Removing a page unpins it |
| Changing a pin | One round at a time. Unpinning or renaming ends the old entry first (ending a scope is asynchronous, and Buzz refuses the same page id twice), then the new one is registered; a change that arrives during a round is applied right after it. A title cannot change in place, so a rename ends the entry and registers it again, and the page stays open if it was |
| Settings | `ctx.settingsCards.register(...)`: add, rename, remove, make default, pin and unpin |
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

Node 22 or later, no dependencies, nothing to build: `plugin.js` is the plugin. The tests cover add (and the normalized address and default name), rename, remove, rejecting anything that is not `https://` (and addresses with credentials, over-long and garbled ones), duplicates, persistence across a reload and bad stored data, change notifications, a full storage, the default (the first page added, `setDefault` and an unknown id, removing the default, a list saved before defaults existed, a stale or garbage saved id, persistence across a reload, notifications), pins (pin and unpin and their order, an unknown id and an id that cannot make a page id, pinning twice, removing a page, stale or garbage saved pins, a full storage, a list saved before pins existed) and `apply`: it registers the sidebar page and the settings card, renders `browser.View` with `storage: "claude"` and the chosen address, opens on the default's address on the first render with no click, marks the default chip and the default row, and changes the default from the bar and from the row. For pins, `apply` runs on a stand-in for Buzz's page registry (a page stays listed until the scope that registered it ends, no duplicate or malformed page ids, asynchronous disposal): one `placement: "topbar"` page per pinned page, named for it; pin and unpin from the Settings card and from the page; a rename renames the entry; removing a page removes its entry; pins come back after a restart; the pinned page renders its own `browser.View` and no chip bar; rapid changes (pin, unpin, pin; unpin then pin before the old entry is gone; two renames in a row) end in the last state with no duplicate registration; one failing pin does not stop the others; and nothing stays registered when the plugin's scope ends.

## What was and was not checked

- Checked, in Node: the list, default and pin logic, and `apply` on a stand-in React and registry (the tests above).
- Checked, in the Buzz 1.0 Linux app (`0.0.0-preview.156.1`, installed from this folder): the plugin installs with no capabilities requested; the Settings card lists pages and marks the default (`★ Default`, the other rows offer **Make default**); the Artifacts page from the sidebar opens with the default chip marked and current and no click; the default changed from the Settings card, and from the page's **Make default** control, shows in both places and in the page opened again; removing the default makes the first page left the default; the default survives quitting and starting the app.
- Checked, in the same Linux app (`0.0.0-preview.156.1`, installed from this folder): pinning from the page and from the Settings card adds a top-bar entry at once, with no restart, between Agents and Workflows (Buzz sorts them by name); one click on the entry opens that page (here its body is the macOS-only message, naming the page); unpinning from the page and from the card removes the entry; renaming a pinned page renames its entry and the open page stays open; removing a pinned page removes its entry; pins are still there after quitting and starting the app; a window too narrow for the entries moves them into the **More pages** menu, where the pinned page is listed and opens. Unpinning the page you are looking at from Settings leaves Buzz's own "This destination couldn't open" notice when Settings closes; pinning it again made Buzz reopen the page by itself.
- Not checked: the browser itself. `ctx.browser.available` is false on Linux, so there the page shows its macOS-only message under the chip bar and never loads a website. That the default page's website loads on open, that its sign-in is kept, the look of the page, and the macOS 14 behaviour are covered only by the `apply` test (it renders `browser.View` with the default's address and `storage: "claude"`); they need a run in the macOS app. Also not checked: a Buzz older than d5d414d4 (the sidebar fallback is from Buzz's documentation, not from a run); more than a handful of pins; the top bar on macOS.
