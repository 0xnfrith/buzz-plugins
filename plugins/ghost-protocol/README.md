# GHOST Protocol

The Buzz side of GHOST Protocol: screens for an agent that runs in Docker on your own computer. It holds no agent key, stores no Claude token and has no agent logic; all of that stays in GHOST Protocol itself, which the plugin drives only through the `docker` command.

**This version has two parts.** A check of Docker, and a **status screen** for one agent: what GHOST Protocol says about itself, and four buttons. Creating an agent comes in a later version.

## What it does

- A page, **GHOST Protocol**, in the page navigation. It has a **Docker** panel: it runs `docker version --format {{.Server.Version}}` and shows **Docker is running** with the server's version, or **Install or start Docker Desktop** when the command fails, when there is no `docker` on the computer's PATH, when Docker does not answer in 15 seconds, or when it exits 0 with something that is not a version. **Check again** runs it again.
- An **Agent** panel with one field, **Agent name in Docker**, and **Show status**. The name is the agent's `<slug>`: lower-case letters, digits and `-`, starting with a letter or a digit, up to 40 characters. The agent's container is `gp-<slug>`. Anything else is refused before any command is built.
- The **status screen** for that agent, which asks `docker exec gp-<slug> gp status --json` at once and again about every ten seconds, for as long as it is on the page (leaving the page stops it, and any command it was running). It shows:
  - the **state**: *Waiting for a Claude sign-in* (`needs-claude`), *Waiting for the owner's attestation* (`needs-auth-tag`), *Connecting to the relay* (`connecting`), *Running*, *Updating* or *Error*, and for an error its code and message;
  - the **version**, the **relay** address and what the relay said (*Connected*, *Refused: not a member*, *Cannot be reached*), whether **Claude** is signed in, whether an **update** is available and to which version, and the **previous version** to go back to;
  - when the relay refuses the agent (`refused-not-member`): the interface note's text, "Your relay does not accept owner attestations. Ask its admin to turn them on, or to add this agent as a relay member.", with the agent's public key and a **Copy** button;
  - when `interface` is a number the plugin does not know: only "Update this plugin, or update GHOST Protocol", with no buttons. It keeps looking, so it recovers by itself once GHOST Protocol or the plugin is updated.
- When `docker exec` fails, `docker inspect --format {{.State.Status}} gp-<slug>` says why: the container is **stopped** (with **Restart**), there is **no such container**, the container runs but GHOST Protocol **did not answer**, or Docker itself is not there. When the last status said `updating`, or an **Update** or **Roll back** was taken from this screen and no status with another version has arrived since, a container that is missing, stopped, or running without an answer is shown as still updating, for up to two minutes from the first look that found it so; after that the screen shows what it found. An update swaps the container, and for a few seconds it is not there; a swap can be quicker than the ten seconds between two looks, which is why a request counts as well as a status. A request that is over without a new version (the update was seen, and the agent is back on the old version) stops counting.
- Four buttons, each one `docker` call:
  - **Update**: `gp update request`. The agent finishes its task first, then updates. When there is nothing to take, or an update is already under way, the screen says so. When the agent has no update helper (`no-updater`), the button gives way to the three steps to update by hand, each in its own copy box, with the image the container was made from and the new version filled in. Those steps are provisional: GHOST Protocol's side fixes their final text, and they are one constant in `src/update-by-hand.ts`.
  - **Roll back**: `gp update rollback`, disabled while there is no previous version.
  - **Restart**: `docker restart gp-<slug>`. **Stop**: `docker stop gp-<slug>`.
- It needs Docker (Docker Desktop on macOS and Windows) with `docker` on the PATH that Buzz gives a plugin's programs, and an agent whose container GHOST Protocol started. It does not start Docker, install anything, or create or remove an agent or its data.

**Why a name field, and not the agent's own panel.** Buzz lets a plugin add a tab to an agent's panel (`ctx.agents.registerTab`, with `when` choosing which agents get it), and that works for an agent whose type a plugin registered. This plugin registers no agent type yet: the form that creates one comes later, and with it the agent's name, which the tab would need to find the container. Until then the screen is on the plugin's page and takes the name. It is one component that takes a `<slug>`, so the tab is a small change once the form exists.

## What it asks for

The install review shows what a plugin asks of your computer. For this one it must show exactly this, and nothing else:

| Program | Arguments |
| --- | --- |
| `docker` | none declared: the plugin passes them each time it asks |

Buzz words it as *Process docker: Start docker*, "Can start a background process with additional arguments, using your account's full access", and "Allows further arguments and standard input, with your account's full access". That is true: the manifest names the program and fixes no argument, so what `docker` may be asked is decided by this plugin's code, and the review cannot list it. This is the list. The plugin never asks `docker` anything else, and the only part of any argument it does not fix is the agent's name, which it has checked first (see above); nothing GHOST Protocol or Docker prints becomes an argument.

| When | `docker` is asked |
| --- | --- |
| The page opens, and **Check again** | `version --format {{.Server.Version}}` |
| Every ten seconds, while an agent's status is shown | `exec gp-<slug> gp status --json` |
| The status call fails | `inspect --format {{.State.Status}} gp-<slug>` |
| **Update** | `exec gp-<slug> gp update request`, and when the agent has no update helper, `inspect --format {{.Config.Image}} gp-<slug>` |
| **Roll back** | `exec gp-<slug> gp update rollback` |
| **Restart**, **Stop** | `restart gp-<slug>`, `stop gp-<slug>` |

None of them writes to a process (no `-i`), and none runs a shell. The plugin never writes a file, never opens a network connection of its own, and holds no token. It does not start the update helper, or any container: **Update** only asks the agent. A declared program runs with your full access and is not sandboxed, as the review says. **If the review shows anything else, do not install it.**

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
4. With a GHOST Protocol agent running as `gp-<name>` (the image is not released yet), type `<name>` in **Agent name in Docker**, press **Show status**, and compare the screen with `docker exec gp-<name> gp status --json` in a terminal. Press **Restart**, then **Stop**, then **Restart** again, and watch the screen follow. Press **Copy** on a refused relay's key and paste it somewhere.
5. Write down the macOS version, the Buzz version, and a screenshot of the install review.

## What was and was not checked

| | |
| --- | --- |
| Unit tests (`test/unit`) | The manifest declares exactly the one bare `docker` process, and Buzz's rules for a program and this repository's rules for a manifest pass. The check of Docker, with a stub standing in for the host's `spawn`. The status parser: every `state`, `relay` and `claude` value, an unknown interface, a status over several lines, and every field missing or of the wrong kind. Every call the plugin makes, to the letter, and that only a checked name goes into one. The look at an agent, **run against the fake `docker`** (below): every state, relay value and error, a stopped and a missing container, Docker down, and the two-minute gap while an update swaps the container (the minute before it, the moment it ends, and a gap that never does). The four buttons against the fake: each answer GHOST Protocol and Docker can give, and the steps to update by hand. |
| The fake `docker` (`test/fake-docker`) | A fake `docker` written from the interface note, which answers every command above and the failures around them, so none of this needs the GHOST Protocol image. It is for tests only; its README lists what it assumes where the note is silent. The unit tests start it as a process and the plugin reads what it prints. |
| Browser suite (`test/web`) | The built plugin runs in Buzz's own production web build, in headless Chromium, at the commit `BUZZ_APP_REF` pins. The page is opened from the navigation. The status screen is drawn for every `state`, every `relay` value, an unknown interface, a stopped, a missing and an unreachable container, the update gap and its two-minute end, and each button's answers, with the page's clock moved by the test for the ten-second look. It asserts that the plugin asks the host for the declared process only, with the calls in the table above, and that the fake never refused one. Light and dark text contrast. |
| **Not covered** | **Starting a process is desktop only, so the browser suite replaces the host's `spawn` with a stub that runs the fake `docker` in Node. Nothing in CI runs a real `docker`, a real GHOST Protocol, the plugin in the Buzz desktop app or the Git importer.** A run in the desktop app is not built yet. The clipboard is the browser's (`navigator.clipboard`, then the older copy command): whether the desktop app's webview on macOS allows it has not been tried. |
| Platforms | **macOS:** not run yet. **Linux:** should work, not run. **Windows:** not checked; whether Buzz can start `docker` there has not been tried. |

The pipeline, for a change to this folder: `.github/workflows/ghost-protocol-tests.yml` runs the type check, the unit tests, a check that the committed `plugin.js` is the build of `src/`, the tests of the fake `docker` (`test/fake-docker`) on Linux and on macOS through `test/fake-docker-tests.sh`, which fails when that folder has no test file or a test fails or is skipped, and the browser suite. `all-tests` waits for it.

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
