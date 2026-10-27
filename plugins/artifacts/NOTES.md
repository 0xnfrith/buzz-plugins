# Notes: the Artifacts plugin

Read from block/buzz-app at `b86b9f3c92c10705a892d234f90002a7452690d6` (2026-10-23, "feat(builderlab): ... (#1340)"); `docs/browser.md`, `src/features/browser/api.ts` and `src-tauri/src/browser/mod.rs` are unchanged between that commit and `b0c92eae` (2026-10-27).

## The browser API, with sources (all at `b86b9f3c`)

| Fact | Where |
| --- | --- |
| `ctx.browser` is `{ available: boolean; View: ComponentType<BrowserViewProps> }` | `src/features/browser/api.ts:18-21` |
| `BrowserViewProps = { url: string; storage?: string; label?: string }` | `src/features/browser/api.ts:3-14` (`storage?` at line 8) |
| `browser.View` "accepting `{ url: string; storage?: string }`", needs a flex container with available height | `docs/browser.md:26` |
| `available` is true only in the macOS desktop app; URLs must be HTTP(S), no credentials, 2,048 bytes after normalization | `docs/browser.md:28` |
| `storage`: 1-64 lowercase letters, digits, `-`, `_`, `.`; kept between opens and restarts; same name shares cookies; requires macOS 14, earlier macOS and other platforms keep the private session | `docs/browser.md:34` |
| A view with a `storage` keeps its session for ten minutes after it unmounts | `docs/browser.md:36` |
| The name check and the data-store identifier (SHA-256 of `buzz-browser-storage:<name>`) | `src-tauri/src/browser/mod.rs:197-211` |
| A plugin declares `"browser"` in `inject`; no manifest permission is documented for it | `docs/browser.md:12`, `docs/plugin-architecture.md` "Desktop browser" |
| `browser.View` is documented for use inside a panel; it is "a preview API ... not a stable compatibility contract" | `docs/browser.md:26`, `:1605` of `docs/plugin-architecture.md` |

First release tag containing the commit: `desktop-v0.7.0-beta.1`.

## Choices

- **The page renders the View itself**, rather than registering a panel. The documented panel route (`ctx.panels.register` with `matches`) opens when a link is clicked in a message, and the API gives a page no documented way to open a panel for a target of its own; the docs say other pages "can use these same contracts with their own layout". If Block adds a page-to-panel opener, switch to it so the page is only the list.
- **No build step.** The plugin is small enough to be one hand-written `plugin.js`, like `key-probe`. The list logic is exported (`createLinkStore`, `checkUrl`) so the tests import it; the host reads only `inject` and `apply`.
- **Storage name `claude`** is fixed, as asked. See the README on what that shares.
- **Plugin storage**: "Plugin-specific persistent data has no host API yet" (docs/building.md §1), so `localStorage` under the plugin id.

## Not verified

No run in a live Buzz app, and none in Buzz's web test harness (no native browser there). The page layout (chip bar over a flex-filled view), the `ui-button` class on settings buttons, the icon rendering and the sign-in persistence are unconfirmed.
