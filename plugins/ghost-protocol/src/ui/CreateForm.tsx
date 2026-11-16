// The GHOST Protocol part of Buzz's "New agent" dialog: where it runs, the Claude account, the question about updating itself, and the
// steps of Create as they happen. Buzz owns the dialog, the name, the avatar and the Create button; this holds the type's own choices
// and reports through `onReadyChange` when they are enough for Create.
import type { ComponentType, ReactNode } from "react";
import type { AgentCreateProps } from "../agents.d";
import type { Config } from "../gp/config";
import { CLAUDE_LEADS, WORDS, type ClaudeWay } from "../gp/constants";
import type { Progress, Secrets, Step } from "../gp/progress";
import { React } from "../react";
import { Refused } from "./Login";

type Props = AgentCreateProps<Config>;
type ConfigurationProps = Props & { harnessControl: ReactNode; onReadyChange?: (ready: boolean) => void };

export type Parts = Readonly<{ CreateConfiguration: ComponentType<ConfigurationProps>; Create: ComponentType<Props> }>;

/** A token is one word: it is whatever `claude setup-token` printed, with no space in it. */
export const tokenFit = (token: string): boolean => token.trim() !== "" && !/\s/.test(token.trim());

const WAYS: Readonly<Record<ClaudeWay, { label: string }>> = {
  token: { label: "Paste a setup token" },
  login: { label: "Sign in with an address" },
};
const ORDER: readonly ClaudeWay[] = CLAUDE_LEADS === "token" ? ["token", "login"] : ["login", "token"];

export function createParts(progress: Progress, secrets: Secrets): Parts {
  function Configuration({ config, onChange, disabled, harnessControl, onReadyChange }: ConfigurationProps) {
    const token = React.useSyncExternalStore(secrets.subscribe, secrets.token);
    const view = React.useSyncExternalStore(progress.subscribe, progress.view);
    const claude = view.steps.find((step) => step.id === "claude");
    // Done in this dialog: the agent already has its sign-in (a press of Create after a later step failed needs no token again).
    const signedIn = claude?.state === "done";
    const ready = config.selfUpdate !== null && (config.claudeWay === "login" || signedIn || tokenFit(token));
    React.useEffect(() => {
      onReadyChange?.(ready);
    }, [ready, onReadyChange]);
    // A new dialog starts with no trace of an earlier one. A token typed here is kept in memory for the one command that takes it, and
    // goes when this form does.
    React.useEffect(() => {
      progress.reset();
      return () => secrets.clear();
    }, []);

    return (
      <div className="gp-create" data-gp="configuration">
        {harnessControl}

        <fieldset className="gp-create-group" disabled={disabled}>
          <legend>Where it runs</legend>
          <label className="gp-choice">
            <input type="radio" name="gp-where" value="local" checked readOnly />
            <span>This computer</span>
          </label>
          <label className="gp-choice" aria-disabled="true">
            {/* Disabled, so it can be neither chosen nor submitted: it makes no call. */}
            <input type="radio" name="gp-where" value="hosted" checked={false} disabled readOnly />
            <span>Hosted</span>
            <span className="gp-soon">coming soon</span>
          </label>
        </fieldset>

        <fieldset className="gp-create-group">
          <legend>Your Claude account</legend>
          <p className="gp-hint" role="status" data-gp="claude-status">
            {signedIn ? "Signed in to Claude." : claude?.state === "running" ? "Signing in to Claude…" : "Not signed in yet. You connect Claude as the agent is made."}
          </p>
          {ORDER.map((way) => (
            <label className="gp-choice" key={way}>
              <input type="radio" name="gp-claude" value={way} checked={config.claudeWay === way} disabled={disabled} onChange={() => onChange({ ...config, claudeWay: way })} />
              <span>{WAYS[way].label}</span>
            </label>
          ))}
          {config.claudeWay === "token" ? (
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
                disabled={disabled}
                onChange={(event) => secrets.setToken(event.target.value)}
              />
            </div>
          ) : (
            <p className="gp-hint">Once the agent is made, open it and sign in at an address from its GHOST Protocol tab.</p>
          )}
        </fieldset>

        <fieldset className="gp-create-group" disabled={disabled} aria-labelledby="gp-self-update-question">
          <p id="gp-self-update-question" className="gp-question">
            {WORDS.selfUpdateQuestion}
          </p>
          <label className="gp-choice">
            <input type="radio" name="gp-self-update" value="yes" checked={config.selfUpdate === true} onChange={() => onChange({ ...config, selfUpdate: true })} />
            <span>Yes</span>
          </label>
          <label className="gp-choice">
            <input type="radio" name="gp-self-update" value="no" checked={config.selfUpdate === false} onChange={() => onChange({ ...config, selfUpdate: false })} />
            <span>No</span>
          </label>
        </fieldset>
      </div>
    );
  }

  function Steps({ steps }: { steps: readonly Step[] }) {
    return (
      <ol className="gp-steps" aria-label="What Create does">
        {steps.map((step) => (
          <li key={step.id} className="gp-step" data-state={step.state} data-step={step.id}>
            <span className="gp-mark" aria-hidden="true">
              {MARKS[step.state]}
            </span>
            <span className="gp-step-label">{step.label}</span>
            <span className="gp-step-state">{step.state === "skipped" ? "skipped" : step.state === "failed" ? "stopped" : ""}</span>
            {step.note !== "" && step.state !== "failed" && <span className="gp-step-note">{step.note}</span>}
          </li>
        ))}
      </ol>
    );
  }

  function Progression() {
    const view = React.useSyncExternalStore(progress.subscribe, progress.view);
    if (!view.active) return <p className="gp-hint gp-create">Press Create and the steps show here.</p>;
    return (
      <div className="gp-create" data-gp="progress">
        <Steps steps={view.steps} />
        {view.refused && <Refused pubkey={view.refused.pubkey} />}
      </div>
    );
  }

  return { CreateConfiguration: Configuration, Create: Progression };
}

const MARKS = { waiting: "·", running: "…", done: "✓", skipped: "–", failed: "✕" } as const;
