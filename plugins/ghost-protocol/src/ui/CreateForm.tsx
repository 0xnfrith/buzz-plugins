// The Megatech part of Buzz's "New agent" dialog: which agent to make (a personal agent on this computer, a hosted one that is coming
// soon, or a content machine, which needs a megatech sign-in that does not exist yet), then, for the personal agent on this computer, the
// Claude account, the question about updating itself, and the steps of Create as they happen. Buzz owns the dialog, the name, the avatar
// and the Create button; this holds the type's own choices and reports through `onReadyChange` when they are enough for Create. The
// content machine is never ready: Buzz holds Create back, and nothing here makes an agent for it.
import type { ComponentType, ReactNode } from "react";
import type { AgentCreateProps } from "../agents.d";
import { CONTENT_MACHINE_SOON, type Config } from "../gp/config";
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
/** The two ways to sign in to Claude, the leading one first. */
export const waysFor = (leads: ClaudeWay): readonly ClaudeWay[] => (leads === "token" ? ["token", "login"] : ["login", "token"]);
const ORDER = waysFor(CLAUDE_LEADS);

export function createParts(progress: Progress, secrets: Secrets): Parts {
  function Configuration({ config, onChange, disabled, harnessControl, onReadyChange }: ConfigurationProps) {
    const token = React.useSyncExternalStore(secrets.subscribe, secrets.token);
    const view = React.useSyncExternalStore(progress.subscribe, progress.view);
    const claude = view.steps.find((step) => step.id === "claude");
    // Done in this dialog: the agent already has its sign-in (a press of Create after a later step failed needs no token again).
    const signedIn = claude?.state === "done";
    const content = config.machine === "content";
    const ready = !content && config.selfUpdate !== null && (config.claudeWay === "login" || signedIn || tokenFit(token));
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
          <legend>Agent type</legend>
          <label className="gp-choice">
            <input
              type="radio"
              name="gp-machine"
              value="personal"
              checked={!content}
              onChange={() => onChange({ place: config.place, selfUpdate: config.selfUpdate, claudeWay: config.claudeWay })}
            />
            <span>Personal agent, this computer</span>
          </label>
          <p className="gp-hint gp-detail">Runs in Docker, on your own computer.</p>
          <label className="gp-choice" aria-disabled="true">
            {/* Disabled, so it can be neither chosen nor submitted: it makes no call. */}
            <input type="radio" name="gp-machine" value="personal-hosted" checked={false} disabled readOnly />
            <span>Personal agent, hosted</span>
            <span className="gp-soon">coming soon</span>
          </label>
          <p className="gp-hint gp-detail">Would run on a megatech machine, not on your computer.</p>
          <label className="gp-choice">
            <input type="radio" name="gp-machine" value="content" checked={content} onChange={() => onChange({ ...config, machine: "content" })} />
            <span>Content machine, hosted</span>
          </label>
          <p className="gp-hint gp-detail">Runs on a megatech machine, not on your computer.</p>
        </fieldset>

        {content ? (
          <fieldset className="gp-create-group" data-gp="content-machine">
            <legend>Megatech sign-in</legend>
            <p className="gp-hint" role="status">
              {CONTENT_MACHINE_SOON}
            </p>
            <p className="gp-hint">Create agent stays off until then. Nothing is made and nothing is charged.</p>
          </fieldset>
        ) : (
          <>
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
          </>
        )}
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

  function Progression({ config }: Props) {
    const view = React.useSyncExternalStore(progress.subscribe, progress.view);
    // A content machine has no steps: Create is held back, so there is nothing to press.
    if (config.machine === "content") return null;
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
