# AGENTS.md: GHOST Protocol, from Buzz

For an agent that helps a person get a GHOST Protocol agent running from the Buzz desktop app, or that works on this plugin. The rules for every change in this repository are in the [root `AGENTS.md`](../../AGENTS.md).

The plugin is screens and `docker` commands only. GHOST Protocol itself is one container image, from [0xnfrith/ghost-protocol](https://github.com/0xnfrith/ghost-protocol). The plugin makes that container from Buzz's **New agent** dialog and shows its status.

## What the person needs before anything else

1. **The Buzz desktop app**, signed in to a community. The browser build cannot install plugins or start a program.
2. **Docker** (Docker Desktop on macOS and Windows), running.
3. **A paid Claude plan:** Pro, Max, Ultra, Team or Enterprise. The free plan does not include Claude Code. The agent signs in with a setup token from `claude setup-token`, or at an address it shows. GHOST Protocol takes no API key.
4. **A relay with owner attestations on.** Buzz signs the owner's attestation, and the relay accepts it only when owner attestations are on (`BUZZ_ALLOW_NIP_OA_AUTH=true`, **off by default**). The relay must have owner attestations on: a relay without it is not supported yet. Without it, the agent is refused ("not a relay member") and never runs. The one cure is for the relay's admin to turn owner attestations on, then restart the agent, or wait about a minute. The same refusal has one other cause: the owner key that signs the attestation must itself be a member of the relay (the person's own Buzz account there is), and GHOST Protocol's `gp attest --relay` checks it. This is the owner's key, not the agent's. The refusal's text also suggests adding the agent as a relay member: that way is not supported for now, so do not offer it. A community comes from **Or create a community** in Buzz (it needs an account), or from [a relay of your own](https://github.com/block/buzz#i-want-my-own-hosted-relay). Whether a community made in Buzz has owner attestations on has not been checked: ask its admin.

## The chain

| Step | What the person does | What can go wrong | The doc |
|---|---|---|---|
| 1. Add the plugin | **Settings → Plugins → Manage plugins → Add**. Enter `https://github.com/0xnfrith/buzz-plugins` and press **Find**. Pick **GHOST Protocol**, press **Continue**, check the review (one **Run docker** and eleven **Start docker**), then press **Install plugin**. | The browser build cannot install it. The plugin does not start: the error is in **Manage plugins**. | [README.md](README.md#how-to-install), "How to install" |
| 2. Check Docker | Open the **GHOST Protocol** page (Cmd+K or Ctrl+K, type `GHOST`). It should say **Docker is running**. | **Docker didn't answer**: Docker is not running, or Buzz cannot find `docker` on its PATH (a Buzz started from the macOS Dock may not have a terminal's PATH). | [README.md](README.md#what-the-page-shows-first), "What the page shows first" |
| 3. The create form | **Agents → New agent → Create a new agent**, with **GHOST Protocol** as the **Harness**. Give a name and choose **This computer**. Answer **Your Claude account** (paste a token, or choose the address) and **Let GHOST Protocol update itself?** | **Create agent** is held back until both are answered and, for the token way, a token with no space in it is pasted. | [README.md](README.md#the-create-form-and-the-agents-tab), "The create form and the agent's tab" |
| 4. Create agent | Press **Create agent**. Eight steps run: check Docker, download, make the key, start the agent, start the helper (after a yes), hand over the attestation, sign in to Claude, wait until running. | A failure names its step in one line. The first download is about 1 GB on disk. With a token, a relay without owner attestations on refuses the agent in step 8 ("Your relay does not accept owner attestations…"), with the agent's public key. With the address, Create agent ends at the Claude sign-in ("Waiting for you to sign in to Claude") and does not report the refusal. The agent's tab shows it instead (*Refused: not a member*, with the public key), even before the sign-in. | the table in the same section |
| 5. Running | The agent's **GHOST Protocol** tab says **Running**, with Claude **Active**. Mention the agent in a channel. | *Waiting for a Claude sign-in*: sign in on the tab. *Connecting to the relay* with *Refused: not a member*: prerequisite 4. | [README.md](README.md#what-it-does), the status screen |

**When Claude is connected.** With a setup token pasted in the form, **Create agent** signs the agent in itself, at step 7, after the attestation and before the wait. With **Sign in with an address**, or with no token held (Buzz's **Finish setup**, or after Buzz restarts), step 7 is skipped and the agent waits at `needs-claude`. The person then signs in on the agent's **GHOST Protocol** tab. The plugin never stores the token. The sign-in lives in the agent's data volume.

**Names in Docker.** The container is `gp-<name>`, the volume `gp-<name>-data` and the helper `gp-<name>.updater`, where `<name>` is the agent's name in lower case with dashes. **Delete agent** removes all three, the agent's memory included, unless Buzz has lost the name (its storage was cleared). Then nothing is touched.

## The other way

Without Buzz, GHOST Protocol installs from a terminal with its `get.sh` or `get.ps1`. See the quick start, "Install, the terminal way".

## Where each doc lives

| What | Where |
|---|---|
| This plugin: install, the form, the tab, the Claude guide, what was and was not checked | [`plugins/ghost-protocol/README.md`](README.md) |
| How to add any plugin, and the list of plugins | [the root `README.md`](../../README.md) |
| GHOST Protocol's quick start: what you need, the Buzz way, the terminal way, the relay setting, update, remove | [0xnfrith/ghost-protocol, `docs/quick-start.md`](https://github.com/0xnfrith/ghost-protocol/blob/main/docs/quick-start.md) |
| GHOST Protocol's README | [0xnfrith/ghost-protocol, `README.md`](https://github.com/0xnfrith/ghost-protocol#readme) |
| GHOST Protocol's own chain, from its side | [0xnfrith/ghost-protocol, `AGENTS.md`](https://github.com/0xnfrith/ghost-protocol/blob/main/AGENTS.md) |
| The interface the plugin drives (`gp` commands, `GP_` lines, `gp status --json`) | GHOST Protocol's `docker/gp/` and its quick start |

## What has and has not been run

- **Run:**
  - the unit tests;
  - the fake `docker` tests;
  - the browser suite, and the install check in Buzz's web build;
  - once, by hand on Linux without Buzz, the create flow against the real image, which stopped at the attestation.
- **Not run:**
  - the desktop route: no install in the desktop app, no **Create agent**, no real relay accepting the attestation, no mention answered;
  - anything on a Mac or on Windows.

Say so when you help someone, and do not promise more. The [README's "What was and was not checked"](README.md#what-was-and-was-not-checked) is the record.
