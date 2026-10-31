import type { RelayData } from "../buzz";
import { React } from "../react";
import { ASK_TOOL, STATUS_TOOL } from "../support/agent";
import type { Identity } from "../support/identity";
import { SUPPORT_ORIGIN } from "../support/origin";
import type { Switch } from "../support/switch";

const hostOf = (origin: string) => new URL(origin).host;
const shortKey = (key: string) => `${key.slice(0, 8)}…${key.slice(-8)}`;

export type AgentStatus = {
  /** Whether the agent type and the tools were added when Buzz started: what the switch said then. */
  startedOn: boolean;
  /** Names the host would not take (another plugin has the tool's name), listed on the card. */
  problems: readonly string[];
};

export function createSettingsCard({
  identity,
  relay,
  flag,
  agent,
}: {
  identity: Identity;
  relay: RelayData;
  flag: Switch;
  agent: AgentStatus;
}) {
  return function SupportSettings() {
    const state = React.useSyncExternalStore(identity.subscribe, identity.state);
    const viewer = React.useSyncExternalStore(relay.subscribe, () => relay.snapshot().viewer);
    // What is saved, read back after each change: a profile that will not keep it shows as it is.
    const [saved, setSaved] = React.useState(() => flag.get());
    const [refused, setRefused] = React.useState(false);
    const busy = state.status === "verifying";
    const change = (on: boolean) => {
      flag.set(on);
      const kept = flag.get();
      setSaved(kept);
      setRefused(kept !== on);
    };
    return (
      <section className="mts-settings" aria-label="Megatech support">
        <h2 className="mts-settings-title">Megatech support</h2>
        <h2>Identity</h2>
        <p role="status">
          {state.status === "verified"
            ? `Verified with Megatech support until ${new Date(state.expiresAt).toLocaleTimeString()}. It lasts until you close Buzz or press Forget, and Forget also asks Megatech support to end it.`
            : state.status === "verifying"
              ? "Verifying…"
              : state.status === "unverified" && state.ended
                ? "Your Megatech support session ended. Nothing is sent to Megatech support until you press Verify."
                : "Not verified. Nothing is sent to Megatech support until you press Verify."}
        </p>
        {state.status === "failed" && (
          <p role="alert" data-tone="error">
            {state.text}
          </p>
        )}
        <p className="mts-muted">
          Pressing Verify sends your public key{viewer ? <> (<code>{shortKey(viewer)}</code>)</> : null} to <code>{hostOf(SUPPORT_ORIGIN)}</code> and has Buzz sign,
          with your key, a short statement about a one-time code from Megatech support; the signature goes to Megatech support. The statement is Buzz's owner
          attestation (the kind it uses to say an agent is yours), made over a hash of the code, which nobody holds a key for, so it gives nothing the right to act
          as you. Nothing is published to your community and your key is never read or sent. The session is kept in memory only, so closing Buzz ends it.
        </p>
        <div className="mts-actions">
          <button type="button" className="mts-button" data-primary disabled={busy} onClick={() => void identity.verify().catch(() => {})}>
            {state.status === "verified" ? "Verify again" : "Verify with Megatech support"}
          </button>
          {state.status === "verified" && (
            <button type="button" className="mts-button" onClick={() => identity.forget()}>
              Forget
            </button>
          )}
        </div>

        <h2>Megatech support agent</h2>
        <label className="mts-switch">
          <input type="checkbox" role="switch" checked={saved} onChange={(event) => change(event.target.checked)} />
          <span>Add the Megatech support agent type and its tools</span>
        </label>
        <p className="mts-muted">
          Off by default. When on, you can make an agent of the type Megatech support in Agents; it answers a mention by asking Megatech support. Buzz also gives
          all your agents two tools, <code>{ASK_TOOL}</code> and <code>{STATUS_TOOL}</code>, with which an agent can ask support or open a ticket for you and check
          a ticket's status. They work only while this is on and your identity is verified. The tools are added the next time Buzz starts; turning this off stops
          them at once.
        </p>
        {refused && (
          <p role="alert" data-tone="error">
            Buzz would not keep that choice, so it is still {saved ? "on" : "off"}.
          </p>
        )}
        {saved !== agent.startedOn && <p role="status">Restart Buzz to {saved ? "turn this on" : "turn this off"}.</p>}
        {agent.startedOn && saved === agent.startedOn && <p role="status">On in this session.</p>}
        {agent.problems.map((problem) => (
          <p key={problem} role="alert" data-tone="error">
            {problem}
          </p>
        ))}
      </section>
    );
  };
}
