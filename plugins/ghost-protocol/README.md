# GHOST Protocol

The Buzz side of GHOST Protocol: screens for an agent that runs in Docker on your own computer. It holds no agent key, stores no Claude token and has no agent logic; all of that stays in GHOST Protocol itself, which the plugin will drive only through the `docker` command.

**This first version does one thing.** It has one page, **GHOST Protocol**, that runs `docker version --format {{.Server.Version}}` and shows the Docker server's version. When Docker is not installed or not running, it says **Install or start Docker Desktop**. Creating and managing an agent comes in later versions.

## What it does

- A page, **GHOST Protocol**, in the page navigation. When you open it, the plugin runs the one command above and shows what Docker answers:
  - **Docker is running**, with **Docker version** and the version, when the command exits 0 and prints a version;
  - **Install or start Docker Desktop**, when the command exits with anything else, when there is no `docker` on the computer's PATH, when Docker does not answer in 15 seconds, or when it exits 0 with something that is not a version.
- **Check again** runs the command again, for after you start Docker Desktop. Leaving the page while Docker has not answered stops the command.
- It needs Docker (Docker Desktop on macOS and Windows) with `docker` on the PATH that Buzz gives a plugin's programs. It does not start Docker, install anything or change anything.

## What it asks for

The install review shows what a plugin asks of your computer. For this one it must show exactly this, and nothing else:

| Program | Arguments |
| --- | --- |
| `docker` | `version`, `--format`, `{{.Server.Version}}` |

One program, named plainly (no shell, no path), with its arguments fixed in the manifest. No network address, no files, no other commands. The plugin passes the command no arguments of its own, so nothing typed on the page, or read from anywhere, can reach its command line. **If the review shows anything else, do not install it.**

As with every plugin, a declared program runs with your full access and is not sandboxed; the review says so.

## How to install

Copy and paste: in **Settings → Plugins → Manage plugins → Add**, put this in **Git or GitHub repository**, press **Find** and pick **GHOST Protocol**:

```text
https://github.com/0xnfrith/buzz-plugins
```

To install the last version that passed the checks instead, put its tag in **Branch or tag** first ([what a tag means](../../docs/known-good.md)):

```text
good/ghost-protocol
```

Then read the review (above), press **Install plugin**, and open **GHOST Protocol** in the page navigation. The desktop app is needed: the browser build cannot install plugins, or start a program.

## Check it on your computer

The plugin has not been run in the Buzz desktop app yet; a run on a real Mac is the check it is waiting for. If you try it, these are the steps, and what to write down:

1. Start Docker Desktop. Open **GHOST Protocol**: it should say **Docker is running** and show the version. Compare it with `docker version --format '{{.Server.Version}}'` in a terminal.
2. Quit Docker Desktop, press **Check again**: it should say **Install or start Docker Desktop**. Start Docker Desktop again, press **Check again** until it shows the version.
3. If Docker Desktop is running and the page still says **Install or start Docker Desktop**, write down `which docker` from a terminal and how you started Buzz: the plugin finds `docker` on the PATH Buzz gives it, and a Buzz started from the Dock may not have the one a terminal has.
4. Write down the macOS version, the Buzz version, and a screenshot of the install review.

## What was and was not checked

| | |
| --- | --- |
| Unit tests (`test/unit`) | The manifest declares exactly that one program and those arguments, and Buzz's rules for a program and this repository's rules for a manifest pass. The check, with a stub standing in for the host's `spawn`: a version shows on success; a non-zero exit, a missing `docker`, an empty or malformed answer, a silent Docker and a host with no `spawn` each show their words; the process is stopped when the time is up or the caller leaves. |
| Browser suite (`test/web`) | The built plugin runs in Buzz's own production web build, in headless Chromium, at the commit `BUZZ_APP_REF` pins. The page is opened from the navigation, and each way the command can end is drawn and read as a person would: the version, the Docker Desktop text, **Checking Docker…**, **Check again**, the plugin leaving, light and dark text contrast, and removal of the styles when the plugin is disabled. It asserts that the plugin asks the host for the declared process only, with no arguments of its own. |
| **Not covered** | **Starting a process is desktop only, so the browser suite replaces the host's `spawn` with a stub that scripts what `docker version` prints and how it exits. Nothing in CI runs `docker`, runs the plugin in the Buzz desktop app or imports it through the Git importer.** A run in the desktop app is not built yet. |
| Platforms | **macOS:** not run yet. **Linux:** should work, not run. **Windows:** not checked; whether Buzz can start `docker` there has not been tried. |

The pipeline, for a change to this folder: `.github/workflows/ghost-protocol-tests.yml` runs the type check, the unit tests, a check that the committed `plugin.js` is the build of `src/`, the tests of the fake `docker` (`test/fake-docker`, when it exists) on Linux and on macOS, and the browser suite. `all-tests` waits for it.

## Tests

```sh
corepack pnpm@12.16.1 install --frozen-lockfile
corepack pnpm@12.16.1 exec tsc          # type check
corepack pnpm@12.16.1 test              # unit tests
corepack pnpm@12.16.1 run build         # writes plugin.js, which is committed
plugins/ghost-protocol/test/run.sh /path/to/block/buzz-app   # the browser suite; the app checkout needs its own install
```

`plugin.js` is committed beside `manifest.json`, because Buzz installs from a repository and never runs a build; CI fails a change whose `plugin.js` is not the build of its source.

## Licence

This plugin is Apache-2.0 like the rest of the repository; the licence text is in [LICENSE](LICENSE). It bundles nothing: `plugin.js` is the source in `src/`, built.
