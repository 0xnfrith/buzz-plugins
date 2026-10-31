import type { RelayData } from "../buzz";
import { React } from "../react";
import { ERROR_TEXT, SupportError } from "../support/client";
import type { Identity } from "../support/identity";
import { SUPPORT_ORIGIN } from "../support/origin";
import type { Support } from "../support/service";
import { LIMITS, type Asked, type Opened, type TicketDetail, type TicketSummary } from "../support/types";

type Tab = "ask" | "open" | "tickets";
const TABS: { id: Tab; label: string }[] = [
  { id: "ask", label: "Ask" },
  { id: "open", label: "Open a ticket" },
  { id: "tickets", label: "My tickets" },
];

const hostOf = (origin: string) => new URL(origin).host;
const shortKey = (key: string) => `${key.slice(0, 8)}…${key.slice(-8)}`;
const words = (error: unknown) => (error instanceof SupportError ? ERROR_TEXT[error.kind] : ERROR_TEXT.unavailable);

export function createSupportPage({ identity, support, relay }: { identity: Identity; support: Support; relay: RelayData }) {
  return function SupportPage() {
    const state = React.useSyncExternalStore(identity.subscribe, identity.state);
    const [tab, setTab] = React.useState<Tab>("ask");
    // What the person typed lives here, above the Verify card, so a session that ends in the middle of a form does not take it along.
    const [question, setQuestion] = React.useState("");
    const [subject, setSubject] = React.useState("");
    const [body, setBody] = React.useState("");
    // What the last Ask and the last Open came to lives here too: a request that ends after the tab was left still clears the form it
    // came from, so pressing the button again cannot make a second ticket, and the answer is there when the tab is back.
    const [asked, setAsked] = React.useState<Asked | undefined>();
    const [opened, setOpened] = React.useState<Opened | undefined>();
    // Whether a request is out is the page's too: coming back to a tab whose request has not ended must not offer the button again.
    const [asking, setAsking] = React.useState(false);
    const [opening, setOpening] = React.useState(false);
    const tabs = React.useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
    const was = React.useRef(state.status);
    React.useEffect(() => {
      // The Verify card goes away when the check succeeds and takes the focus with it: put it on the tabs.
      if (was.current !== "verified" && state.status === "verified") tabs.current[tab]?.focus();
      was.current = state.status;
    }, [state.status]);
    const choose = (next: Tab) => {
      setTab(next);
      tabs.current[next]?.focus();
    };
    const onKeys = (event: React.KeyboardEvent) => {
      const at = TABS.findIndex(({ id }) => id === tab);
      const to =
        event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : undefined;
      if (to === undefined) return;
      event.preventDefault();
      choose((TABS[(to + TABS.length) % TABS.length] as { id: Tab }).id);
    };
    return (
      <div className="mts-root">
        <header className="mts-bar">
          <span className="mts-wordmark">Megatech</span>
          <span className="mts-sep" aria-hidden="true" />
          <h1 className="mts-title">Support</h1>
        </header>
        <div className="mts-body">
          {state.status !== "verified" ? (
            <VerifyCard identity={identity} relay={relay} />
          ) : (
            <>
              <div className="mts-tabs" role="tablist" aria-label="Support" onKeyDown={onKeys}>
                {TABS.map(({ id, label }) => (
                  <button
                    key={id}
                    ref={(element) => void (tabs.current[id] = element)}
                    type="button"
                    role="tab"
                    id={`mts-tab-${id}`}
                    aria-selected={tab === id}
                    aria-controls={tab === id ? "mts-panel" : undefined}
                    tabIndex={tab === id ? 0 : -1}
                    className="mts-tab"
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div role="tabpanel" id="mts-panel" aria-labelledby={`mts-tab-${tab}`} className="mts-tabpanel">
                {tab === "ask" && <AskTab support={support} question={question} setQuestion={setQuestion} result={asked} setResult={setAsked} busy={asking} setBusy={setAsking} />}
                {tab === "open" && (
                  <OpenTab
                    support={support}
                    subject={subject}
                    setSubject={setSubject}
                    body={body}
                    setBody={setBody}
                    result={opened}
                    setResult={setOpened}
                    busy={opening}
                    setBusy={setOpening}
                  />
                )}
                {tab === "tickets" && <TicketsTab support={support} />}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };
}

/** What pressing Verify does, in the words the person agrees to. The same text is on the Settings card. */
export function VerifyCard({ identity, relay }: { identity: Identity; relay: RelayData }) {
  const state = React.useSyncExternalStore(identity.subscribe, identity.state);
  const viewer = React.useSyncExternalStore(relay.subscribe, () => relay.snapshot().viewer);
  const busy = state.status === "verifying";
  return (
    <section className="mts-panel" aria-labelledby="mts-verify-title">
      <h2 id="mts-verify-title">Verify your identity</h2>
      <p>Megatech support checks that you hold this Buzz identity before it shows anything about you. Pressing Verify:</p>
      <ul>
        <li>
          sends your public key{viewer ? <> (<code>{shortKey(viewer)}</code>)</> : null} to <code>{hostOf(SUPPORT_ORIGIN)}</code>;
        </li>
        <li>has Buzz sign, with your key, a short statement about a one-time code from Megatech support, and sends that signature to Megatech support.</li>
      </ul>
      <p className="mts-muted">
        The statement is Buzz's owner attestation, the kind it uses to say an agent is yours. It is made over a hash of the code, which nobody holds a key for, so it
        gives nothing the right to act as you. Nothing is published to your community, your key is never read or sent, and nothing else is sent.
      </p>
      <div className="mts-actions">
        <button type="button" className="mts-button" data-primary disabled={busy} onClick={() => void identity.verify().catch(() => {})}>
          {busy ? "Verifying…" : "Verify with Megatech support"}
        </button>
      </div>
      {state.status === "failed" && (
        <p role="alert" data-tone="error">
          {state.text}
        </p>
      )}
      {state.status === "unverified" && state.ended && <p role="status">Your Megatech support session ended. Verify again to go on; what you typed is still here.</p>}
    </section>
  );
}

/** Keeps a component from setting state after it went away (a request outlives a tab switch). */
function useAlive() {
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

function AskTab({
  support,
  question,
  setQuestion,
  result,
  setResult,
  busy,
  setBusy,
}: {
  support: Support;
  question: string;
  setQuestion: (text: string) => void;
  result: Asked | undefined;
  setResult: (result: Asked | undefined) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const alive = useAlive();
  const [error, setError] = React.useState<string | undefined>();
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !question.trim()) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const asked = await support.askOrOpen(question);
      // The form and the result are the page's, so they are set even if this tab was left while the request ran.
      setQuestion("");
      setResult(asked);
    } catch (failure) {
      if (alive.current) setError(words(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form className="mts-form" onSubmit={send}>
        <label htmlFor="mts-question">Your question</label>
        <textarea
          id="mts-question"
          value={question}
          maxLength={LIMITS.question}
          placeholder="What do you need help with?"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <div className="mts-actions">
          <button type="submit" className="mts-button" data-primary disabled={busy || !question.trim()}>
            {busy ? "Asking…" : "Ask support"}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" data-tone="error">
          {error}
        </p>
      )}
      {result && (
        <section className="mts-result" role="status" aria-label="Support's reply">
          <span className="mts-muted">
            Ticket <span className="mts-id">{result.ticket_id}</span>
          </span>
          {result.answer ? <p className="mts-answer">{result.answer}</p> : <p>No answer yet: a ticket is open and Megatech support will reply there. Find it under My tickets.</p>}
        </section>
      )}
    </>
  );
}

function OpenTab({
  support,
  subject,
  setSubject,
  body,
  setBody,
  result: opened,
  setResult: setOpened,
  busy,
  setBusy,
}: {
  support: Support;
  subject: string;
  setSubject: (text: string) => void;
  body: string;
  setBody: (text: string) => void;
  result: Opened | undefined;
  setResult: (result: Opened | undefined) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const alive = useAlive();
  const [error, setError] = React.useState<string | undefined>();
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !subject.trim() || !body.trim()) return;
    setBusy(true);
    setError(undefined);
    setOpened(undefined);
    try {
      // A retry of the same text after a failure, or a second press, is the same ticket: the service layer keeps the key (see service.ts).
      const ticket = await support.open(subject, body);
      setSubject("");
      setBody("");
      setOpened(ticket);
    } catch (failure) {
      if (alive.current) setError(words(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form className="mts-form" onSubmit={send}>
        <label htmlFor="mts-subject">Subject</label>
        <input id="mts-subject" type="text" value={subject} maxLength={LIMITS.subject} onChange={(event) => setSubject(event.target.value)} />
        <label htmlFor="mts-body">What happened</label>
        <textarea id="mts-body" value={body} maxLength={LIMITS.body} onChange={(event) => setBody(event.target.value)} />
        <div className="mts-actions">
          <button type="submit" className="mts-button" data-primary disabled={busy || !subject.trim() || !body.trim()}>
            {busy ? "Opening…" : "Open ticket"}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" data-tone="error">
          {error}
        </p>
      )}
      {opened && (
        <section className="mts-result" role="status" aria-label="Ticket opened">
          <span>
            Ticket <span className="mts-id">{opened.ticket_id}</span> is {opened.status}. Find it under My tickets.
          </span>
        </section>
      )}
    </>
  );
}

function TicketsTab({ support }: { support: Support }) {
  const alive = useAlive();
  const [tickets, setTickets] = React.useState<TicketSummary[] | undefined>();
  const [open, setOpen] = React.useState<string | undefined>();
  const [detail, setDetail] = React.useState<TicketDetail | undefined>();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const refresh = React.useRef<HTMLButtonElement | null>(null);
  // Each load has a number, and only the latest may show its answer or end the waiting: a slow answer for a ticket that was left must
  // not replace the one now open.
  const loads = React.useRef(0);
  const load = async (id: string | undefined) => {
    const mine = ++loads.current;
    const current = () => alive.current && mine === loads.current;
    setBusy(true);
    setError(undefined);
    try {
      if (id) {
        const next = await support.detail(id);
        if (current()) setDetail(next);
      } else {
        const next = await support.list();
        if (current()) setTickets(next);
      }
    } catch (failure) {
      if (current()) setError(words(failure));
    } finally {
      if (current()) setBusy(false);
    }
  };
  React.useEffect(() => {
    void load(open);
  }, [open]);
  return (
    <>
      <div className="mts-actions">
        {open && (
          <button
            type="button"
            className="mts-button"
            onClick={() => {
              setDetail(undefined);
              setOpen(undefined);
              // This button goes away with the ticket: the focus goes to the one that stays.
              refresh.current?.focus();
            }}
          >
            Back to my tickets
          </button>
        )}
        <button ref={refresh} type="button" className="mts-button" disabled={busy} onClick={() => void load(open)}>
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error && (
        <p role="alert" data-tone="error">
          {error}
        </p>
      )}
      {!open && tickets && tickets.length === 0 && !error && <p className="mts-muted">You have no tickets.</p>}
      {!open && tickets && tickets.length > 0 && (
        <ul className="mts-list" aria-label="Your tickets">
          {tickets.map((ticket) => (
            <li key={ticket.ticket_id}>
              <button type="button" className="mts-row" onClick={() => setOpen(ticket.ticket_id)}>
                <span className="mts-id">{ticket.ticket_id}</span>
                <span className="mts-row-subject">{ticket.subject}</span>
                <span className="mts-chip">{ticket.status}</span>
                <span className="mts-muted">{new Date(ticket.updated_at).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && detail && detail.ticket_id === open && (
        <section aria-label={`Ticket ${detail.ticket_id}`} className="mts-form">
          <h2 className="mts-title">
            <span className="mts-id">{detail.ticket_id}</span> {detail.subject} <span className="mts-chip">{detail.status}</span>
          </h2>
          <ul className="mts-messages" aria-label="Messages">
            {detail.messages.map((message, index) => (
              <li key={index} className="mts-message" data-from={message.from}>
                <span className="mts-message-head">
                  {message.from === "you" ? "You" : "Megatech support"} · {new Date(message.at).toLocaleString()}
                </span>
                <span className="mts-text">{message.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
