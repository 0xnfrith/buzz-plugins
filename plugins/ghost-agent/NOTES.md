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
- Observed: the list renders and scrolls. **Not yet confirmed in the app:** Enter opening the thread, and the vim plugin
  being on at the same time.

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
