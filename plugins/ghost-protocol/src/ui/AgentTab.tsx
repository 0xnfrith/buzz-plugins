// The tab GHOST Protocol adds to its own agents' panel in Buzz: what is known of the agent on this computer. It shows the status screen
// (src/ui/StatusScreen.tsx: state, version, relay, Update, Roll back, Restart, Stop) and the agent's Claude sign-in. The agent's container
// is found by the name it was made with: the plugin wrote the pair down when it made the agent (src/gp/book.ts), and a name that no
// longer matches still finds the container the agent was made with. Nothing here acts on a container that is not the agent's
// (src/gp/guard.ts): the buttons and the token field only appear once the container's own status names this agent's key.
import type { TabAgent } from "../agents.d";
import type { Host } from "../buzz";
import type { Book } from "../gp/book";
import { verifyContainer, type Guard } from "../gp/guard";
import { slugFromName } from "../gp/names";
import { React } from "../react";
import { createClaudePanel } from "./ClaudePanel";
import { createStatusScreen } from "./StatusScreen";

export function createAgentTab(host: Host, book: Book) {
  const ClaudePanel = createClaudePanel(host);
  const StatusScreen = createStatusScreen(host);
  return function GhostProtocolTab({ agent }: { agent: TabAgent }) {
    const written = book.get(agent.pubkey);
    const slug = written ?? slugFromName(agent.name);
    const [guard, setGuard] = React.useState<Guard | "checking">("checking");
    React.useEffect(() => {
      if (slug === undefined) return;
      const abort = new AbortController();
      setGuard("checking");
      void verifyContainer(host, slug, agent.pubkey, written !== undefined, abort.signal).then((answer) => {
        if (answer !== undefined && !abort.signal.aborted) setGuard(answer);
      });
      return () => abort.abort();
    }, [slug, agent.pubkey, written !== undefined]);

    if (slug === undefined) {
      return (
        <p className="gp-create gp-hint" data-gp="no-container">
          This computer has no GHOST Protocol container for this agent.
        </p>
      );
    }
    if (guard !== "ok") {
      return (
        <p className="gp-create gp-hint" role={guard === "checking" ? "status" : "alert"} data-gp={guard === "checking" ? "checking" : `container-${guard}`}>
          {guard === "checking"
            ? "Looking at this agent's container…"
            : guard === "other"
              ? `This container belongs to another agent: gp-${slug} on this computer is not this agent's, so nothing here acts on it.`
              : `Nothing here acts on gp-${slug}: this computer has no record of which container is this agent's, and Docker did not say whose it is.`}
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
