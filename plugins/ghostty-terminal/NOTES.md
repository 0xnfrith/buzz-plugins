# Ghostty terminal for Buzz: what the plugin API reaches, and what was and was not verified

This is the working record of a prototype. The plugin itself is the source in this folder; it is built by hand and never committed (see the README).

Everything below about Buzz was read from block/buzz-app at the tag `v1.0.2` (`51d63954`), checked again at `main` (`4a87b5cc`, 36 commits later, 2026-11-13) and, for the behaviour the tests depend on, at `d92bfb2c`, the commit the other plugins in this repository are tested against. Paths and lines are v1.0.2. None of the files cited changed between v1.0.2 and `main`. At `d92bfb2c` the behaviour is the same (the lines differ) except that `BUZZ_VERSION` and the PATH read from the login shell (`host_command.rs`) are newer than it. That was checked for the pipes, the lossy decoding, the stripping of `BUZZ_*` and `NOSTR_*`, the argument limits, the review's wording and the CSP; the browser suite runs at `d92bfb2c` and passes.

## What a plugin can do, and why the plugin looks the way it does

| Question | Answer | Where |
|---|---|---|
| Where can a terminal live? | A channel panel with a header launcher, placed `bottom` (the default), `side` or `tab`; or a page; or a top-bar launcher. Buzz's own Terminal is the first kind. The panel gets `channelContext` = `{ scope, channelId, channelName, viewer, relayUrl, threadId? }`. | `src/features/panels/service.ts:28-35,53,65-79`; `docs/plugin-authoring-guide.md:59-60` |
| Can a plugin run a shell? | Yes, with a declared `host.processes` entry and `ctx.host.spawn`, on the desktop only. In the web build `spawn` throws "Processes require an installed desktop plugin". | `docs/plugin-authoring-guide.md:126`; `src/features/host/service.ts:388-394` |
| PTY or pipes? | **Pipes.** stdin, stdout and stderr are all piped; the child has its own process group and no controlling terminal. Buzz's only PTY code is its private native Terminal. | `src-tauri/src/host_process.rs:649-651,581`; `src-tauri/src/terminal/unix.rs:3,104` |
| How do bytes move? | Output is read 64 KiB at a time and decoded as UTF-8 text, with U+FFFD for bad bytes, one channel event per read. Input is text, one IPC call per write, in pieces of 256 Ki UTF-16 units. | `host_process.rs:58,855-866`; `service.ts:150,399-441` |
| Environment | The app's own environment, less `BUZZ_*` and `NOSTR_*`, plus what the plugin passes, then `BUZZ_VERSION`. Nothing else is scrubbed. | `host_process.rs:607-625` |
| Limits | At most 16 processes; a bare program name of at most 80 bytes; at most 16 declared arguments of at most 1024 bytes each; at most 256 caller arguments; a plugin file of at most 8 MiB. | `crates/plugin-manager/src/lib.rs:22,190-205,252`; `host_process.rs:432` |
| WASM | The renderer's CSP is `script-src 'self' blob: 'wasm-unsafe-eval'`, so WebAssembly compiles. `connect-src` has no `data:`, so a WASM inlined as a data URL must be decoded in JS, not fetched. | `src-tauri/tauri.conf.json:31` |
| Install review | One block per process: "Start python3", the hint "Can start a background process with additional arguments, using your account's full access", and the program and **every argument in full**. | `src/app/PluginAccessReview.tsx:21-47,168-200` |
| Buzz's own PTY | The commands `terminal_*` are granted to the whole webview, so any plugin code could call them. No install review would show it. The build refuses a bundle that names them. | `src/bundled/terminal/bridge.ts:28-46`; `src-tauri/capabilities/default.json:194-200` |
| Keys | The shortcut dispatcher skips editable targets. Buzz's Terminal has a private handoff ("not an injected/exported plugin capability"); a plugin does not. | `docs/plugin-architecture.md:3358-3455`; `src/features/shortcuts/terminal-key-event.ts:1` |

That is why there is a bridge: `python3 -I -c "import sys;exec(sys.argv[1]+sys.argv[2]+sys.argv[3])"` plus three slices of `src/bridge.py`. The bridge is longer than one 1024-byte argument. It was shortened as far as it would go while keeping what the first review of the plan required (a hang-up before a kill, a paste that cannot stall it, an allowlist for the environment): 1,352 bytes at first, 1,114 after every cut that kept it readable, against 1,024. Two slices held it until the first review of the code found that it did not notice a shell exiting while a background job still held the terminal; the fix, a last drain of output, signal statuses and named variables took it to 2,426 bytes, which is three slices of 827, 643 and 956 bytes, cut at blank lines. It was not minified, compressed or encoded to fit.

## What is tested, and what that proves

`pnpm test` (unit, on Linux and macOS in principle; CI runs Linux):

- **The bridge, on a real PTY**, started by `test/host-sim.mjs`, which copies the host's rules from the files above: a tty and the plugin's `TERM`; extra arguments ignored; the size set from the plugin's message; the shell's exit status after its last output; python's isolated mode (with a control that shows the decoys *would* be imported without `-I`); the environment against a control run; a 2 MiB paste through `cat` byte for byte; bytes that are not UTF-8 returned unchanged through reads cut at random offsets; hang-up on SIGTERM, on end of input and on SIGKILL of the bridge; a shell that ignores the hang-up killed after 2 s; a shell that exits while a background job holds the terminal noticed within a second, with its last output and status; a signal death reported as 128+N; `SHELL` set to the shell that runs; only named `BUZZ_` variables kept; a `setsid` job that survives (said in the README); a bad line failing loudly. The shutdown and paste tests were each run against the prototype's flaws and fail on them.
- **The manifest** is what `scripts/manifest.mjs` makes from `src/bridge.py`, the three slices joined are the file byte for byte, each fits 1024 bytes, the loader joins exactly them by index, and nothing else is asked for under `host`.
- **The host simulator itself**, rule by rule.
- **The bundle** (`scripts/check-bundle.mjs`): the pinned WASM exactly once, the MIT notices, no name of Buzz's terminal commands and no Tauri IPC, no dynamic code, under 8 MiB.
- **What the terminal answers on its own.** The WASM in ghostty-web 0.4.0 replies to exactly two queries, DSR 5 and DSR 6, each a fixed shape made of digits. Title and icon reports, DECRQSS, XTGETTCAP, colour and clipboard queries, device attributes and the rest get no reply, so a program's output cannot make the terminal type text into the shell. Held to the pinned WASM's hash.

`test/run.sh` (browser, 11 tests, headless Chromium against Buzz's own production web build at `d92bfb2c`): the launcher, the drawer and the shortcut; a shell on a tty whose output is drawn on the canvas; the environment against Buzz's context and the app's other variables; hide and reopen; resize; restart, end and an exited shell; disabling the plugin hangs up the shell; replies; links (with the click guard removed the test fails, and `window.open` is called); a 600 KB paste whole.

### What none of that proves

The web build has no `ctx.host.spawn`, no content security policy and no install review. So these are **not** verified, and nobody here can run the desktop app:

- the real Tauri channel: ordering, and how fast it is;
- the Git importer accepting the manifest, and the install review's wording;
- the desktop CSP in the real webview: the WASM is decoded in JS because of what `connect-src` lists, but it has not been run under that policy;
- `python3` on a Mac: the system one may only ask for Apple's developer tools;
- the PATH and login shell on a Mac, and macOS PTY behaviour;
- any of it on Windows (there is no support).

## Speed

`test/bench` feeds the same 16 MB of coloured, UTF-8 output, in 64 KiB chunks and one task per chunk, to this plugin's terminal and to xterm 6.0.0 with the DOM renderer, which Buzz's Terminal uses (`docs/terminal.md`). Three runs, headless Chromium on a Linux VM:

| Emulator | Open | 16 MB | Throughput | Echo, to the second frame |
|---|---|---|---|---|
| xterm 6.0.0, DOM renderer | 13-15 ms | 2.8-3.1 s | 5.2-5.7 MB/s | 33 ms (p50), 35 ms (p99) |
| ghostty-web 0.4.0, canvas | 31-34 ms | 2.05-2.1 s | 7.6-7.8 MB/s | 33 ms (p50), 37 ms (p99) |

This is the **render path alone**: parsing and drawing what has arrived. It says ghostty-web keeps up about 1.4 to 1.5 times faster here, opens slower (the WASM is compiled on first use) and is not slower to echo (both are at two animation frames, which is as fine as that test can see). It does not include the bridge, base64, the host's text decoding, the Tauri channel or one IPC call per key, which is where a terminal in a plugin is most likely to lose time. Buzz's own Terminal reads raw bytes from a native PTY; this plugin cannot. The README therefore makes no speed claim. A run on a Mac decides it.

## Decisions worth knowing

- **Drawer first**, not a top-bar page: it is the placement that knows the channel and thread, which the environment needs.
- **The allowlist is Buzz's own Terminal's**, `SSH_AUTH_SOCK` included in what is dropped, as decided for this prototype.
- **No links.** The alternative, letting only `https` through, needs to patch ghostty-web's source; a capture-phase click guard needs no patch and is stricter.
- **No source patch of ghostty-web at all** except removing one unused string: the library carries a second copy of its WASM for its own loader (564 KB), which this plugin never calls, because it builds the terminal from the instance it made itself. The build removes that copy and fails if ghostty-web stops having exactly one.
- **Replies to the shell are not filtered**, because the pinned WASM sends none that echo text, and a test holds it to that.

## For the change that ships it

Not done here, on purpose:

- a run in the desktop app, on a Mac without Apple's developer tools; the `sha256` of the exact `plugin.js` it ran, which that change commits;
- the licence of every component linked into `ghostty-vt.wasm` (see THIRD_PARTY_NOTICES.md);
- a committed `plugin.js`, the icon and the install steps, and the CI check that `plugin.js` is the build of `src/`;
- the `host.processes` rules in `.github/plugin-assets/check.mjs` (it checks none of them; here a unit test holds this one manifest to them).
