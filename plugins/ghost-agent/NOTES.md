# GHOST agent: spike notes (MT-921)

The question: can a Buzz plugin put a GHOST Protocol instance that **already runs on its own server** (its own key, no Buzz
app on that server) on the owner's Agents page, coupled to that live instance, with a tab showing the instance's
management data? Answer: **yes, with no change to Buzz.** Read against block/buzz-app `v0.7.0-preview.233.1` (the
installed build); "observed" means tried in that installed app on 2026-11-03.

## What the Agents page is

It lists the owner's agents, not a directory of agents to chat with. Three places (`AgentPlace`, `src/features/agents/service.ts:183`):

- `here`: this app holds the key and runs the harness (Claude, Codex, Goose, Pi).
- `elsewhere`: another of the owner's devices runs it. Card only, no tabs (`src/features/agents/tabs.tsx:60`).
- `hosted`: a provider holds the key and runs it. The type's own `tabs` are shown (`src/bundled/agents/AgentSettingsHost.tsx:92-93`).

The page learns about `elsewhere` and `hosted` agents from the owner's **kind 30177** records on the relay, `d` = agent
pubkey, `runtime` = type key (`src/features/agents/relay-removal.ts:77-112`, `service.ts:4331-4352`). Only the owner can sign
one, so a plugin cannot list an agent on its own; the app's Create flow writes it.

## How the plugin couples to the instance

A plugin registers an agent type with `remote` (a "hosted" type, `service.ts:812-859`; Builderlab is the bundled example,
`src/bundled/builderlab/adapter-type/index.ts`). Installed plugins may register one; the only checks are the shape checks in
`service.ts:2048-2060`. Create runs `provision` → `activate` → the app writes the 30177 record (`service.ts:2744-2830`).

This plugin's provider makes nothing:

| Step | Builderlab | This plugin |
| --- | --- | --- |
| `provision` | registers a new agent, returns its new key | returns the instance pubkey the owner typed in |
| `activate` | sends the owner's NIP-OA attestation to its server | keeps nothing (see Gaps) |
| `profile` | updates the agent's profile | nothing: the instance owns its profile |
| `remove` | deletes the agent and its key | nothing: unlinks only |

Observed: created as "Ghostx" with the live instance's pubkey; the card shows "GHOST Protocol · runs on its own server";
**Message** opened a DM and the instance answered it; the **Banner** tab showed the instance's note, including a republish
made after install (`generated` 05:06Z, a thread link on one item). Buzz added Identity, Memory and Settings tabs itself.

Read, not tried: on the owner's other devices the 30177 record lists the agent too. Where this plugin is installed it is
`hosted` with the Banner tab; where it is not, it shows "Harness unavailable" with no tabs (`src/bundled/agents/AgentsPage.tsx:129-131`).

## The data

The instance publishes its banner as its own NIP-23 note: kind 30023, `d` = `ghost-banner`, JSON `ghost-banner/v0`
(`inbox`, `wip`, `items[]` of `{ kind, id, date, title?, thread? }`). The tab reads it with
`session.observe([{ kinds: [30023], authors: [pubkey], "#d": ["ghost-banner"] }])`. An observed view is not a live
subscription, so the tab refreshes on open, every 30 s and on `r`. `thread` is a `buzz://message?channel=…&id=…[&thread=…]`
link (the form **Copy link** makes, `docs/deep-links.md`) or `{ channel, id?, root? }`; Enter opens it with
`ctx.navigation.open({ kind: "conversation", … })`.

Because the note is signed by the instance's key, the tab cannot be fed by anyone else, and nothing is hardcoded.

## Vim plugin

- The list is `role="listbox"`. `plugins/vim` treats `[role="listbox"]` as a popup and leaves its keys alone
  (`plugins/vim/src/constants.ts:47`), so the tab's own keys win while the list has focus, with no change to vim.
- Keys in the list: `j`/`k` (and arrows) move, `g`/`G` top and bottom, `d`/`u` ten rows, `Enter` or `o` opens the item's
  thread, `r` reloads. Double-click also opens it.
- Gap: getting focus into the list. Today you click it or Tab to it. Vim has no route into an agent's tab panel (there is
  no API for focus between regions; see `docs/building.md` §1). Smallest fix: the tab focuses its list when it mounts, or
  vim gains a key that focuses the first `[role="listbox"]` in the open side panel.
- Observed: the list renders and scrolls, and Enter on an item with a `thread` opened that thread in the side pane with
  the vim plugin on (NORMAL mode).

## Extend GHOST Protocol or sit beside it

**Beside it.** The two run in different places: GHOST Protocol is a Claude Code plugin on the instance's server, and
this is a Buzz plugin in the owner's app. They share only a relay contract: the instance's key, and the `ghost-banner/v0`
note it signs. What GHOST Protocol would add for this to work for every instance:

1. Publish `ghost-banner` from its own backlog banner (today `nf-backlog-system/hooks/backlog-banner.sh`) on session
   start and whenever the backlog changes. Titles stay off the relay unless the owner agrees, since every member can read it.
2. Fill `thread` for an item when the instance knows the Buzz thread it came from.
3. Optionally accept the owner's NIP-OA attestation (see Gaps).

## Gaps before a customer version

- **Consent.** Any pubkey can be linked; nothing proves the instance agreed or that the owner owns it. Fix: `activate`
  sends the owner's NIP-OA attestation to the instance (a DM is enough), and the instance confirms by publishing it, e.g.
  in its profile. Buzz then marks it as the owner's agent everywhere.
- **Hosted means no Attention and no Stop.** Hosted types have no attention (`service.ts:819-821`); Stop needs
  `remote.interrupt`, which this spike leaves out.
- **Rename** in Buzz changes only the owner's listing, not the instance's profile.
- **No live updates.** Polling every 30 s; fine for a banner.
- **Remove** unlinks only. Deleting or stopping the instance stays on its server.

## Next: Agent Activity for a linked instance (scope, read only)

Buzz shows two kinds of activity, and both come from events the agent signs, so a remote instance can produce them.

1. **Working dots** under the message it is answering: kind **20002** typing, empty content, tags `["h", channel]`, plus
   `["e", root, "", "root"]` and `["e", message, "", "reply"]` in a thread, re-sent every 3 s while it works and dropped by
   clients 8 s after the last one (`src/features/agents/typing.ts:27-75`, `docs/agents.md` "Local plugin-agent lifecycle").
2. **Live steps** (the Agent Activity bubble, and an Activity tab): kind **24200** observer frames, defined by NIP-AO in
   block/buzz (`docs/nips/NIP-AO.md`). Tags are exactly `["p", owner]`, `["agent", agent]`, `["frame", "telemetry"]`. The
   content is NIP-44 v2 encrypted from the agent's key to the owner, and decrypts to
   `{ seq, timestamp, kind, channelId, sessionId, turnId, payload }`. Frames must be under 5 minutes old to be shown
   (`src-tauri/src/relay/agent.rs:211-219`). A turn opens with `turn_started` (`payload.triggeringEventIds`: the message
   ids that started it) and ends with `turn_completed`, `turn_error` or `agent_panic`. Tool steps are `acp_read` and
   `acp_write` frames carrying ACP JSON-RPC (`src/features/agents/activity.ts:70-77`, `activity-transcript.ts`).

The relay accepts a 24200 only if it has recorded the owner as the agent's owner (`is_agent_owner`, block/buzz
`crates/buzz-db/src/store/user.rs:519`). It records that when the agent authenticates with a NIP-OA owner attestation
(`crates/buzz-relay/src/handlers/auth.rs:700-726`). That is the attestation `activate` receives, which also closes the
consent gap above.

Work, by side:

- **GHOST Protocol (server):** Claude Code hooks (turn start, each tool call, turn end) send the 24200 frames, and a
  typing pulse while a turn runs, signed with the instance key. It needs NIP-44 v2 and an owner attestation on its relay
  login.
- **This plugin:** an Activity tab (`role: "activity"`) that reads `session.agentActivity`, as Builderlab's does
  (`src/bundled/builderlab/adapter-type/Activity.tsx:20-38`). Buzz's own transcript component is not available to plugins,
  so the tab draws a plain list.
- **Untested:** whether a deployed relay matches block/buzz main here, and whether the bubble shows for hosted agents
  without further work.
