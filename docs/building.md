# How we build Buzz plugins

These are the rules every plugin in this repository follows. Block's own reference is [`docs/plugin-architecture.md`](https://github.com/block/buzz-app/blob/main/docs/plugin-architecture.md) in block/buzz-app; read it first. This page adds what we learned building on it.

## The shape of a plugin

- A plugin is a folder with `manifest.json` (`id`, `name`, `apiVersion: 1`) and one self-contained `plugin.js` module that exports `inject` (the host services it needs) and `apply(ctx)`.
- `ctx` is a Cordis context. React comes from the host as `ctx.react`. Nothing is imported at run time: no npm packages, no separate CSS or assets.
- Small plugins can be written directly as `plugin.js`. A plugin with many parts is TypeScript built to the same one file: the vim plugin is 29 modules in `src/`, bundled by Vite with the config Block's starter (`buzzodz plugin init`) scaffolds. Buzz installs from a folder or a Git URL and never runs a build, so commit the built `plugin.js` with its source.
- Module evaluation must be pure. Work starts in `apply`, which must finish within ten seconds.

## 1. Plugin API first

Use the documented services before anything else: `pages`, `panels`, `shortcuts`, `navigation`, `relay`, `conversation`, `agents`, `settingsCards`, `notifications`. They survive host updates; the page's markup does not.

Reach into the page DOM only where the API stops, and tag each such line in a comment (`[DOM]`), so a reader can see the risk. The places where the API stops today (Buzz 1.0, API v1), each found while building [`plugins/vim`](../plugins/vim):

| What you need | Why there is no API route | What we do instead |
| --- | --- | --- |
| A key event before the editor, or the key that fired | The shortcut service is a bubbling window listener; its handlers get no event | A capture-phase `keydown` listener, only for the keys that need it |
| Caret, selection, delete, copy, undo in the message box | Composer tools get only `insertText`, `insertMention`, `insertResource`, `focus` | `Selection.modify`, `Range`, `execCommand`, a `copy` listener |
| A selected message, scrolling the timeline | The timeline has no selection state and no scroll API | A cursor kept by the plugin, drawn with CSS on `[data-message-id]` |
| Calling a message's own actions (reply, react, edit, delete) | `conversation` can add message actions, not call the host's | Wake the row's action bar and click its buttons |
| Communities (list, current, switch) | No service mentions them | Drive the community switcher as a pointer would |
| The channel list as data | It is React state inside the Channels page | Read the sidebar's channel buttons |
| Focus between regions, opening, hiding or sizing a thread pane | Focus and pane rules are private to the host; `panels` only registers cards | `focus()` on `data-*` regions; the host's own toggle button, split handle and close-tab event |
| Calling host commands (search, focus composer, close tab) | There is no command bus | Dispatch the host's own chord or window event |
| A dialog or overlay, a status-line slot | No service for either | Append our own element to `document.body`, styled with host classes and tokens |
| Plugin storage | "Plugin-specific persistent data has no host API yet" | `localStorage` under the plugin's id |

Every DOM route breaks quietly when Block changes its components. Write it so a missing selector means a key that does nothing, never an exception that takes the plugin down. When the API grows, delete the DOM route.

## 2. Colours come from the host's theme

Never hard-code a colour. Use the CSS custom properties the host sets on `<html>` from Settings → Appearance (mode and accent), so the plugin follows a change the moment it happens, with no listener:

| Token | Use |
| --- | --- |
| `--accent-9` | The accent's strong fill: active lines, outlines, the selected thing |
| `--affordance-backdrop-pressed` | The host's hover and pressed step (lighter on dark, darker on light): a "lifted" item |
| `--surface-popover`, `--text-standard` | A floating label or card: ground and ink |
| `--border-focus` | A focus ring |

`color-mix(in srgb, var(--accent-9) 45%, transparent)` gives a faint version of a token. Give each `var()` a fallback in case a later host drops the token. For cards and dialogs, prefer the host's own classes (`ui-card`) over styling them yourself.

### When a plugin carries a look of its own

One exception to "never hard-code a colour": a plugin that has a look of its own (a brand) may add its own accent colours, on these terms.

- **Surfaces, text, muted text, borders and focus still come from the host's tokens**, each with a fallback. The accents sit on top of them; they do not replace them.
- **The accents are named custom properties on the plugin's own root element**, never on `<html>` or `<body>`, so nothing outside the plugin changes. Name every class and variable after the plugin.
- **Check both themes.** A brand colour that is faint on white (bright cyan is 1.8:1) must not carry text or a line that means something. Derive a darker ink for light: at least 4.5:1 for text, and at least 3:1 for a line, an input's edge, a selected or default state, and the focus ring. Keep the bright colour for fills and for decoration that nothing depends on. Say in the README which values are derived.
- **Glows and blurred shadows suit dark only.** Leave them out in light. A 1 px `box-shadow` ring with no blur, such as the one on a focused or invalid input, is a line, not a glow, and may stay in both themes (the 3:1 rule above still applies to a line that means something).
- **Fonts cannot be loaded** (§4), so a plugin that wants one embeds it in `plugin.js` as a data URL. Do this only for a font whose licence allows redistribution, keep its licence text and copyright notice in a `licenses/` folder beside the plugin, check whether the licence reserves a font name (a subset can count as a modified version), say in the README how much the file grows, and always end the font stack with system fonts so the plugin still reads without the embedded one.

## 3. Clean up everything in `ctx.effect`

Update in Settings disposes the old revision and applies the new one in the same page. Anything the old revision left behind keeps running next to the new one. So:

- Every listener, timer, observer, `<style>` element, overlay and `data-*` attribute the plugin adds outside React is created inside `ctx.effect(() => { ...; return cleanup; })`, and the cleanup removes it.
- Registrations made through the services (`ctx.pages.register`, `ctx.shortcuts.register`, `ctx.agents.register`, ...) are removed by Buzz when the plugin's scope ends.
- Test it: disable and enable the plugin several times, then count listeners, nodes, timers and observers after a forced GC. The counts must not grow (`plugins/vim/test/leak.spec.mjs` does this).

## 4. No network, no keys, no eval (one reviewed exception)

The rule: no `fetch`, WebSocket or remote media from a plugin; no keys, tokens or secrets in a plugin, its settings or its logs; no `eval`, `new Function` or code loaded from strings.

Plugins run unsandboxed in the app's own page, so these are our rules, not something Buzz enforces. The exception is a **connector**: a plugin whose whole job is to show or change something in one outside service. It may reach that service and hold a credential only if all of this holds:

- **One declared route.** The way out is named in the manifest, so the install review lists it, and the plugin uses nothing else. For a service on the internet that is one exact origin in `host.networkOrigins`, reached only through `ctx.host.request` (Buzz's own HTTPS client: it refuses any other origin and follows no redirects). For a service on the same computer that speaks plain HTTP, which `host.request` refuses, it is a program declared under `host.commands` with its arguments fixed in the manifest, run with `ctx.host.runCommand`. Never `fetch`, WebSocket or a remote image from the page.
- **Only the address it is for.** A local connector refuses any address that is not loopback, and says so; a remote one has the one origin and nothing else.
- **The user's own credential, and nothing else.** The user pastes their own key or token in the plugin's settings card. The plugin carries none of its own, and none is in the repository, the manifest, a build, a fixture, a screenshot or a test log. Tests use a made-up one against a fake service.
- **Kept where the system keeps secrets if a declared command can reach it; otherwise plainly, and said plainly.** Buzz has no credential store for plugins, but the system may have one: on macOS the Keychain, through the `security` program, declared in the manifest with fixed arguments. Where the plugin can use it, the credential goes there (handed over on the program's standard input, never as an argument, and checked by reading it back) and the profile's `localStorage` is only an explicit, labelled choice. Where it cannot, the credential sits in the profile's `localStorage` under the plugin's id, in plain text, and any other installed plugin could read it. The plugin's README and its settings card say which, in so many words.
- **Never shown, never logged, off the command line.** After saving, the credential is not rendered anywhere. It goes into one request header and nowhere else: not a URL, a console message, an error message or a stack, and not an argument of a program (the process list shows those): a command takes it on stdin. Errors shown to the user are fixed text, since a host or service error can name the request.
- **A test says so.** The browser spec shows the credential is not in the page after saving, not in the console, and in no address, and that the page itself makes no request to the service: everything goes through the declared route. The unit tests make the real failures happen (a wrong credential, a missing permission, nothing listening, a garbled reply) and check that no error carries the credential, and read the command line of the running program to check it is not there (where the system lets a test read it).

A plugin that needs more (several routes, a credential that is not the user's own, a secret held for others, a server of its own) is a different design and gets reviewed as one. [`plugins/beeper`](../plugins/beeper) is the worked example of a local connector, and [`plugins/linear`](../plugins/linear) of a connector to a service on the internet.

## 5. Measure before and after big changes

Speed and memory are measured before a refactor or any change to a hot path, and again after it, with the same method:

- **Key to paint**: from `keydown` reaching the window to the next frame on screen (`requestAnimationFrame`, then a `MessageChannel` message). Report the median and p95, not single values; the first keys after entering a list are the slowest, so report them apart from the rest.
- **Memory over time**: the page process's resident memory every 30 seconds for 15 minutes, with the plugin on and, as the control, off. Compare the first and last sixth of the samples and the slope. In Chromium, also the JS heap after a forced GC.
- **Dispose and re-apply**: the leak test above.

The vim plugin carries its measuring built in and off by default (a *Performance trace* setting on its page), plus scripts for the browser harness and the real Linux app. See `plugins/vim/NOTES.md`, "Measuring the plugin".

## 6. Test against Buzz's own web build

Tests run the plugin in block/buzz-app's own browser harness: the production web build, a fixture relay, headless Chromium, and the plugin registered through the same code path as a bundled plugin. A test script copies the plugin and its Playwright spec into a scratch checkout of block/buzz-app and runs it there (`plugins/vim/test/run.sh`). Pin the block/buzz-app commit you tested against in the plugin's notes.

What the harness cannot cover, check by hand and say so: the desktop installer path, macOS WebKit, and real relay data.

## 7. Write down what you found

Each plugin keeps a `NOTES.md`: what works through the API, what needed the DOM and why, what was verified and what was not. It is how the next plugin starts ahead.
