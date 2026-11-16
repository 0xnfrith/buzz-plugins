import type { Host } from "../buzz";
import { checkDocker, textOf, type Check } from "../docker";
import { React } from "../react";

type State = Check | Readonly<{ state: "checking" }>;

export function createPage(host: Host) {
  return function GhostProtocolPage() {
    const [state, setState] = React.useState<State>({ state: "checking" });
    // Pressing "Check again" starts the next round; leaving the page ends the round in progress, which stops its process.
    const [round, setRound] = React.useState(0);
    React.useEffect(() => {
      const abort = new AbortController();
      setState({ state: "checking" });
      void checkDocker(host, abort.signal).then((check) => {
        if (check && !abort.signal.aborted) setState(check);
      });
      return () => abort.abort();
    }, [round]);

    const failed = state.state === "unavailable" || state.state === "unsupported";
    return (
      <div className="gp-root">
        <header className="gp-bar">
          <h1 className="gp-title">GHOST Protocol</h1>
        </header>
        <div className="gp-body">
          <section className="gp-panel" aria-labelledby="gp-docker">
            <h2 id="gp-docker">Docker</h2>
            <p className="gp-status" role={failed ? "alert" : "status"}>
              {textOf(state.state)}
            </p>
            {state.state === "ready" && (
              <dl className="gp-facts">
                <dt>Docker version</dt>
                <dd>{state.version}</dd>
              </dl>
            )}
            <button type="button" className="gp-button" disabled={state.state === "checking"} onClick={() => setRound((n) => n + 1)}>
              Check again
            </button>
          </section>
          <p className="gp-note">GHOST Protocol will run as a container in Docker on this computer. For now this page only checks that Docker is ready.</p>
        </div>
      </div>
    );
  };
}
