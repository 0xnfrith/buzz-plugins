// Echo agent: an EXAMPLE of an agent-type plugin for Buzz, not a product.
// Prebuilt API v1 module: no build step, no imports, no network, no keys.
// Shipped as plugin.example.js so it is not offered for install from this repository;
// copy the folder out and rename this file to plugin.js to use it.
//
// It registers one agent type. Create an agent of this type on the Agents page
// (it appears in the harness picker), add the agent to a channel and mention it.
// Buzz calls run(delivery) for the mention; the agent answers in the mention's
// thread by quoting the message back. Swap the body of reply() for a real brain.
//
// Contract, from block/buzz-app docs/plugin-architecture.md ("Starting contracts")
// and src/features/agents/service.ts (AgentType, Delivery, AgentHandle):
//   ctx.agents.register({ id, title, defaults, run })
//   run(delivery): delivery.trigger is { type: "mention", event } for a mention;
//   delivery.agent.publish({ kind, content, tags }) publishes as the agent.
export const inject = ["agents"];

// The thread a reply belongs in. Buzz agents never nest replies: a reply to any
// message in a thread is a reply to the thread's root (src/buzz-mcp/tools.ts,
// threadTags). A message with no e tag is itself the root.
function threadRoot(event) {
  const tags = event.tags ?? [];
  const marked = (marker) => tags.find((t) => t[0] === "e" && t[3] === marker)?.[1];
  return marked("root") ?? marked("reply") ?? event.id;
}

function channelOf(delivery, event) {
  return delivery.channelId ?? (event.tags ?? []).find((t) => t[0] === "h")?.[1];
}

// The "brain". Replace this with your own: keep it local, or declare what it needs.
function reply(text) {
  const quoted = text.trim().split("\n").map((line) => `> ${line}`).join("\n");
  return `${quoted}\n\nHeard you. (Echo agent, an example plugin.)`;
}

export function apply(ctx) {
  // The registration belongs to this plugin's scope: Buzz removes the agent type
  // when the plugin is disabled, updated or removed, so no ctx.effect is needed here.
  ctx.agents.register({
    id: "echo",
    title: "Echo (example)",
    description: "Quotes a mention back. An example agent type.",
    defaults: () => ({ config: {} }),
    async run(delivery) {
      const { trigger } = delivery;
      if (trigger.type !== "mention") {
        delivery.ignored?.();
        return;
      }
      const event = trigger.event;
      const channel = channelOf(delivery, event);
      if (!channel) {
        delivery.ignored?.();
        return;
      }
      delivery.acknowledged?.();
      await delivery.agent.publish({
        kind: 9, // a chat message
        content: reply(event.content ?? ""),
        tags: [
          ["h", channel],
          ["e", threadRoot(event), "", "reply"],
        ],
      });
    },
  });
}
