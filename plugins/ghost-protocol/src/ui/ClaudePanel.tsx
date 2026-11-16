// An agent's Claude sign-in, in its GHOST Protocol tab: whether it has one, and the two ways to give it one. The token's way is also in the
// Create form; the address's way is only here, because Buzz's Create dialog cannot ask the person for a code while it runs (src/gp/claude.ts).
// What the person pastes is kept in memory for the one command that takes it, and goes when the command ends or the tab does.
import type { Host } from "../buzz";
import { isSignedIn, signInByAddress, signInWithToken } from "../gp/claude";
import { startOn } from "../docker";
import { createProgress, createSecrets } from "../gp/progress";
import { React } from "../react";
import { tokenFit } from "./CreateForm";
import { Login } from "./Login";

type State = Readonly<{ kind: "checking" }> | Readonly<{ kind: "answer"; active: boolean }> | Readonly<{ kind: "problem"; message: string }>;

export function createClaudePanel(host: Host) {
  return function ClaudePanel({ slug }: { slug: string }) {
    const start = React.useMemo(() => startOn(host), []);
    const secrets = React.useMemo(createSecrets, []);
    const progress = React.useMemo(createProgress, []);
    const token = React.useSyncExternalStore(secrets.subscribe, secrets.token);
    const view = React.useSyncExternalStore(progress.subscribe, progress.view);
    const [state, setState] = React.useState<State>({ kind: "checking" });
    const [round, setRound] = React.useState(0);
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState("");
    const work = React.useRef<AbortController | undefined>(undefined);

    // Looks at the sign-in when the tab opens and when the person asks again; leaving the tab ends the look and any sign-in under way.
    React.useEffect(() => {
      if (!start) return;
      const abort = new AbortController();
      setState({ kind: "checking" });
      void isSignedIn({ start }, slug, abort.signal).then((answer) => {
        if (abort.signal.aborted) return;
        setState(answer.ok ? { kind: "answer", active: answer.active } : { kind: "problem", message: answer.message });
      });
      return () => abort.abort();
    }, [slug, round, start]);
    React.useEffect(
      () => () => {
        work.current?.abort();
        secrets.clear();
      },
      [secrets],
    );

    if (!start) {
      return (
        <section className="gp-create" aria-labelledby="gp-claude-title" data-gp="claude">
          <h3 id="gp-claude-title">Claude</h3>
          <p className="gp-hint" role="alert">
            This Buzz cannot start programs. Use the Buzz desktop app.
          </p>
        </section>
      );
    }

    const finish = (result: { ok: true } | { ok: false; message: string; stopped?: true }) => {
      work.current = undefined;
      setBusy(false);
      secrets.clear();
      if (result.ok) {
        setMessage("");
        setRound((n) => n + 1);
      } else if (!result.stopped) setMessage(result.message);
    };
    const run = (job: (signal: AbortSignal) => Promise<{ ok: true } | { ok: false; message: string; stopped?: true }>) => {
      const abort = new AbortController();
      work.current = abort;
      setBusy(true);
      setMessage("");
      void job(abort.signal).then(finish);
    };

    const active = state.kind === "answer" && state.active;
    const headline =
      state.kind === "checking" ? "Checking…" : state.kind === "problem" ? state.message : active ? "Signed in to Claude." : "Not signed in to Claude yet.";
    return (
      <section className="gp-create" aria-labelledby="gp-claude-title" data-gp="claude">
        <h3 id="gp-claude-title">Claude</h3>
        <p className="gp-question" role={state.kind === "problem" ? "alert" : "status"} data-gp="claude-state">
          {headline}
        </p>
        {state.kind === "answer" && !active && !view.login && (
          <>
            <div className="gp-create-fields">
              <p className="gp-hint">
                Run <code>claude setup-token</code> in a terminal and paste the token here. It goes to the agent and nowhere else: this plugin does not store it.
              </p>
              <input
                className="gp-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-label="Claude setup token"
                value={token}
                disabled={busy}
                onChange={(event) => secrets.setToken(event.target.value)}
              />
              <div className="gp-row">
                <button type="button" className="gp-button" disabled={busy || !tokenFit(token)} onClick={() => run((signal) => signInWithToken({ start }, slug, token, signal))}>
                  Send token
                </button>
              </div>
            </div>
            <div className="gp-create-fields">
              <p className="gp-hint">Or sign in at an address, and paste back the code you get.</p>
              <div className="gp-row">
                <button type="button" className="gp-button" disabled={busy} onClick={() => run((signal) => signInByAddress({ start }, slug, progress.askCode, signal))}>
                  Sign in with an address
                </button>
              </div>
            </div>
          </>
        )}
        {view.login && <Login key={view.login.url} progress={progress} url={view.login.url} />}
        {message !== "" && (
          <p className="gp-hint" role="alert" data-gp="claude-problem">
            {message}
          </p>
        )}
        {(state.kind === "problem" || (state.kind === "answer" && !active)) && !busy && (
          <div className="gp-row">
            <button type="button" className="gp-button" onClick={() => setRound((n) => n + 1)}>
              Check again
            </button>
          </div>
        )}
      </section>
    );
  };
}

