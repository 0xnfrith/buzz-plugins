import type { Context } from "./buzz";
import { createAgentType, createTools, registerAgent } from "./support/agent";
import { createClient } from "./support/client";
import { createIdentity, hostProver } from "./support/identity";
import { createSupport } from "./support/service";
import { createSwitch, type SwitchStorage } from "./support/switch";
import { provideReact } from "./react";
import { createSettingsCard, type AgentStatus } from "./ui/Settings";
import { CSS } from "./ui/styles";
import { createSupportPage } from "./ui/Support";

export const inject = ["react", "pages", "settingsCards", "host", "relay", "agents"];

/** The profile's storage, or a store that keeps nothing when the profile will not give it: the switch then stays off and the card says so. */
function profileStorage(): SwitchStorage {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {} };
  }
}

/** Everything `apply` builds, returned so a test can reach the parts that have no screen of their own. */
export function wire(ctx: Context) {
  provideReact(ctx.react);

  // `ctx.host.request` is the only way to the service; the origin is the one the manifest declares.
  const client = createClient((request) => ctx.host.request(request));
  const identity = createIdentity({ client, relay: ctx.relay, prove: hostProver(ctx.host) });
  const support = createSupport({ client, identity });
  const flag = createSwitch(profileStorage());

  // Off until the user turns it on, and read once, here: the agent type and the tools are added only when the saved switch is on as Buzz
  // starts (an agent session lists its tools when it starts, and a changed list replaces it). The card says a restart is needed.
  const agent: AgentStatus = { startedOn: flag.get(), problems: [] };
  // Each call still asks the saved switch, so turning it off stops the tools at once, though they stay listed until the restart.
  const enabled = () => flag.get();
  if (agent.startedOn) agent.problems = registerAgent(ctx.agents, createAgentType({ support, enabled }), createTools({ support, enabled }));

  ctx.effect(() => {
    // [DOM] The page's styles are one <style> element: API v1 has no separate CSS, and the host has no style service.
    const style = document.createElement("style");
    style.dataset.megatechSupport = "";
    style.textContent = CSS;
    document.head.append(style);
    return () => {
      style.remove();
      // The session lives in this module's memory only: leaving (disable, update, quit) ends it.
      identity.dispose();
    };
  });

  ctx.pages.register({
    id: "support",
    title: "Megatech support",
    primary: true,
    layout: "workspace",
    component: createSupportPage({ identity, support, relay: ctx.relay }),
  });
  ctx.settingsCards.register({
    id: "settings",
    title: "Megatech support",
    group: "Plugins",
    component: createSettingsCard({ identity, relay: ctx.relay, flag, agent }),
  });
  return { identity, support, flag, agent };
}

export function apply(ctx: Context): void {
  wire(ctx);
}
