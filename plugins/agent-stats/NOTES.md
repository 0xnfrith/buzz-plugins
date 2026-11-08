# Agent Stats: notes

What went through Buzz's API and what did not, what the telemetry carries, and what was and was not checked. Written while building the plugin; read it before you change one.

**Tested against** block/buzz-app `5a7f4952ff6af5dafe74faa8e95d85f0a15f37c2` (7 November 2026). The frame formats come from block/buzz `d839d3731a11ab363a69e7f5b851c3031b7680dd`, `docs/nips/NIP-AO.md` (the live telemetry) and `docs/nips/NIP-AM.md` (the stored metrics). The workflow `.github/workflows/agent-stats-tests.yml` runs the browser tests at the first commit; `test/app-ref.test.mjs` keeps the two in step. The commit is newer than the one the other plugins are tested at, because `ctx.agents.registerTab` was added to block/buzz-app on 29 October 2026 (`a65463acb`) and the shared commit is from 22 October. It has its own variable, `AGENT_STATS_APP_REF`, so the shared guard (`.github/check-app-ref.sh`) is untouched.

## Through the plugin API

| Need | Route | Where it is written down |
| --- | --- | --- |
| Read the agents' telemetry | `ctx.relay.snapshot().session.agentActivity`: `activate()` takes the lease that makes Buzz listen, `snapshot()` holds the decrypted frames and the turn states, `subscribe()` says when they change | **Not documented for plugins.** `docs/plugin-architecture.md` describes it only for the bundled Agent Activity plugin ("Plugin activation owns its telemetry lease"); the type is internal (`src/features/agents/activity.ts`) and is not in the public contract (`src/plugins/api.ts`). The `relay` service itself is public, and the vim and support plugins in this repository already read the session through it. |
| A tab on an agent's profile | `ctx.agents.registerTab({ id, title, component, when, subscribe })` | `docs/plugin-architecture.md`, "A plugin, bundled or installed, can add a tab to the settings of agents running here or hosted". It follows Activity, in the profile panel and the Agents page. |
| A page | `ctx.pages.register({ id, title, primary, layout, component })` | `docs/plugin-architecture.md`. |
| The agents' names | `ctx.agents.snapshot()` and `subscribe()` | `src/features/agents/service.ts`. |

Because the first row is not a promise, the plugin checks that `agentActivity` has `activate`, `snapshot` and `subscribe` before it uses them. If it does not, the page and the tab say "This version of Buzz does not share agent telemetry with plugins" and nothing else happens. If Block closes that surface, this is where it will show.

`registerTab` is only called when it exists, so an older Buzz gets the page and no tab.

Why there is a page as well as a tab: `agentSections` returns nothing for an agent whose place is `elsewhere` (an agent of the owner on another device, which this copy of Buzz does not run), so no plugin tab can appear in its profile. Its telemetry still arrives, because the relay sends it to the owner. The page is the only place such an agent can be seen. Taking over the profile panel with a higher-priority `panels.register` would have covered it too, but it replaces Block's own Profiles panel, so it was not done.

### The DOM

One route, tagged `[DOM]` in `plugin.js`: a single `<style>` element in `document.head`, because API v1 has no style service. It is created and removed inside `ctx.effect`. Nothing reads or changes the page's own elements.

## What the telemetry carries

**Observer frames (kind 24200)** are ephemeral: the relay must not store them (NIP-AO), and Buzz does not either. The host decrypts each one and holds at most 200 envelopes or 2 MiB, and 512 turns, in memory (`src/features/agents/activity.ts`). The route starts at the moment the lease is taken (`src/features/relay/live.ts`, `route.since = now`), so there is no history to read. A frame is `{ seq, timestamp, kind, payload }` with `agentIndex`, `channelId`, `sessionId`, `turnId` and, on `turn_started`, `startedAt`; `kind: "batch"` carries several in `payload.events`.

What the plugin reads:

| Frame | Used for |
| --- | --- |
| `turn_started` | The turn, its start (`startedAt`) |
| any frame with a `turnId` | The turn's last report, the agent's last activity |
| `turn_completed`, `turn_error`, `agent_panic` | The turn's end (the first one wins) |
| `acp_read` or `acp_write` with `session/update` and `tool_call` or `tool_call_update` | Commands run (once per `toolCallId`: ACP kind `execute`, or the shell tool by title), and the current task (title and the first line of the command, or a file's name) |
| `session_config_captured`, `session/update` with `config_option_update` | The model, from the option whose category, id or name is `model` |
| `session/update` with `usage_update` | The context window, `{ used, size }` |

Everything else is ignored, as are frames from channels the viewer cannot read (Buzz drops those before the plugin sees them) and Buzz's management requests.

What they do not carry: **tokens or cost.** `usage_update` is the size of the context window, not what was spent. The model is whatever label the agent's adapter gives its `model` config option; an adapter that reports none shows none.

**Metrics frames (kind 44200)** are stored by the relay, one per finished turn, encrypted to the owner (NIP-AM). The decrypted JSON has `harness`, `model`, `channelId`, `sessionId`, `turnId`, `turnSeq`, `timestamp`, `turn` and `cumulative` (`inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, cache tokens), `deltaReliable`, `pricingIdentity` and `stopReason`. **A plugin cannot read them.** Buzz's live route asks only for kind 24200 (`live.ts`); the host's decoder for the renderer accepts only that kind (`src-tauri/src/relay/agent.rs`, `decode_observer_with_key`); the plugin API has no signer and no decrypt call; and `docs/agents.md` says the Usage plugin "does not read or publish kind-44200 metrics". The one host code that decrypts 44200 is the `relay_archive` command (`src-tauri/src/archive`), which nothing in the renderer has called since #1347 ("Stop saving agent activity and metrics locally"). A plugin could call it over the app's IPC; that is a private, unversioned command that writes encrypted envelopes to a SQLite file in the app's data folder, so it was not used and not tried. Tokens and cost are left out for that reason, not for lack of effort.

## Decisions

- **A turn belongs to the day it began.** Its commands and its time count there.
- **Idempotent folding.** Everything is keyed by agent and turn id (and tool call id), so the same frame twice, or Buzz handing over its buffer again after the plugin is updated in place, changes nothing. The store also remembers the frame ids it has folded.
- **The tally is saved a second after it changes**, and when the plugin goes. A full or blocked `localStorage` only means a restart forgets the day.
- **Turn ids are agent-chosen**, so the maps are made without a prototype (a turn called `__proto__` is only a key), ids are bounded to 256 characters, a turn keeps at most 500 command ids, an agent at most 1,000 turns, and the store at most 200 agents.
- **The current task is not saved**, and is shown only for a turn Buzz says is running now, so a leftover of the turn before is never shown as current.
- **The Stats tab is shown for every agent Buzz gives a tab to** (no `when`). For an agent that has not reported it says so.

## What was and was not checked

Checked:

- **Unit tests** (`test/*.test.mjs`, `node --test`, no install): folding of every frame kind above, the day's boundaries (in several time zones), malformed and hostile frames (wrong types, oversize ids, clocks in the future, `__proto__` as an id), the store's saving, restart and community separation, and the wiring against a made-up Buzz (lease taken once and given back, a new session, no session, a Buzz without the telemetry, a Buzz without tabs, blocked storage).
- **Browser tests** (`test/web/stats.spec.mjs`) in Buzz's own production web build at the commit above, in headless Chromium, with the harness encrypting frames to the viewer and Buzz's host decrypting them: a turn added up live and then idle; two agents, busy first; the plugin's own lease (with Agent Activity turned off it still counts, and turning Agent Stats off lets the route go); the tally across a page reload; ignored frames; no request of the plugin's own; the host reporting the registered tab; text contrast of at least 4.5 to 1 for every kind of text in both themes, measured from what the browser paints; no sideways overflow at 420 px.

Not checked:

- **The desktop app.** Nothing was installed in it; the install review, macOS WebKit and Windows are untried.
- **The Stats tab in a real profile panel.** The harness has no agent that Buzz runs or hosts, so a profile with plugin tabs cannot be opened there. The browser test confirms the host registered the tab; the tab's body is exercised only with a stand-in for React, in the unit tests.
- **Real agents.** The frames in the tests have the shape of Buzz's own parser and NIP-AO, made up. What a real agent bridge sends for a shell tool (its ACP `kind`, its title) was not seen, so the command count rests on `execute` and on the titles `Run command` and `*__shell`.
- **A burst of frames.** Buzz notifies the plugin as each frame arrives, so none should be lost to the 200-envelope buffer; this was reasoned from `activity.ts`, not tried with a flood.
- **Midnight, in the browser tests.** The spec sends turns that began seconds ago and expects them to be today's, so a run that starts within two minutes of local midnight waits it out. The unit tests use a fixed clock and were run under six time zones.
- **The look, by eye.** The contrast and the overflow are measured; the screenshots were produced by the test run and the page's design was not reviewed by a person when this was written.
- **Several communities at once.** The tally is kept per community scope; only one community was exercised.

## A possible follow-up

For agents that run on this computer, the agent type's own `usage()` (the route Block's Usage plugin uses, through `ctx.agents.types()`) reads the harness's session files and returns the model, the tokens and the cost of each request. That would give tokens and cost for local agents without the metrics events. It is a different source from Buzz's telemetry and covers only agents running here, so it is not part of this plugin.
