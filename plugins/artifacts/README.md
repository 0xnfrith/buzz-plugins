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

1. Open **Settings** and find the **Artifacts** card (group Plugins). Type a name (optional) and an `https://` address, press **Add page**. The first page you add is your **default**. An address that cannot be saved is not saved: its field turns red and a message says why.
2. Open **Artifacts** in the sidebar. It opens on the default page at once, with no click. Your pages are chips along the top, the default one marked with a star (its accessible name ends in "(default)"). Click another chip to look at that page instead.
3. Sign in to the site once. The sign-in is kept under a named browser storage, `claude`, so it survives closing the page and restarting Buzz.
4. To change the default, either press **Make default** on a page's card in the Settings card (the default has a bar down its left edge and a ★ DEFAULT mark), or open the page you want in Artifacts and press **Make default** at the right of the chip bar (it appears only while you are looking at a page that is not the default). After you press it on the chip bar, the keyboard focus moves to that page's chip.
5. To rename a page, press **Rename** on its card: the name becomes a field in place, with **Save** and **Cancel** (Enter saves, Esc cancels and does not close Settings). To remove a page, press **Remove**: the card asks once, "Remove this page?", with **Remove** and **Keep** (Keep has the focus, and Esc keeps the page). If you remove the default, the first page left becomes the default; with no pages left, the page shows its empty message again. A page whose saved name is only blanks is shown by its address.

6. To pin a page to the top bar, either press **Pin to top bar** on its row in the Settings card, or open the page in Artifacts and press **Pin to top bar** at the right of the chip bar. A new entry with the page's name appears in the top bar at once, with no restart. One click on it opens that page straight in the browser, with no chip bar to pick from. **Unpin**, in the same two places, takes it off again. Renaming a page renames its entry, and removing a page unpins it. The **Artifacts** entry in the sidebar stays as it is.

A page you chose by hand stays open until you leave the Artifacts page; opening it again goes back to the default.

Buzz owns the top bar: it lists its own pages first and the rest by name, and when the window is too narrow for every entry it moves them all into a **More pages** menu (the "⋯" button). If you unpin or remove the page you are looking at from Settings, Buzz shows its own "This destination couldn't open" notice when Settings closes; pick any top-bar entry, or pin the page again and Buzz reopens it.

Only `https://` addresses are saved, with no user name or password in them, up to 2,048 bytes (Buzz's own limit).

## How it works

| Part | How |
| --- | --- |
| Sidebar entry | `ctx.pages.register({ id: "artifacts", primary: true, layout: "workspace" })`, with no `icon` (see below) |
| Opening a page | `ctx.browser.View({ url, storage: "claude", label })` rendered inside the page. The host owns the controls, the website and the session |
| The list | `localStorage` under the plugin id, `megatech.artifacts`, as JSON. Only on this computer, never sent anywhere |
| The default | The id of the default page, as plain text in `localStorage` under `megatech.artifacts.default`, beside the list. The list keeps its old format, so a list saved before defaults existed reads unchanged and its first page is the default. A saved id that matches no page (stale or hand-edited) also falls back to the first page. The first page added becomes the default; removing the default moves it to the first page left; no pages, no default |
| Opening the page | The page renders the default page's `browser.View` on its first render. Clicking a chip shows that page until you leave the page. If the page you are on is removed, it falls back to the default |
| Top-bar entry | One page per pinned saved page: `ctx.pages.register({ id: "pin-<saved id>", title: <page name>, primary: true, placement: "topbar", layout: "workspace" })`. `pages.register` returns no disposer and a registration lasts as long as the scope that made it, so each one is registered in a child scope of the plugin (`ctx.plugin`), and unpinning ends that scope: no reload |
| The pinned page | Renders `ctx.browser.View({ url, storage: "claude", label })` for its own saved page, and nothing else: no chip bar |
| The pins | The ids of the pinned pages, as a JSON array in `localStorage` under `megatech.artifacts.pinned`, beside the list and the default. The list keeps its format. Only ids of saved pages that can make a valid page id are kept (Buzz needs `^[a-z0-9][a-z0-9._-]*$`, and the id is `pin-` plus the saved id); anything else saved there is dropped. Removing a page unpins it |
| Changing a pin | One round at a time. Unpinning or renaming ends the old entry first (ending a scope is asynchronous, and Buzz refuses the same page id twice), then the new one is registered; a change that arrives during a round is applied right after it. A title cannot change in place, so a rename ends the entry and registers it again, and the page stays open if it was |
| Settings | `ctx.settingsCards.register(...)`: one card per saved page with its name, address, a ★ DEFAULT mark and a TOP BAR mark, and the actions Rename (in place), Make default, Pin to top bar / Unpin and Remove (asks once); above them an add form with an inline error, and a count. With no pages, an empty message. See "The look of the Settings card" |
| Colours | Surfaces, text and borders come from the host's tokens (`--text-standard`, `--text-subtle`, `--text-metadata`, `--surface-panel`, `--border-standard`, `--border-focus`), each with a fallback. The Settings card adds its own accents as named custom properties on its root (see below) |
| Manifest | `id`, `name`, `apiVersion`, `description`, `discovery`. No `host` block: the plugin declares no command and no network origin |

### The look of the Settings card

The card keeps the host's surfaces, text and borders, so light and dark follow **Settings → Appearance** with no listener, and wears a look of its own on top: a charged cyan **Add page** button, a cyan bar and ★ mark on the default page, a magenta mark on pages in the top bar, hairlines, square corners, **Chakra Petch** headings, and addresses and labels in the system monospace in small capitals with wide tracking.

- **The accents are named custom properties on the card's own root** (`--megatech-artifacts-cyan` and the like on `.megatech-artifacts-set`), never on `<html>`, so nothing outside the card changes. Every host token it reads has a fallback. This is a deliberate exception to [`docs/building.md` §2](../../docs/building.md) ("never hard-code a colour").
- **Light theme.** The bright cyan `#00d4ff` is 1.8:1 on white, too faint for text or for a line that means something. In light the card uses darker inks for text and for those lines: `#00708f` (5.65:1), `#c4009f` (5.46:1) and `#c2362b` (5.45:1) on white. The bright cyan stays on the **Add page** fill and on decoration nothing depends on. These three values are derived for this plugin; they are not taken from any palette.
- **Lines that carry meaning are at least 3:1** against the card, in light and in dark: the default card's border and bar, the input edges, the pins' and the default's marks, the buttons' edges and the focus ring (measured from screenshots; see "What was and was not checked").
- **A narrow Settings window.** The card is a size container, and two container queries stack the add row and tighten the cards below 600 px and 420 px of card width.
- **Class and variable names** all begin `megatech-artifacts`.

### Fonts

One font is embedded: **Chakra Petch Bold**, the headings' face, in `plugin.js` as a data URL (a plugin may not load anything). It is the latin subset published by the Fontsource project (`@fontsource/chakra-petch` 5.x), about 13 KB of base64, and it is licensed under the **SIL Open Font License 1.1**; its copyright notice and the licence text are in [`licenses/`](licenses/). It declares no Reserved Font Name. Addresses and labels use the system monospace (`ui-monospace` and its fallbacks). No second face is embedded: the monospace the look was drawn with carries a licence that reserves its name, which an embedded subset would strictly need permission to keep. Without the embedded font, the headings fall back to the system sans (`ui-sans-serif`).

### The icon

The plugin gives no `icon` to any page. Buzz draws a page's `icon` as an `<img>` of a `data:` image, and an SVG inside an `<img>` cannot see the app's theme, so a plugin icon comes out in a fixed colour (black for this plugin's earlier one) next to Buzz's own entries, which follow the theme. With no `icon`, Buzz draws its own icon for the page, in the same colour as its other entries in light and dark, for the sidebar entry and for every pinned top-bar entry. Sources are in `NOTES.md`.

### The no-network rule

[`docs/building.md` §4](../../docs/building.md) forbids `fetch`, WebSocket and remote media from a plugin. This plugin does none of that. Opening an address in `ctx.browser.View` is the host's browser panel loading the page, not the plugin making a request: the plugin only hands the host a string, and the host's native view loads it, without Buzz's IPC bridge. So no connector exception and no `host.networkOrigins` are needed, and the manifest asks for no permission. A test checks that `plugin.js` contains no `fetch`, WebSocket, `eval` or host-command call.

### One thing to know about the sign-in

Every page opens with the same named storage, `claude`, because that is what keeps a claude.ai sign-in. Pages from other sites opened through this plugin therefore share cookies with it. Buzz keeps that storage apart from its own, but names separate storages, not plugins, and plugins run as trusted code ([`docs/building.md`](../../docs/building.md)). Save only sites you are happy to keep signed in together.

## Tests

```
node --test plugins/artifacts/test/*.test.mjs
```

Node 22 or later, no dependencies, nothing to build: `plugin.js` is the plugin. The tests cover add (and the normalized address and default name), rename, remove, rejecting anything that is not `https://` (and addresses with credentials, over-long and garbled ones), duplicates, persistence across a reload and bad stored data, change notifications, a full storage, the default (the first page added, `setDefault` and an unknown id, removing the default, a list saved before defaults existed, a stale or garbage saved id, persistence across a reload, notifications), pins (pin and unpin and their order, an unknown id and an id that cannot make a page id, pinning twice, removing a page, stale or garbage saved pins, a full storage, a list saved before pins existed) and `apply`, on a stand-in for Buzz and for React that keeps component state (`test/harness.mjs`): it registers the sidebar page (with no icon) and the settings card, renders `browser.View` with `storage: "claude"` and the chosen address, opens on the default's address on the first render with no click, marks the default chip, and changes the default from the bar (and then focuses that page's chip) and from a card. The Settings card: the heading, lede and counts; a card per page with its marks; adding a page, an alert and `aria-invalid` for a bad address, cleared on typing; rename in place (Save, Cancel, Esc that does not reach Settings, focus returning to Rename); Remove asking once (Keep focused, Esc as no, focus returning to Remove); accessible button names; no Pin button for an id that cannot be a page id, on the card or the chip bar; a saved name of blanks shown as its address on chips, cards, the view label and the top-bar entry; the embedded font as data, nothing fetched, and the system monospace for addresses and labels; the brand accents on the card's root only, with fallbacks and the light inks; every class and variable named after the plugin; the container queries. For pins, `apply` runs on a stand-in for Buzz's page registry (a page stays listed until the scope that registered it ends, no duplicate or malformed page ids, asynchronous disposal): one `placement: "topbar"` page per pinned page, named for it; pin and unpin from the Settings card and from the page; a rename renames the entry; removing a page removes its entry; pins come back after a restart; the pinned page renders its own `browser.View` and no chip bar; rapid changes (pin, unpin, pin; unpin then pin before the old entry is gone; two renames in a row) end in the last state with no duplicate registration; one failing pin does not stop the others; and nothing stays registered when the plugin's scope ends.

## What was and was not checked

- Checked, in Node: the list, default and pin logic, and `apply` on a stand-in React and registry (the tests above; 64 tests, and 38 single changes to `plugin.js`, each caught by a failing test).
- Checked, in the Buzz 1.0 Linux app (`0.0.0-preview.156.1`, installed from this folder): the plugin installs with no capabilities requested; the Artifacts page from the sidebar opens with the default chip marked and current and no click; the default changed from the Settings card, and from the page's **Make default** control, shows in both places and in the page opened again; removing the default makes the first page left the default; the default survives quitting and starting the app.
- Checked, in the same Linux app (`0.0.0-preview.156.1`, installed from this folder): pinning from the page and from the Settings card adds a top-bar entry at once, with no restart, between Agents and Workflows (Buzz sorts them by name); one click on the entry opens that page (here its body is the macOS-only message, naming the page); unpinning from the page and from the card removes the entry; renaming a pinned page renames its entry and the open page stays open; removing a pinned page removes its entry; pins are still there after quitting and starting the app; a window too narrow for the entries moves them into the **More pages** menu, where the pinned page is listed and opens. Unpinning the page you are looking at from Settings leaves Buzz's own "This destination couldn't open" notice when Settings closes; pinning it again made Buzz reopen the page by itself.
- Checked, in the same Linux app, for the redesigned Settings card (light and dark, the real Settings dialog; three sample pages): the list with a default page that is also in the top bar, one only in the top bar and a plain one; the add form and its counts; Rename in place with Save, Cancel and Esc (Esc leaves Settings open); Remove asking once, with Keep and with Esc; a bad address (red field, "Not saved" and the reason); the empty message; Make default on the chip bar by keyboard, after which the focus ring is on that page's chip; the embedded font drawing the headings; and a narrow window (760 px and 560 px wide), where the add row stacks and the buttons wrap. Measured from the screenshots, the lowest contrast of a line that means something is 3.11:1 (the top-bar mark's border in dark), 3.27:1 for a button's edge in dark, 3.42:1 in light; the default's border and bar are 5.56:1 in light and 3.64:1 and 9.60:1 in dark; input edges 4.58:1 and 6.37:1.
- Not checked: the browser itself. `ctx.browser.available` is false on Linux, so there the page shows its macOS-only message under the chip bar and never loads a website. That the default page's website loads on open, that its sign-in is kept, the look of the page, and the macOS 14 behaviour are covered only by the `apply` test (it renders `browser.View` with the default's address and `storage: "claude"`); they need a run in the macOS app. Also not checked: a Buzz older than d5d414d4 (the sidebar fallback is from Buzz's documentation, not from a run); more than a handful of pins; the top bar on macOS; the Settings card's fonts and look on macOS and Windows; a Settings window narrower than 560 px.
