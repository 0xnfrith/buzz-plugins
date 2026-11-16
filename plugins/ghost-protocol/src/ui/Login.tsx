// The two boxes the Claude sign-in and the refused relay draw: the address to sign in at with a field for the code, and the agent's public
// key with a copy button. Both are plain controls with `type="button"`, since they sit inside Buzz's own forms and must not submit them.
import type { Progress } from "../gp/progress";
import { React } from "../react";
import { copyText } from "./copy";

/** Way A: the address `gp claude login` printed, and the code the person copies back from it. */
export function Login({ progress, url }: { progress: Progress; url: string }) {
  const [code, setCode] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const send = () => {
    if (progress.submitCode(code)) setCode("");
  };
  return (
    <div className="gp-login" role="group" aria-label="Sign in to Claude" data-gp="login">
      <p className="gp-question">Sign in to Claude at this address, then paste the code it gives you.</p>
      <p className="gp-address">
        <a href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
      </p>
      <div className="gp-row">
        <button
          type="button"
          className="gp-button"
          onClick={() => {
            void copyText(url).then((done) => setCopied(done));
          }}
        >
          {copied ? "Copied" : "Copy address"}
        </button>
      </div>
      <div className="gp-row">
        <input
          className="gp-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-label="Code from Claude"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends the code, and does not submit a form around this.
            if (event.key === "Enter") {
              event.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="gp-button" disabled={code.trim() === ""} onClick={send}>
          Continue
        </button>
        <button type="button" className="gp-button" onClick={() => progress.cancelCode()}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The relay does not accept the agent: its public key, for the person to give to the relay's admin. */
export function Refused({ pubkey }: { pubkey: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="gp-refused" role="group" aria-label="The relay does not accept the agent" data-gp="refused">
      <p className="gp-question">Give this public key to your relay's admin:</p>
      <p className="gp-address">
        <code data-gp="agent-key">{pubkey}</code>
      </p>
      <div className="gp-row">
        <button
          type="button"
          className="gp-button"
          onClick={() => {
            void copyText(pubkey).then((done) => setCopied(done));
          }}
        >
          {copied ? "Copied" : "Copy public key"}
        </button>
      </div>
    </div>
  );
}
