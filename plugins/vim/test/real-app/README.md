# The real-app measurement

The same test, run before and after a change, on the real Linux app: page-process memory over time, and how long the first
keys take after entering a list, with the Vim plugin on and off. The browser specs in `..` (`perf.spec.mjs`, `leak.spec.mjs`,
`idle.spec.mjs`) measure Chromium on a fixture; this is the app a user runs (WebKitGTK, software rendering on the test VM).

## What it needs

- The Buzz desktop app running on an X display (here Xvfb `:99`). `START_BUZZ` names your script that starts it, and
  `BUZZ_SESSION_ENV` (optional) a file to source that sets `DISPLAY` and the session bus. Signed in, with two channels in the sidebar: a short one first and a long one (hundreds of
  messages) second. The window at 0,0, 1200x800, nothing else on screen, no dialog open.
- `xdotool`, `xclip`, `scrot`, `python3`.
- The Vim plugin installed from `plugins/vim/` (Settings → Plugins → Add → Browse), and the key probe: `./plugin.sh install-probe`.
- Nothing else running on the machine during a run (2 CPUs: a test run or a build changes the numbers).
- No secrets: the scripts read no key or token and never print a process's arguments; the app's command line holds the signing key.

## Run it

```sh
export START_BUZZ=~/bin/run-buzz-app BUZZ_SESSION_ENV=~/.buzz-app-env   # your own script and env file
plugins/vim/test/real-app/run.sh /tmp/before before 900     # about 45 minutes: the key scenarios, 15 min idle with the plugin, 15 min without
                                                    # (background it for a long run: setsid nohup ... >/dev/null 2>&1 </dev/null & disown)
# ... change the plugin ...
plugins/vim/test/real-app/run.sh /tmp/after after 900
```

or the pieces: `plugin.sh update|toggle|install-probe`, `keys.sh OUTDIR LABEL first-j|first-scroll|typing|normal…`,
`rss.sh OUT SECONDS [EVERY]`, `check.sh` (is the installed code the work tree's?). `summary.py rss|keys FILE…` prints the numbers again.

## What it measures

| File | What | How |
| --- | --- | --- |
| `plugins/key-probe/` | key → paint: from `keydown` reaching the window to the frame after it | A separate plugin, so it works with Vim mode off and does not change when Vim mode is refactored. Ctrl+Alt+Shift+D copies the samples as JSON, Ctrl+Alt+Shift+X resets |
| `keys.sh first-j` | the first `j` presses in a list that has just been entered | Restart the app (a list is coldest right after launch), `[` then `]` (a channel away and back), `gg`, then `j` ×100 at one key per 120 ms; three restarts, one file each. Only the rows the page has mounted (20 or 21 on the channel it was written on; 6 once the newest messages were tall) are list moves: the next `j` goes past the newest message and focuses the message box, and the rest are caret moves in the empty box. `summary.py` reports the first 35 keys against the rest, and the list moves, the step into the box and the box keys apart |
| `keys.sh first-scroll` | the control: the host's own scrolling over the same rows, plugin on or off | Restart the app (three times, one file each), a click on each channel, a click in the list, Home (the top of the loaded history, where `gg` goes), then the Down arrow ×100 at one key per 120 ms |
| `keys.sh typing` | typing 73 characters in the message box | One key per 100 ms. The editor's cost, with and without the plugin |
| `keys.sh normal` | `w` `b` `0` `$` ×50 each in NORMAL in the box | One key per 80 ms (Vim mode only) |
| `held.sh` | memory under held keys (not part of `run.sh`) | `held.sh OUTDIR LABEL SECONDS vim` cycles `g g j j j k k k G k k k j j j` at one key per 120 ms inside the mounted rows, so the cursor moves on every key; `… host` (Vim mode off) cycles the host's own Home, Down, Up and End the same way. Page and host RSS every 30 s, as `rss.sh` |
| `rss.sh` | the page process's and the app's resident memory | Every 30 s; first and last sixth of the samples, range, slope |

The Vim plugin's own trace (`Performance trace` on its page) stays **Off** during these runs: it wraps DOM calls and would be
measured too. Turn it on only to find where a slow key spends its time.

## Notes

- The click places are screen pixels for the test VM's layout (window at 0,0, 1200x800): the profile menu, the Plugins entry,
  the Vim mode row, the buttons in its panel, the two channel rows (they sit one row lower while the plugin is on, because it adds
  a "Vim mode" sidebar entry), the message list, the message box. `plugin.sh` and `keys.sh` name them at the top; move them for another layout.
- `plugin.sh install-probe` needs the GTK folder chooser to have the keyboard: there is no window manager, so it focuses the
  chooser's window itself (the newest window titled "Choose a plugin folder"; older ones linger unmapped).
- A "Ready to update!" toast over Settings covers some buttons: dismiss it with its ×, never "Update now".
- **What the first numbers were** (an early version of the Vim plugin, a 2-CPU Linux VM): after a restart the first 35 `j` presses took a median of 126–154 ms (p95 348–434, max 387–482), the next 65 a median of 8 ms (p95 17); the host's own Up-arrow scrolling of the same list: median 16 ms, p95 27–30, max 69–75, plugin on or off; typing 73 characters: median 70 ms, p95 141–145, plugin on or off; `w` `b` `0` `$` in NORMAL: median 12 ms, p95 20.
- Start from the channel's Messages page with an empty message box: the app comes back on the page it was left on, and a draft or a focused field sends the first keys somewhere else (`j` types into the box). Clear the box (click it, Ctrl+A, Backspace) after any run that typed.
- Numbers move a little with each run (the page process swings ±40 MB as the engine collects, and one in twenty keys is a
  slow frame). Compare medians and the first-35 against the rest, not single values.
