// An agent's Claude sign-in, in its GHOST Protocol tab: "Claude: active" or "Claude: not active", kept up to date while the tab is open,
// and, when it is not active, the guide to connecting it (src/ui/ClaudeGuide.tsx) with the two ways to give it a sign-in. The token's way
// is also in the Create form; the address's way is only here, because Buzz's Create dialog cannot ask the person for a code while it runs
// (src/gp/claude.ts). What the person pastes is kept in memory for the one command that takes it, and goes when the command ends, whatever
// it says, or when the tab does.
import type { Host } from "../buzz";
import { CLAUDE_STATUS } from "../claude-words";
import { startOn } from "../docker";
import { isSignedIn, signInByAddress, signInWithToken, type Result } from "../gp/claude";
import { createProgress, createSecrets } from "../gp/progress";
import { POLL_MS } from "../observe";
import { React } from "../react";
import { tokenFit } from "./CreateForm";
import { ClaudeGuide, type Failure } from "./ClaudeGuide";
import { Login } from "./Login";

type State = Readonly<{ kind: "checking" }> | Readonly<{ kind: "answer"; active: boolean }> | Readonly<{ kind: "problem"; message: string }>;

type Props = {
  slug: string;
  /** Called when the agent has accepted a sign-in, so the rest of the tab can look again at once. */
  onSignedIn?: () => void;
};

export function createClaudePanel(host: Host) {
  return function ClaudePanel({ slug, onSignedIn }: Props) {
    const start = React.useMemo(() => startOn(host), []);
    const secrets = React.useMemo(createSecrets, []);
    const progress = React.useMemo(createProgress, []);
    const token = React.useSyncExternalStore(secrets.subscribe, secrets.token);
    const view = React.useSyncExternalStore(progress.subscribe, progress.view);
    const [state, setState] = React.useState<State>({ kind: "checking" });
    const [round, setRound] = React.useState(0);
    const [busy, setBusy] = React.useState(false);
    const [failure, setFailure] = React.useState<Failure>();
    const [accepted, setAccepted] = React.useState(false);
    const work = React.useRef<AbortController | undefined>(undefined);
    // Read by the looks that repeat, which must not run beside a sign-in: the two would talk to the agent at once.
    const signingIn = React.useRef(false);

    // Looks at the sign-in when the tab opens, when the person asks again and after a sign-in, then again about every ten seconds, so a
    // sign-in done elsewhere (in a terminal) shows up. A look that repeats leaves what is shown until its answer arrives. Leaving the
    // tab ends the look and any sign-in under way.
    React.useEffect(() => {
      if (!start) return;
      const abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      setState({ kind: "checking" });
      const look = async () => {
        if (!signingIn.current) {
          const answer = await isSignedIn({ start }, slug, abort.signal);
          if (abort.signal.aborted) return;
          setState(answer.ok ? { kind: "answer", active: answer.active } : { kind: "problem", message: answer.message });
          if (answer.ok && !answer.active) setAccepted(false);
        }
        timer = setTimeout(() => void look(), POLL_MS);
      };
      void look();
      return () => {
        abort.abort();
        clearTimeout(timer);
      };
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

    const run = (way: Failure["way"], job: (signal: AbortSignal) => Promise<Result>) => {
      const abort = new AbortController();
      work.current = abort;
      signingIn.current = true;
      setBusy(true);
      setFailure(undefined);
      setAccepted(false);
      void job(abort.signal).then((result) => {
        work.current = undefined;
        signingIn.current = false;
        setBusy(false);
        // Nothing the person typed outlives the command.
        secrets.clear();
        if (result.ok) {
          setAccepted(true);
          setRound((n) => n + 1);
          onSignedIn?.();
        } else if (!result.stopped) {
          setFailure({ way, message: result.message, ...(result.said === undefined ? {} : { said: result.said }) });
        }
      });
    };

    const active = state.kind === "answer" && state.active;
    const notActive = state.kind === "answer" && !state.active;
    const headline =
      state.kind === "checking" ? CLAUDE_STATUS.checking : state.kind === "problem" ? state.message : active ? CLAUDE_STATUS.active : CLAUDE_STATUS.notActive;
    return (
      <section className="gp-create" aria-labelledby="gp-claude-title" data-gp="claude">
        <h3 id="gp-claude-title">Claude</h3>
        <p className="gp-question" role={state.kind === "problem" ? "alert" : "status"} data-gp="claude-state">
          {headline}
        </p>
        {accepted && active && (
          <p className="gp-hint" role="status" data-gp="claude-accepted">
            {CLAUDE_STATUS.accepted}
          </p>
        )}
        {(state.kind === "problem" || notActive) && !busy && (
          <div className="gp-row">
            <button type="button" className="gp-button" onClick={() => setRound((n) => n + 1)}>
              Check again
            </button>
          </div>
        )}
        {notActive && (
          <ClaudeGuide
            busy={busy}
            token={token}
            onToken={secrets.setToken}
            canSend={tokenFit(token)}
            onSend={() => {
              // The field empties as the token leaves it: the command has the only copy, and it is gone with the command.
              const sent = token;
              secrets.clear();
              run("token", (signal) => signInWithToken({ start }, slug, sent, signal));
            }}
            onStartLogin={() => run("login", (signal) => signInByAddress({ start }, slug, progress.askCode, signal))}
            login={view.login && <Login key={view.login.url} progress={progress} url={view.login.url} />}
            failure={failure}
          />
        )}
      </section>
    );
  };
}
