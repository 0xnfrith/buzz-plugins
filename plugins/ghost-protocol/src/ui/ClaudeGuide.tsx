// The guide in the agent's tab for someone whose agent has no Claude sign-in: what a Claude subscription is, the token's way first (install
// Claude Code, make a token, paste it), and the address's way second. Each command is in a copy block, and each way says what success and
// what its failure look like. This draws and holds nothing: the field's text, the buttons and the sign-in box come from the panel
// (src/ui/ClaudePanel.tsx), which runs the commands.
import type { ReactNode } from "react";
import { COMMANDS, GUIDE, LINKS } from "../claude-words";
import type { Said } from "../gp/claude";
import { React } from "../react";
import { CopyBlock } from "./CopyBlock";

/** A sign-in that failed, under the way it was tried. */
export type Failure = Readonly<{ way: "token" | "login"; message: string; said?: Said }>;

type Props = {
  busy: boolean;
  token: string;
  onToken: (value: string) => void;
  /** Whether what is in the field can be sent. */
  canSend: boolean;
  onSend: () => void;
  onStartLogin: () => void;
  /** The address and the box for its code, while the sign-in by address is under way. */
  login: ReactNode;
  failure: Failure | undefined;
};

const Link = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

function Refusal({ failure, way }: { failure: Failure | undefined; way: Failure["way"] }) {
  if (failure?.way !== way) return null;
  return (
    <div className="gp-refusal" role="alert" data-gp="claude-problem" data-code={failure.said?.code}>
      <p className="gp-problem">{failure.message}</p>
      {failure.said && (
        <p className="gp-note" data-gp="claude-said">
          {GUIDE.said(failure.said.code, failure.said.message)}
        </p>
      )}
    </div>
  );
}

export function ClaudeGuide({ busy, token, onToken, canSend, onSend, onStartLogin, login, failure }: Props) {
  return (
    <div className="gp-guide" data-gp="guide">
      <p className="gp-hint">{GUIDE.intro}</p>
      <p className="gp-hint">
        {GUIDE.subscription} <Link href={LINKS.plans}>{GUIDE.plans}</Link>
      </p>

      <section className="gp-way" aria-labelledby="gp-way-token" data-gp="guide-token">
        <h4 id="gp-way-token">{GUIDE.token.title}</h4>
        <ol>
          <li>
            <p>{GUIDE.token.terminal}</p>
            <p>{GUIDE.token.check}</p>
            <CopyBlock text={COMMANDS.check} />
            <p className="gp-hint">{GUIDE.token.checkOk}</p>
            <p>{GUIDE.token.install}</p>
            <p className="gp-os">{GUIDE.token.unix}</p>
            <CopyBlock text={COMMANDS.installUnix} label={GUIDE.token.unix} />
            <p className="gp-os">{GUIDE.token.windows}</p>
            <CopyBlock text={COMMANDS.installWindows} label={GUIDE.token.windows} />
            <p className="gp-hint">
              {GUIDE.token.installDone} <Link href={LINKS.install}>{GUIDE.token.installHelp}</Link>
            </p>
          </li>
          <li>
            <p>{GUIDE.token.make}</p>
            <CopyBlock text={COMMANDS.token} />
            <p className="gp-hint">{GUIDE.token.makeHow}</p>
          </li>
          <li>
            <p>{GUIDE.token.paste}</p>
            <input
              className="gp-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={GUIDE.token.field}
              value={token}
              disabled={busy}
              onChange={(event) => onToken(event.target.value)}
            />
            <div className="gp-row">
              <button type="button" className="gp-button" disabled={busy || !canSend} onClick={onSend}>
                {GUIDE.token.send}
              </button>
            </div>
          </li>
        </ol>
        <Refusal failure={failure} way="token" />
        <p className="gp-hint" data-gp="guide-token-expect">
          {GUIDE.token.works} {GUIDE.token.fails}
        </p>
      </section>

      <section className="gp-way" aria-labelledby="gp-way-login" data-gp="guide-login">
        <h4 id="gp-way-login">{GUIDE.login.title}</h4>
        <p className="gp-hint">{GUIDE.login.why}</p>
        <ol>
          <li>
            <p>{GUIDE.login.press}</p>
            <div className="gp-row">
              <button type="button" className="gp-button" disabled={busy} onClick={onStartLogin}>
                {GUIDE.login.start}
              </button>
            </div>
          </li>
          <li>
            <p>{GUIDE.login.open}</p>
          </li>
          <li>
            <p>{GUIDE.login.code}</p>
          </li>
        </ol>
        {login}
        <Refusal failure={failure} way="login" />
        <p className="gp-hint" data-gp="guide-login-expect">
          {GUIDE.login.works} {GUIDE.login.fails}
        </p>
      </section>
    </div>
  );
}
