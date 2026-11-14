# Ghostty terminal for Buzz (prototype)

A terminal in a channel's drawer, drawn by [ghostty-web](https://github.com/coder/ghostty-web) (Ghostty's terminal engine compiled to WebAssembly). It starts your login shell with the channel's Buzz context in its environment.

**This is a prototype, and it is not offered for install.** Buzz's importer lists a folder only when it has a built `plugin.js` beside its `manifest.json`. This folder has none on `main`, because a build is never committed here, so the importer shows it under "Folders skipped". Do not install it from `main`. To try it, build it yourself, as below.

It is a prototype because nobody has run it in the Buzz desktop app yet. Everything it was tested with is in Buzz's *web* build with a stand-in for the part the web build lacks. [NOTES.md](NOTES.md) says exactly what that proves and what it cannot.

## What it does

- A button in the channel header, and **Cmd+Shift+J** (Ctrl+Shift+J elsewhere), show a terminal drawer for that channel. Hiding the drawer keeps the shell and its scrollback; showing it again attaches the same terminal. One shell per community and channel.
- **Restart** hangs up the shell and starts a new one. **End** hangs it up and leaves none. Disabling the plugin, or closing Buzz, hangs up every shell.
- The shell is your account's login shell (the one in the password database, started as a login shell), in your home folder, on a real terminal (a PTY). If it exits while a background job is still running, the drawer still says so; the job is not hung up.

### The shell's environment

The plugin passes `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=Buzz`, and Buzz's public channel context, the same variables Buzz's own Terminal sets: `BUZZ_CHANNEL_ID`, `BUZZ_CHANNEL`, `BUZZ_NPUB`, `BUZZ_RELAY_URL`, and `BUZZ_THREAD_ID` when a thread is open. A value that does not check out is left out rather than passed.

The bridge then drops everything else Buzz was started with. It keeps `HOME USER LOGNAME LANG LC_ALL LC_CTYPE TZ TMPDIR PATH` (Buzz's own Terminal's list), the variables above by name (`BUZZ_VERSION` too), and no other `BUZZ_` name; it sets `SHELL` to the shell that runs. Two consequences:

- **`SSH_AUTH_SOCK` is dropped, so `git` over an SSH agent does not work in this terminal**, as in Buzz's own Terminal.
- `PATH` is the one Buzz gives a plugin's process (on macOS it includes the one your login shell sets up); your shell's startup files can add to it.

### Why there is a Python bridge

A plugin that starts a process gets pipes, not a terminal, and Buzz's own native terminal is not available to plugins. So the manifest declares one process, `python3`, that runs [src/bridge.py](src/bridge.py): it puts your login shell on a PTY and passes bytes between it and the plugin. The text of that file is copied, byte for byte, into `manifest.json`, so **the install review shows it in full**. It is run as `python3 -I -c "import sys;exec(sys.argv[1]+sys.argv[2]+sys.argv[3])" <first> <second> <third>`: `-I` is python's isolated mode, and the fixed loader joins exactly the three slices and ignores any argument Buzz adds after them. (Buzz allows 1024 bytes in an argument and the bridge is about 2.4 KB, so it is cut at blank lines.) It reads no arguments, runs only your login shell, and takes no input but its own lines on stdin.

It needs `python3` 3.9 or newer.

## Try it on your computer

You need Node 22 or newer and `python3`. From this folder:

```sh
corepack pnpm@12.16.1 install --frozen-lockfile
corepack pnpm@12.16.1 run build
shasum -a 256 plugin.js
```

Then in Buzz: **Settings → Plugins → Manage plugins → Add**, choose to load a **folder**, press **Browse**, and pick this folder. Read the access it asks for before you press **Install plugin**. It should list one process: `python3` with the arguments `-I`, `-c`, a one-line loader, and three blocks of Python that are the text of `src/bridge.py`. It asks for nothing else (no commands, network or files). If it shows anything else, do not install it.

### What to check, and write down

For a run in the desktop app (it is the run this prototype is waiting for):

1. The macOS or Linux version, and `python3 --version`. On a Mac without Apple's developer tools, the system `python3` may only ask to install them instead of running; if so, note exactly what happens.
2. The `shasum` of the `plugin.js` you built, and a screenshot of the install review.
3. Open a channel, press the header button, and type: `env | grep -E 'BUZZ|TERM'`, then `stty size`.
4. Full-screen programs (`vim`, `htop`, `less`), Ctrl+C, resizing the drawer, hiding and reopening it, changing channel or thread, **Restart**, **End**, and disabling the plugin in Settings (the shell must go).
5. Speed, against Buzz's own Terminal (Cmd+J) in the same channel: `time seq 1 2000000` and `time cat` of a large text file. The plugin's [NOTES.md](NOTES.md) has what was measured here and why it does not settle this.

## Limits

- **Links are not opened.** ghostty-web opens a Ctrl- or Cmd-clicked link with `window.open`, whatever its scheme, and the program that printed it chose the scheme. A click guard stops it. (ghostty-web 0.4.0 also does not expose an OSC 8 hyperlink's target, so only URLs it recognises by shape are links at all.)
- While the terminal has focus it keeps every key for the shell, except Cmd/Ctrl+Shift+J, which hides it. Buzz's other shortcuts work once you click outside the terminal. Buzz's own Terminal has a private way round this that plugins do not get. If you rebind the toggle in Settings, the new chord works outside the terminal and the default still works inside it.
- A job that leaves the terminal's session (`setsid`, or a program that daemonizes) is not hung up when the terminal is: it survives, as it would in any terminal.
- The theme is fixed (dark) and the font is the system monospace; Buzz's Terminal settings do not apply.
- Linux and macOS only, like Buzz's own Terminal. No Windows.
- There is no speed claim until the run above has numbers.

## Tests

```sh
corepack pnpm@12.16.1 test            # type check separately: pnpm exec tsc
plugins/ghostty-terminal/test/run.sh /path/to/block/buzz-app   # the browser suite; the app checkout needs its own install
corepack pnpm@12.16.1 run bench:build && node test/bench/run.mjs /path/to/block/buzz-app
```

The unit tests start the real bridge on a real PTY. The browser suite runs the built plugin inside Buzz's web build, at the commit the other plugins are tested against, with a simulator for the host's `spawn`. CI runs both (`.github/workflows/ghostty-terminal-tests.yml`).

## Licence

This plugin is Apache-2.0 like the rest of the repository. It bundles ghostty-web, which is MIT; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which also says what has not been checked.
