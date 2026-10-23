# Linear for Buzz: notes

What the plugin API reaches for a board like this, how it was tested, and what was not. Written against block/buzz-app at commit `c2210b45` (main, 2026-10-23) and the Linear GraphQL schema at linear/linear `618a737a` (2026-10-21).

## Verdict

A working board fits inside the documented API with very little reaching into the page: one page, one settings card, the host's HTTP client for Linear, and `localStorage` for the key. The gaps are the usual ones (no plugin storage, no credential store, no drag service, no stylesheet service) and each has a small, tagged workaround.

## What goes through the plugin API

| Need | Route |
| --- | --- |
| A page in the sidebar, with an icon | `ctx.pages.register({ primary: true, layout: "workspace", icon })`. The icon is the MEGATECH mark as a `data:image/svg+xml` URL (API v1 ships no assets) |
| A place for the key | `ctx.settingsCards.register({ group: "Plugins" })` |
| Reaching Linear | `ctx.host.request` with `host.networkOrigins: ["https://api.linear.app"]` in the manifest. HTTPS only, that exact origin, no redirects, 1 MiB request body, 16 MiB response, 30 s deadline. The `Authorization` header is allowed |
| Opening the settings card from the page | `ctx.navigation.open({ version: 1, kind: "settings", section: "megatech.linear/settings" })` (a grouped card's section id is `plugin/card`) |
| Light and dark | Host CSS tokens (`--surface-base`, `--surface-panel`, `--border-standard`, `--text-standard`, `--text-metadata`, `--affordance-row-hover`, `--green-9`, `--purple-9`, `--red-9`, `--amber-9`), so the board follows Settings, Appearance with no listener |
| Opening Linear and GitHub | Plain `<a target="_blank" rel="noopener noreferrer">`, as the bundled pages do |

## What is outside the API, and what we do

All tagged `[DOM]` or noted in the code.

| Need | Why there is no API route | What we do |
| --- | --- | --- |
| Stored data (key, last team and filter) | "Plugin-specific persistent data has no host API yet", and the host has no credential store | `localStorage`, keys `megatech.linear.api-key.v1` and `megatech.linear.board.v1`. The key is plain text in the app profile and readable by any other plugin; the README says so |
| Styles | API v1 has no separate CSS | One `<style data-megatech-linear>` added and removed inside `ctx.effect` |
| Drag and drop | No drag service. HTML5 drag events work (Buzz turns `dragDropEnabled` off) but give no control over the dragged copy, scrolling or cancel | Pointer events on `window` while a press is held, a threshold, a floating copy of the card, edge auto-scroll, Escape to cancel, and the click that ends a drag suppressed. Mouse and pen only; touch scrolls. A keyboard route is the **Status** menu in the details |
| Clearing a text selection while dragging | The host has no selection service | `getSelection().removeAllRanges()` while a drag moves, behind `-webkit-user-select: none` (WebKit needs the prefix) |
| Colours of the brand | Tokens carry no brand | Cyan `#00d4ff` on dark and `#0090b8` on light, chosen by the host's `data-color-mode` attribute |

## Linear: what was relied on

- Auth: a personal API key goes in `Authorization` as is. `Bearer` is for OAuth tokens and Linear refuses a personal key with it (the fake mimics that, from Linear's docs: **not yet confirmed against Linear**).
- Every document is validated against Linear's published schema in a unit test, so field and variable-type mistakes fail before a user sees them. `IssueFilter` ids are `ID`, while `team(id:)` takes `String!`, so `TeamSetup` has two variables.
- One request per column (`issues(filter: team + state [+ project])`, 50 a page, newest change first) rather than one big list, so a long Done column cannot starve the others and each request stays small. (Whether each stays under Linear's complexity limit is not confirmed; see below.) A saved view goes through `customView(id).issues`, so Linear applies the view's own filter.
- The refresh timer asks one cheap question (`issues(filter: team + updatedAt > watermark, first: 1, orderBy: updatedAt, includeArchived: true)`) and reloads only on a yes. The watermark is the largest `updatedAt` seen so far, from loaded issues, from the plugin's own moves and from the probe's answer, so clock skew cannot cause a loop, the plugin's own moves are not news, and a change outside the chosen project or beyond the loaded page triggers one reload, not one a minute. An empty board has nothing to measure against and uses the local clock minus a minute. Ticks closer than two seconds apart count once (the window coming back fires several events).
- A read that began before a move cannot undo it: every move bumps a counter, and a load keeps any card moved after the load began. A saved project or view that no longer exists drops back to all issues with a note.
- Sub-issue progress is the sub-issues of state type `completed` over all that are not `canceled`. PR chips come from GitHub attachments whose URL is `…/pull/<n>`; the state of a PR is read from `metadata.status` and `metadata.draft`.
- Ordering inside a column is the issue's `sortOrder` ascending for open states and `updatedAt` newest first for Done and Canceled.

## What was verified, and how

Run against the code in this folder:

- `pnpm test` (vitest, 50 tests): the client (headers, error kinds, no key in any error text), the store (load, paging, filters, optimistic move and rollback, refresh rules, stale answers dropped, blocked states), and every GraphQL document against Linear's schema.
- `test/run.sh <block/buzz-app checkout>`: 26 browser tests in Buzz's own production web build (headless Chromium, fixture relay), with the plugin registered the way an installed one is. They cover the columns and their order, drag (including Escape and a refused move), the details panel and its keyboard route, the connect-and-save flow, a refused and a revoked key, the key being absent from the page, the console and the network after saving, filters and remembered choices, paging, refresh by timer, rate limit, lost connection, light and dark, a narrow window, and the dispose and re-apply count of listeners and styles across leaving the page and turning the plugin off and on three times.
- **The desktop app** (Linux, WebKitGTK, `0.0.0-preview.156.1`), by hand, with the fake Linear served over HTTPS through a local CONNECT proxy (`test/real-app/`): Git import of this folder from a branch (the importer lists it as `megatech.linear`, with its discovery category and tags), the install review ("Connect to https://api.linear.app"), enabling, the settings card (a real `plugin_host_request` to the fake: "Connected as …"), the board, a drag in WebKit, the details panel, an update from a newer commit (the plugin stayed enabled, the key stayed, the board came back), an app restart (the key and the last team were kept), and light and dark. One bug came out of it and is fixed: WebKit needs `-webkit-user-select: none`, or a drag highlights the text it passes over.
- The fake Linear (`test/fake-linear/`) runs graphql-js against Linear's real schema, so it enforces the types, but its **data and behaviour are invented**.

An independent read-through of the code (a reviewer with no part in writing it) found nine bugs: a team switch or key change during a load could leave the board on "Loading…" for good, Refresh after a failed first load did the same, a slow read could undo a finished move, a deleted saved view broke the board, a drop outside the board still moved a card, a drag could stick after a release outside the window, a slow key check could delete a newer key, and cached details never refreshed. Each is fixed and has a test that fails on the earlier code.

## What was not verified

- **Against a real Linear workspace.** Not run. Unconfirmed until then: the `Authorization` format, the exact shape of GitHub PR attachment `metadata`, the direction of `sortOrder`, the real complexity cost of the card fields (`X-Complexity` header), the rate-limit headers, and what Linear returns for a key without Write access.
- That **Open in Linear** opens a browser: the click does not navigate the app's own window, but the test VM has no browser to receive it.
- macOS WebKit (WKWebView) and Windows. The web harness is Chromium only and the desktop run was Linux only.
- Touch input (dragging is mouse and pen only).
- Keyboard use beyond Tab, Enter, Space and the **Status** menu: every card is a tab stop and there are no arrow keys between cards or columns.
- The dragged copy is `position: fixed`; a host ancestor with a CSS transform would offset it. None does today.
- Markdown in descriptions is shown as plain text with links made clickable.
- Large workspaces: only columns of a few dozen to a few hundred cards were tried.
