import { React } from "../react";
import type { Connection } from "../beeper/store";

type Props = {
  connection: Exclude<Connection, "ready">;
  /** Fixed text from the store for the `error` connection. */
  problem?: string;
  onRetry(): void;
  onSettings(): void;
};

// A function, not a constant: JSX needs React, which the host supplies only once the plugin is applied.
const setup = () => (
  <ol>
    <li>Open Beeper Desktop and go to Settings, then Developers.</li>
    <li>Turn on Beeper Desktop API.</li>
    <li>Under Approved connections, press + to make an access token.</li>
    <li>Paste the token in this plugin's settings.</li>
  </ol>
);

/** What the page says when Beeper cannot be read: what is wrong, and what to do about it. Every text is fixed. */
export function Problem({ connection, problem, onRetry, onSettings }: Props) {
  if (connection === "checking")
    return (
      <div className="mtb-empty" role="status">
        Connecting to Beeper Desktop…
      </div>
    );
  const retry = (
    <button type="button" className="mtb-button" onClick={onRetry}>
      Check again
    </button>
  );
  const settings = (primary: boolean) => (
    <button type="button" className="mtb-button" data-primary={primary ? "" : undefined} onClick={onSettings}>
      Open settings
    </button>
  );
  let body: React.ReactNode;
  switch (connection) {
    case "no-token":
      body = (
        <>
          <h2>Connect Beeper</h2>
          <p>This page shows your Beeper chats and lets you reply. It needs an access token from Beeper Desktop on this computer.</p>
          {setup()}
          <div className="mtb-actions">{settings(true)}</div>
        </>
      );
      break;
    case "unavailable":
      body = (
        <>
          <h2>Beeper is not running, or its API is off</h2>
          <p>Beeper Desktop has to be open on this computer, with its Desktop API turned on: Settings, then Developers, then Beeper Desktop API.</p>
          <p className="mtb-muted">If you changed the API's port, set the address in this plugin's settings.</p>
          <div className="mtb-actions">
            {retry}
            {settings(false)}
          </div>
        </>
      );
      break;
    case "curl-missing":
      body = (
        <>
          <h2>curl was not found</h2>
          <p>
            Buzz cannot reach Beeper Desktop directly, because it only allows secure connections. So this plugin asks the <code>curl</code> program on this
            computer to do it. macOS, Windows 10 and later and most Linux systems have it; install it, then check again.
          </p>
          <div className="mtb-actions">{retry}</div>
        </>
      );
      break;
    case "unauthorized":
      body = (
        <>
          <h2>Beeper did not accept the token</h2>
          <p>It may have been removed in Beeper. Make a new one under Settings, Developers, Approved connections, and paste it in this plugin's settings.</p>
          <div className="mtb-actions">
            {settings(true)}
            {retry}
          </div>
        </>
      );
      break;
    case "forbidden":
      body = (
        <>
          <h2>The token cannot do this</h2>
          <p>Beeper accepted the token but would not let it read or send chats. Make a new token that allows both, and paste it in this plugin's settings.</p>
          <div className="mtb-actions">
            {settings(true)}
            {retry}
          </div>
        </>
      );
      break;
    default:
      body = (
        <>
          <h2>Something went wrong</h2>
          <p>{problem ?? "Beeper Desktop gave an answer this plugin could not use."}</p>
          <div className="mtb-actions">{retry}</div>
        </>
      );
  }
  return (
    <div className="mtb-empty">
      <div className="mtb-panel" role="alert">
        {body}
      </div>
    </div>
  );
}
