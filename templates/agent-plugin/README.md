# Agent plugin template: Echo agent (example)

An **example**, not a product. It shows the smallest working agent-type plugin for Buzz: a folder with `manifest.json` and a prebuilt `plugin.js`, no build step.

The code ships as `plugin.example.js`, so that Buzz's Git import does not offer this template as an installable plugin. Copy the folder out and rename the file to `plugin.js` to use it (below).

## What it does

- Registers one agent type, **Echo (example)**, with `ctx.agents.register({ id, title, defaults, run })`.
- The type shows up in the harness picker when you create an agent on the Agents page.
- When someone mentions an agent of this type, Buzz calls `run(delivery)`. `delivery.trigger` is `{ type: "mention", event }`, and the plugin answers with `delivery.agent.publish({ kind: 9, content, tags })`, which publishes as the agent.
- The reply carries an `h` tag (the channel) and an `e` tag marked `reply` that points at the thread's root, so it lands in the mention's thread. Buzz's own agents never nest replies: a reply to any message in a thread is a reply to the root.
- Any other trigger (a watch, a timer, a plugin wake) is declined with `delivery.ignored?.()`.

## Try it

1. Copy this folder somewhere of your own and rename `plugin.example.js` to `plugin.js`. Then Settings → Plugins → Manage plugins → Add, load that folder, and install it. Check that it is enabled.
2. Agents page → new agent → pick **Echo (example)** as the harness.
3. Add the agent to a channel and mention it. It quotes your message back in a thread.

Edit `plugin.js`, then press **Update** on the plugin in Settings: the old revision is disposed and the new one runs at once. An unsigned folder installs; signing is optional (`buzzodz plugin sign`).

## Make it yours

- Change `id` in `manifest.json` (lowercase letters, digits, dots and hyphens; it must start with a letter) and the agent type's `id` and `title`.
- Replace `reply()` with your brain. The rules in [`docs/building.md`](../../docs/building.md) still hold: no network, no keys and no `eval` in the plugin. A brain that needs a model provider or a key is a different design (a host-declared process or an existing harness), not a few lines added here.
- The full agent-type contract (config tabs, models, sessions, `runOnce`, timeouts, `ctx.agents.addTool`, `ctx.agents.wake`) is in Block's [`docs/plugin-architecture.md`](https://github.com/block/buzz-app/blob/main/docs/plugin-architecture.md) and `src/features/agents/service.ts` (`AgentType`, `Delivery`, `AgentHandle`). Check them against the Buzz version you target.
