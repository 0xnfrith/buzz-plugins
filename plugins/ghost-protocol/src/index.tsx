import type { Agents, Relay } from "./agents.d";
import { agentType, TYPE_ID } from "./agent-type";
import type { Context } from "./buzz";
import { createBook } from "./gp/book";
import { createProgress, createSecrets } from "./gp/progress";
import { provideReact } from "./react";
import { createAgentTab } from "./ui/AgentTab";
import { createParts } from "./ui/CreateForm";
import { CREATE_CSS } from "./ui/create-styles";
import { PAGE_ICON } from "./ui/icons";
import { CSS } from "./ui/styles";
import { createPage } from "./ui/Page";

export const inject = ["react", "pages", "host", "agents", "relay"];

/** The id in manifest.json: Buzz keys an agent type `<plugin id>/<type id>`. A unit test holds the two equal. */
export const PLUGIN_ID = "megatech.ghost-protocol";

export function apply(ctx: Context & { agents: Agents; relay: Relay }): void {
  provideReact(ctx.react);

  ctx.effect(() => {
    // [DOM] The page's styles are one <style> element: API v1 has no separate CSS, and the host has no style service.
    const style = document.createElement("style");
    style.dataset.ghostProtocol = "";
    style.textContent = CSS + CREATE_CSS;
    document.head.append(style);
    return () => style.remove();
  });

  ctx.pages.register({
    id: "ghost-protocol",
    title: "GHOST Protocol",
    icon: PAGE_ICON,
    primary: true,
    layout: "workspace",
    component: createPage(ctx.host),
  });

  // The create form: a Remote agent type. Its progress and the Claude token it holds live as long as this plugin does, in memory only.
  const progress = createProgress();
  const secrets = createSecrets();
  const book = createBook();
  ctx.agents.register(agentType({ host: ctx.host, relay: ctx.relay, progress, secrets, book, ...createParts(progress, secrets) }));
  // Its own tab in the panel of the agents of this type, and in no other agent's.
  ctx.agents.registerTab({
    id: "ghost-protocol",
    title: "GHOST Protocol",
    component: createAgentTab(ctx.host, book),
    when: (agent) => agent.type === `${PLUGIN_ID}/${TYPE_ID}`,
  });
}
