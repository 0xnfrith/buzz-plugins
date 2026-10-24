# Notes: the Beeper inbox plugin

What was found building it, what was verified and what was not. The README is for people using the plugin; this is for the next person building one.

Built against block/buzz-app at `f4e95770` (2026-10-23) and Beeper's `desktop-api-js` at `9d2d14d` (2026-09-25). Read 2026-10-24.

## Sources

| What | Where |
| --- | --- |
| Beeper Desktop API: what it is, that it needs the app running, local only by default | [developers.beeper.com/desktop-api](https://developers.beeper.com/desktop-api/) |
| Authentication: access token (Settings, Developers, Approved connections, **+**), `Authorization: Bearer`, `GET /v1/info` for discovery, `401` for a missing or bad token and `403` for a missing scope, OAuth metadata on `localhost:23373` | [developers.beeper.com/desktop-api/auth](https://developers.beeper.com/desktop-api/auth/) |
| The MCP server: the same port, `http://localhost:23373/v0/mcp`, streamable HTTP, the same bearer token; no HTTPS mentioned | [developers.beeper.com/desktop-api/mcp](https://developers.beeper.com/desktop-api/mcp/) |
| Endpoints, parameters and field names | [beeper/desktop-api-js](https://github.com/beeper/desktop-api-js) at `9d2d14d`: `api.md`, `src/resources/{chats/chats,messages,shared,info,accounts/accounts}.ts`, `src/core/pagination.ts`, `src/client.ts` (default base URL `http://localhost:23373`). The reference pages on the docs site render with JavaScript, so the SDK, which is generated from Beeper's OpenAPI spec, is what was read |
| What Buzz lets a plugin do | [`docs/plugin-architecture.md`](https://github.com/block/buzz-app/blob/main/docs/plugin-architecture.md) ("Declaring host access"), and the source below |

The menu path is the one soft spot. Beeper's authentication page says **Settings, Integrations** for the token; newer guides say **Settings, Developers, Beeper Desktop API** for the switch and **Approved connections** under it. The plugin's texts say Developers. Not checked against a running app.

## The finding that shaped the plugin: plain HTTP on localhost is out of reach

Beeper Desktop's API is `http://localhost:23373`. Of the ways a Buzz plugin can reach out:

| Route | Verdict | Why (block/buzz-app at `f4e95770`) |
| --- | --- | --- |
| `ctx.host.request` | No | HTTPS only, for the manifest's `networkOrigins` (`crates/plugin-manager/src/lib.rs:189`: "Invalid HTTPS origin declaration") and for each request (`src-tauri/src/host_request.rs:240`: "Host requests require HTTPS without URL credentials"; a test asserts `http://api.example.test/graphql` is refused) |
| `fetch` from the page | No | `src-tauri/tauri.conf.json:30`: `connect-src 'self' ipc: http://ipc.localhost https://api.github.com wss:`. No `http://localhost:*` |
| WebSocket | No | `wss:` only, and Beeper's WebSocket events are marked experimental in its docs |
| `host.runCommand` with a program the manifest declares | **Yes** | No shell; arguments come only from the manifest; optional stdin up to `maxInputBytes` (64 KiB at most); a 5 s deadline (`host_command.rs:155`); stdout up to `maxOutputBytes` (1 MiB at most), over which the result is `null`; non-zero exit is `null` (`host_command.rs:300`); stderr is discarded; output that is not UTF-8 is `null` (`:375`) |
| `host.spawn` (`host.processes`) | Possible, heavier | A long-lived helper; needs a program that does the HTTP, which is `curl` or a script again, plus a process to keep alive and clean up |
| Beeper's own CLI (`beeper`) | Possible | One more thing to install, with its own login; the Desktop API is the same underneath |

So the plugin declares `curl`. Asking Block to accept loopback HTTP origins in `host.request` (where `http://127.0.0.1:<port>` can do no harm) would remove the need; it is a request for them, not a blocker.

### How the `curl` route is built

- **The request is a curl config on stdin** (`--config -`): `url`, `header`, `request`, `data-raw`. The token is therefore not in the process list (the command line is visible to every program on the computer; stdin is not). The config is built in `src/beeper/curl.ts`; every value is a double-quoted string with `\`, `"`, line breaks and tabs escaped, and any other control character is refused.
- **`data-raw`, never `data`**: curl reads a value that begins with `@` as a file name (`@/etc/hostname` would send the file). `test/unit/client.test.ts` sends exactly that text, and a message that tries to close its quote and add a `url =` line, and checks Beeper received them byte for byte.
- **The manifest fixes the rest** (`manifest.json`): `-q` (first: ignore the user's `.curlrc`, which could add a proxy or a second URL), `--proto =http` (curl cannot be talked into `file://` or `https`), `--noproxy '*'` (with `http_proxy` in the environment curl would send even `localhost` through the proxy, token and all), `--connect-timeout 2 --max-time 4` (under Buzz's 5 s, so the reply is `null` from curl, not a killed process), `--write-out '\n%{http_code}'` (the status follows the body; without `--fail` an HTTP error is still exit 0, so `401`, `403`, `404` can be told apart from "nothing answered", which is exit 7 and so `null`). The tests run the real curl with these arguments and prove the proxy, the curlrc and a non-http URL are all ignored or refused.
- **`null` is ambiguous**: curl missing, Beeper closed, a reply over 1 MiB, a reply over 4 s and a reply that is not UTF-8 all come back as `null`. `client.diagnose()` runs the second declared command (`curl --version`) and then `GET /v1/info` to say which; the store does that once per change of state, not on every poll.
- **1 MiB out**: a chat in Beeper's list comes with up to 20 of its participants (the SDK says so), so the list for 200 chats can be over the 1 MiB Buzz lets a program print, and then the answer is `null`, indistinguishable from nothing. `client.chats()` therefore asks for 200, and when two tries in a row fail while `diagnose()` finds Beeper is there, asks for half as many (down to 25) and remembers. The fake can pad each chat (`chatPadding`) to show it. The list says "Older chats are not listed" when Beeper reports more. **This has never met a real Beeper's sizes.**
- **64 KiB in**: a send is one request on stdin. `fitsInRequest` reserves 3 KiB for the address, headers and the longest token the settings card accepts (500 characters) and the composer says "too long" before the attempt. In the tests a 60,000-character message fits and a 70,000-character one does not; quotes, backslashes and line breaks grow when escaped, so fewer fit.
- **The install review** shows "Computer access" and two "Run curl" entries, each expandable to the program and every argument (seen in the real app). A reader can see what will run.
- The token must also pass `checkToken` (printable ASCII, no spaces, 8 to 500 characters); there is no check for a vendor prefix, since Beeper's format is not documented.
- **`--globoff`**: curl treats `[`, `]`, `{` and `}` in a URL as ranges and sets. Chat ids and cursors are percent-encoded so none reaches the URL, but the flag is in the manifest in case an address ever does.
- **A send that gets no answer** is `unconfirmed`, not "not sent": with `--max-time 4`, a POST can be cut off after Beeper took the message, and "Try again" would then send it twice. The text says to look in the chat first.
- **The DEL character (0x7f)** is the one character `JSON.stringify` leaves raw that a curl config cannot carry; it is written as `\u007f`. Found in review; before, pasting 2,500 characters with a DEL in them threw during render.
- **Only loopback**: `checkBaseUrl` accepts `http` on `127.0.0.1`, `localhost` or `[::1]`, with a port and nothing else (no credentials, path, query or fragment). The stored address is checked again every time it is read (`config.baseUrl()`), not only when typed, so whatever is in the profile's storage, only loopback is called. The URL parser's own spellings are checked too (`http://127.1:1` becomes `http://127.0.0.1:1`; `http://localhost@evil.example/` is refused).

## Beeper's API, as used, and what is assumed

Used: `GET /v1/info` (no token), `GET /v1/chats?limit=200`, `GET /v1/chats/{id}/messages` (with `cursor` and `direction=before` for older pages), `POST /v1/chats/{id}/messages` with `{"text": …}` answered by `{chatID, pendingMessageID}`, `POST /v1/chats/{id}/read`. Chat ids look like `!abc:beeper.com` and are written the way Beeper's SDK writes path segments.

Taken from the SDK and **not seen from a real Beeper**:

- the order of a messages page (assumed newest first; the plugin sorts by timestamp and then sort key, so either works), and the page size (the fake uses 20);
- that `limit` up to 200 is honoured on `/v1/chats`, and that its order is by activity (the plugin sorts again);
- that `POST …/read` takes an empty JSON body, and that a message appears in the list under an id other than `pendingMessageID` (the plugin matches a sent message by that id *or* by "mine, same text, not older than the send");
- that a chat id with `!` and `:` works unencoded in a path;
- `isReadOnly` on a chat that cannot be written to (the box is hidden); the send is refused by Beeper anyway;
- **merged chats**: the API lists a merged chat (`merge`) with no messages of its own, and its members with `mergedIntoChatID`. The plugin hides the merged chat and lists the members, because the members have messages and the merged one does not. Beeper suggests the opposite for clients that group them; that is a later step.

[`scripts/probe.mjs`](scripts/probe.mjs) checks the ones that can be checked by reading, and prints only status codes, field names, presence counts and type names.

## What worked through the plugin API, and what needed the page

API: `pages.register` (a primary page with the workspace layout), `settingsCards.register`, `navigation.open` to the plugin's settings section, `host.runCommand`, `ctx.effect` for cleanup.

Page DOM or browser APIs, each tagged `[DOM]` in the source:

| What | Why | Where |
| --- | --- | --- |
| One `<style>` element in `<head>` | API v1 has no separate CSS | `src/index.tsx` |
| A `keydown` listener on `window` while the page is mounted | There is no service for a page's own keys; it ignores keys typed in a box, with Ctrl, Cmd or Alt, and `Enter` on a button | `src/ui/Inbox.tsx` |
| Taking the focus into the list when it first appears | Opening a page leaves the focus on the sidebar entry, where `Enter` would open the page again. Skipped when a person is typing or a dialog is up | `src/ui/Inbox.tsx` |
| `scrollTop` for the list and the thread, a `ResizeObserver` | The list is drawn only for the rows in view (below) | `src/ui/Inbox.tsx` |
| `visibilitychange` | No polling while the window is hidden | `src/ui/Inbox.tsx` |
| `localStorage` | "Plugin-specific persistent data has no host API yet"; the token and the address live under `megatech.beeper.*` | `src/beeper/config.ts` |

Module evaluation must be pure: a module-level JSX constant broke every page in the first browser run (`React` is supplied by the host only in `apply`). The cure is a function.

## The list is windowed

The first version drew every chat row. With 12 chats the key to paint in the browser harness was a median of 11 ms and p99 26 ms over 480 keys; with 200 chats, a median of 18 ms and p99 78 ms (`u`, which redraws the list, had a median of 59 ms). The list now draws only the rows in view and six beyond each edge (`src/ui/window.ts`, rows are one fixed height), and the same 480 keys with 200 chats give a median of 14 ms and p99 29 ms. It costs a custom listbox: `aria-posinset` and `aria-setsize` on the options, `aria-activedescendant` on the list, and the highlighted row is brought into view by arithmetic rather than `scrollIntoView`.

## Measuring

Key to paint is the time from `keydown` reaching the window to the next frame (a message sent after `requestAnimationFrame`), the method of `docs/building.md` section 5. It does not include the time Beeper takes to hand over a chat's messages, which is `curl` and the network, after the key.

Headless Chromium in Buzz's web build (`test/web/beeper.spec.mjs`, last test), 200 chats, 480 keys in six kinds, one key at a time:

| | n | median | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| a key nothing listens to (the floor of this VM; 60 samples, so its p99 is its maximum) | 60 | 9 | 15 | 17 | 17 |
| all the plugin's keys | 480 | 14 | 23 | **29** | 40 |
| `u` (unread only, on and off), the slowest kind | 40 | 23 | 33 | 40 | 40 |

The test fails above a p99 of 50 ms over all the keys, and for each kind that has at least 100 samples.

### Real desktop app

The real Buzz desktop app on Linux (WebKitGTK with software rendering, on Xvfb, on a VM with two CPUs), with the key-probe plugin from this repository and `plugins/vim/test/real-app/lib.sh` to drive and read it, 200 chats in the fake, one key every 120 ms (typing: every 100 ms). Key to paint, ms:

| | n | median | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| a key nothing listens to (floor) | 100 | 9 | 18 | 19 | 19 |
| **`j` and `k` in the list** | 420 | 12 | 21 | **31** | 825 (one sample) |
| `j` after closing a chat | 30 | 12 | 19 | 21 | 21 |
| `Esc` on another page (host only) | 50 | 11 | 18 | 21 | 21 |
| `Tab` on another page: any move of the focus (host only) | 40 | 62 | 116 | 126 | 126 |
| `Tab` on the Beeper page | 40 | 60 | 113 | 123 | 123 |
| `r` (focus the reply box) and `Esc` (back to the list) | 80 | 65 | 86 | | 102 |
| `Esc`, `Esc` (box to list, then close the chat) | 60 | 65 | 78 | 80 | 80 |
| `Enter` (opens a chat and puts the cursor in the box) | 30 | 148 | 170 | 173 | 173 |
| typing in this plugin's reply box | 73 | 78 | 158 | 186 | 186 |
| **typing in Buzz's own message box (host control)** | 73 | 71 | 153 | 189 | 189 |

What this says, on this machine:

- The keys that only move the highlight (`j`, `k`, the arrows, and in the browser harness `u` and `/`) stay near the floor and inside 50 ms at the 99th percentile. One of 420 `j`/`k` samples was 825 ms; it did not recur in about 700 further keys of the other runs and the page was polling, so it was probably a pause of the app and not of the plugin, but it was not explained.
- **Anything that moves the keyboard focus costs about 60 ms in this app on this machine, with no plugin involved** (`Tab` on a page that has none: 62 ms). Typing in Buzz's own message box is no faster than typing in this plugin's: median 71 against 78 ms, and 189 against 186 ms at the maximum. So `Enter`, `Esc` and `r`, which move the focus, and typing, are at the host's floor here and over 50 ms; only the part above the floor is the plugin's (about 85 ms of the 148 for `Enter`, which also builds the chat pane; less than 10 ms of the typing). A GPU-composited Mac may well be far below this floor, but it was not measured: no Mac was available.
- Why the host itself is this slow here (software rendering on two CPUs is the likely reason) was not investigated. The same keys in the browser harness take 14 ms at the median and 29 ms at p99, together with all the others.

What was done about the part that is the plugin's: the reply box is its own component (a key drawn the box and also the whole chat before); the box is measured for its height only once typing pauses (and not at all where the browser has `field-sizing: content`), because measuring needs the page laid out; a bubble or a row is not drawn again when a poll brings the same message (an object that is equal is kept); a chat that is still loading does not read the layout. Typing went from a median of 150 ms to 78.

Memory over time (the 15-minute run of `docs/building.md`) was **not** done; the polling is a timer that stops when the page is left, and `test/web/beeper.spec.mjs` checks that disabling and enabling the plugin, and leaving and coming back to the page, leave the same listeners and exactly one `<style>`, and that no request is made while the page is away.

## What was verified

- `pnpm test`: 112 unit tests. The curl request builder (quoting, size, the status line), the client against the **real `curl`** and a fake Beeper (exact message delivery, wrong token, missing scope, refused connection, over-large and too-slow replies, proxy and curlrc ignored, only plain http), the store (polling cadence, paging, optimistic sends and their matching, stale replies after a token change or another chat, the one-miss tolerance), the address and token checks, the time formatting and the list window arithmetic.
- `test/run.sh`: 33 browser tests in Buzz's web build: the list, a chat, earlier messages, mark read, sending (exact text, sending state, refused send with retry and dismiss, too long, empty), read-only chats, drafts, keys, other pages ignoring the keys, a new message arriving, every problem state, the settings card (a wrong token is not kept, the token never in the page, console or any URL), the address check, light and dark, a narrow window, the long list, clean-up, and the key budget.
- The real Buzz desktop app on Linux: the folder installs, the review lists `curl` with its arguments, the settings card connects to the fake through the native command runner, the page lists chats, `j` and `Enter` open one, a reply with quotes and a backslash arrives intact, stopping the fake shows "Beeper is not running", starting it and pressing Check again recovers, and the plugin updates in place from the changed folder. Key timings above. These runs used the app's own profile, which holds other conversations, so no screenshot of the app is in this repository; the screenshots here are from the browser harness.
- Public-repository check: no internal names, hosts, addresses or real messages in the diff; every name in a fixture is a placeholder.

## What was not verified

- **Against a real Beeper Desktop.** None was available. Every Beeper shape is from the SDK. Run `scripts/probe.mjs`.
- macOS and Windows: the install review, the native command runner and `curl` there (macOS and Windows 10+ ship it; the app adds Homebrew's directories to the PATH on macOS).
- Beeper's own behaviour on a send: whether the text is rich-text converted ("Plain text and Markdown are converted to Beeper rich text", says the SDK), so a message with Markdown characters may arrive formatted.
- More than 200 chats (the list shows the 200 newest by activity), and very large threads (the first page only, plus "Load earlier messages").
- Memory over a long session (a 15-minute run).
- The 825 ms sample above.
- Beeper's menu path (above).

## Found in review

An independent review of the first complete version found these; each is fixed and has a test (`test/unit/store.test.ts`, `client.test.ts`, `format.test.ts`, `curl.test.ts`, `test/web/beeper.spec.mjs`), and each test was shown to fail with the fix taken out.

- A poll after the window had been hidden could leave a hole in the middle of a chat: it merged only the newest page into what was read before. The thread now starts again from the newest page when that page shares no message with what was read (`seen`), and a "load earlier" asked before that is dropped (`pageGeneration`).
- A chat was marked read in Beeper without its messages being shown, if they failed to load. Now only after they have loaded, and the poll marks it only while they are on screen.
- One chat that could not be read (a 500 from Beeper for that chat) flipped the whole inbox to the error page, over and over, because the failure counter was reset only by the chat list. Now only a failure to reach Beeper counts as one; a chat's own failure marks that chat.
- When the connection came back the page took the focus again, out of the reply box. It does so only the first time.
- A reply that failed after you had left its chat was lost without a word. A send now belongs to its chat, the list marks the chat "Not sent", and Try again sends to that chat.
- One message with a time that cannot be read crashed the page (`Intl` throws on an invalid date, in `dayLabel` and `sameDay`). They now ignore it.
- A DEL in a message (above).
- The stored address was checked only when typed (above); `--globoff` added.
- Enter that confirms an input-method candidate sent the half-written text on WebKit (it reports `isComposing` false and key code 229).
- Enter on an already open chat left a flag that took the focus on the next chat opened with the mouse.
- The window key listener now stays out of the way when a dialog is open and on AltGr.
- Changing the token while the page was not on screen asked Beeper anyway.
- The tests claimed more than they proved in places: "nothing reaches the service except through the declared route" had no test, the "no error carries the token" test constructed errors rather than causing them, and "no secret on the command line" read only the manifest. They now check that the page itself makes no request to Beeper, cause the real failures, and read the running curl's command line from `/proc`.

Not changed: sent messages are matched to Beeper's listing by id or by "mine, same text, not older than the send". The SDK has `GET /v1/chats/{id}/messages/{pendingMessageID}` for resolving a pending id, which would be better than matching text when Beeper rewrites a message; the plugin does not use it because what it answers for a pending id was not seen. Network colours and the page icon are fixed colours: a network's colour is data (a hue from its name, so it stays the same), and a plugin icon is a fixed image, as in the other plugins here; everything else is the host's theme (`docs/building.md` rule 2).

## Pitfalls hit

- A module-level JSX constant (above).
- `pkill -f` with a pattern that also appears in the shell's own command line kills the shell; use `pgrep -f 'x[y]z'`.
- `Enter` on a button: a window-level `Enter` handler that opens the highlighted chat also fires for a focused Refresh or Settings button and swallows its click. The handler skips targets inside `button, a`.
- The fake's list endpoint honours `limit`: with 200 chats and a merged shell the page asks for 200 and one is cut.
