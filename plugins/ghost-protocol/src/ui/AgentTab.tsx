// The tab GHOST Protocol adds to its own agents' panel in Buzz: what is known of the agent on this computer. It shows the status screen
// (src/ui/StatusScreen.tsx: state, version, relay, Update, Roll back, Restart, Stop) and the agent's Claude sign-in. The agent's container
// is found by the name it was made with: the plugin wrote the pair down when it made the agent (src/gp/book.ts), and a name that no longer
// matches still finds the container the agent was made with.
import type { TabAgent } from "../agents.d";
import type { Host } from "../buzz";
import type { Book } from "../gp/book";
import { slugFromName } from "../gp/names";
import { React } from "../react";
import { createClaudePanel } from "./ClaudePanel";
import { createStatusScreen } from "./StatusScreen";

export function createAgentTab(host: Host, book: Book) {
  const ClaudePanel = createClaudePanel(host);
  const StatusScreen = createStatusScreen(host);
  return function GhostProtocolTab({ agent }: { agent: TabAgent }) {
    const slug = book.get(agent.pubkey) ?? slugFromName(agent.name);
    if (slug === undefined) {
      return (
        <p className="gp-create gp-hint" data-gp="no-container">
          This computer has no GHOST Protocol container for this agent.
        </p>
      );
    }
    return (
      // `.gp-root` gives the status screen the page's tokens; `.gp-in-tab` takes its page-sized frame off it.
      <div className="gp-root gp-in-tab" data-gp="agent-tab">
        <StatusScreen key={slug} slug={slug} />
        <ClaudePanel key={`claude-${slug}`} slug={slug} />
      </div>
    );
  };
}
