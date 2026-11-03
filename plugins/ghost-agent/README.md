# GHOST agent (prototype)

Puts a GHOST Protocol instance that already runs on its own server on your Buzz **Agents** page, and gives it a
**Banner** tab with the instance's management data: inbox, work in progress, overdue, blocked and woken reminders, each
linking to the Buzz thread it belongs to.

A spike for MT-921, not a customer plugin. See [NOTES.md](NOTES.md) for how it works, what was verified and what is missing.

## Try it

1. Install `plugins/ghost-agent` (Settings → Plugins → Manage plugins → Add → folder) and enable it.
2. Agents → New agent → Create a new agent → type **GHOST Protocol**. Name it and paste the instance's hex pubkey.
3. Open the agent: **Message** opens a DM with the instance; **Banner** shows its latest `ghost-banner` note.

In the Banner list: `j`/`k` move, `g`/`G` top and bottom, `d`/`u` ten rows, `Enter` or `o` opens the thread, `r` reloads.

The plugin holds no key and makes no network request of its own: it reads the instance's signed note from your community.
**Remove** unlinks the agent; it never stops the instance or touches its key.
