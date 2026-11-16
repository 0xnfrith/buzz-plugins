import type { Host } from "../buzz";
import { checkDocker, textOf, type Check } from "../docker";
import { React } from "../react";
import { slugOf } from "../slug";
import { WORDS } from "../words";
import { createStatusScreen } from "./StatusScreen";

type State = Check | Readonly<{ state: "checking" }>;

export function createPage(host: Host) {
  const StatusScreen = createStatusScreen(host);
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

    // Which agent the status screen is about: the name typed, and the one it was last pressed for. The screen is made for a `<slug>`, and
    // the form that creates agents will hand it one; until it does, a person types it.
    const [typed, setTyped] = React.useState("");
    const [shown, setShown] = React.useState<string>();
    const [rejected, setRejected] = React.useState(false);
    const show = () => {
      const slug = slugOf(typed);
      setRejected(slug === undefined);
      if (slug !== undefined) setShown(slug);
    };

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
          <section className="gp-panel" aria-labelledby="gp-agent-form">
            <h2 id="gp-agent-form">Agent</h2>
            <form
              className="gp-form"
              onSubmit={(event) => {
                event.preventDefault();
                show();
              }}
            >
              <label htmlFor="gp-slug">{WORDS.slugLabel}</label>
              <input
                id="gp-slug"
                className="gp-input"
                type="text"
                value={typed}
                autoComplete="off"
                spellCheck={false}
                maxLength={80}
                aria-invalid={rejected}
                aria-describedby="gp-slug-help"
                onChange={(event) => setTyped(event.target.value)}
              />
              <p id="gp-slug-help" className="gp-note">
                {WORDS.slugHelp}
              </p>
              {rejected && (
                <p className="gp-problem" role="alert">
                  {WORDS.slugBad}
                </p>
              )}
              <button type="submit" className="gp-button">
                {WORDS.show}
              </button>
            </form>
          </section>
          {shown !== undefined && <StatusScreen key={shown} slug={shown} />}
          <p className="gp-note">GHOST Protocol runs as a container in Docker on this computer. This page checks Docker and shows an agent's status.</p>
        </div>
      </div>
    );
  };
}
