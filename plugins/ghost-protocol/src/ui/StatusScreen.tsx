import type { Host } from "../buzz";
import { askDocker, askToUpdate, type Outcome } from "../actions";
import { containerOf } from "../commands";
import { runnerFor } from "../docker";
import { NOTHING_YET, POLL_MS, afterButton, imageOf, observe, type Memory, type View } from "../observe";
import { React } from "../react";
import type { Status } from "../status";
import { sameOffer, updateByHand, type ByHand } from "../update-by-hand";
import { CLAUDE_WORDS, OTHER_INTERFACE, REFUSED_NOT_MEMBER, RELAY_WORDS, STATE_WORDS, WORDS } from "../words";
import { CopyBlock } from "./CopyBlock";

/** The most of a text from GHOST Protocol that the screen shows: a long one is cut, so it cannot fill the page. */
const SHOWN_MAX = 300;
const clip = (text: string): string => (text.length > SHOWN_MAX ? `${text.slice(0, SHOWN_MAX)}…` : text);

/** A line of what the screen has to say, and whether it is a problem (it is then an alert). */
const lineOf = (view: View | undefined, container: string): { text: string; problem: boolean } => {
  if (view === undefined) return { text: WORDS.looking(container), problem: false };
  switch (view.kind) {
    case "status":
      return { text: STATE_WORDS[view.status.state], problem: view.status.state === "error" };
    case "other-interface":
      return { text: OTHER_INTERFACE, problem: true };
    case "unreadable":
      return { text: WORDS.unreadable, problem: true };
    case "swapping":
      return { text: WORDS.swapping, problem: false };
    case "stopped":
      return { text: WORDS.stopped(container, view.dockerState), problem: true };
    case "gone":
      return { text: WORDS.gone(container), problem: true };
    case "not-answering":
      return { text: WORDS.notAnswering(container), problem: true };
    case "docker-unavailable":
      return { text: WORDS.dockerUnavailable, problem: true };
    case "unsupported":
      return { text: WORDS.unsupported, problem: true };
  }
};

type Job = "update" | "rollback" | "restart" | "stop";

function Facts({ status }: { status: Status }) {
  return (
    <dl className="gp-facts">
      <dt>{WORDS.state}</dt>
      <dd>{STATE_WORDS[status.state]}</dd>
      <dt>{WORDS.version}</dt>
      <dd className="gp-mono">{clip(status.version)}</dd>
      <dt>{WORDS.relay}</dt>
      <dd>{RELAY_WORDS[status.relay]}</dd>
      <dt>{WORDS.relayUrl}</dt>
      <dd className="gp-mono">{clip(status.relayUrl)}</dd>
      <dt>{WORDS.claude}</dt>
      <dd>{CLAUDE_WORDS[status.claude]}</dd>
      <dt>{WORDS.update}</dt>
      <dd>{status.update.available ? WORDS.updateAvailable(status.update.version === null ? null : clip(status.update.version)) : WORDS.noUpdate}</dd>
      <dt>{WORDS.previousVersion}</dt>
      <dd className={status.previousVersion === null ? undefined : "gp-mono"}>{status.previousVersion === null ? WORDS.noPrevious : clip(status.previousVersion)}</dd>
    </dl>
  );
}

/**
 * The status of one agent, found by the `<slug>` of its container `gp-<slug>`: what `gp status --json` says, and the four buttons. It
 * looks about every ten seconds for as long as it is on the page, and its calls end with it.
 */
export function createStatusScreen(host: Host) {
  // `again` changes when something outside the screen (a sign-in in the same tab) has changed what it would show: it looks at once.
  return function StatusScreen({ slug, again = 0 }: { slug: string; again?: number }) {
    const container = containerOf(slug);
    const [view, setView] = React.useState<View>();
    const [looks, setLooks] = React.useState(0);
    const memory = React.useRef<Memory>(NOTHING_YET);

    // Looks now, and again ten seconds after each answer. Asking for another look (after a button) starts this over.
    React.useEffect(() => {
      const abort = new AbortController();
      const run = runnerFor(host, abort.signal);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const look = async () => {
        const seen = await observe(run, slug, memory.current, Date.now());
        if (seen === undefined || abort.signal.aborted) return;
        memory.current = seen.memory;
        setView(seen.view);
        timer = setTimeout(() => void look(), POLL_MS);
      };
      void look();
      return () => {
        abort.abort();
        clearTimeout(timer);
      };
    }, [slug, looks, again]);

    // The buttons' calls end with the screen too.
    const life = React.useRef<AbortController | undefined>(undefined);
    React.useEffect(() => {
      const abort = new AbortController();
      life.current = abort;
      return () => abort.abort();
    }, []);

    const [working, setWorking] = React.useState<Job>();
    const [outcome, setOutcome] = React.useState<Outcome>();
    // The agent has no update helper: the Update button gives way to the steps, made once, from the update on offer when the button was
    // pressed. They stay as they were for as long as the screen is open: a newer offer does not change a step the person is part way
    // through, and the steps do not go when step 2 removes the container and the status cannot be read for a while.
    const [byHand, setByHand] = React.useState<{ steps: ByHand; offer: Pick<Status["update"], "version" | "image"> }>();

    const press = async (job: Job) => {
      const signal = life.current?.signal;
      if (signal === undefined || signal.aborted || working !== undefined) return;
      const run = runnerFor(host, signal);
      setWorking(job);
      setOutcome(undefined);
      const done = job === "update" || job === "rollback" ? await askToUpdate(run, slug, job) : await askDocker(run, slug, job);
      if (done === undefined || signal.aborted) return;
      // Only an update goes by hand. The image GHOST Protocol named for the update is the whole of the pull and the run. Only without one do
      // the steps name the image the container was made from, which is then read from Docker.
      const offer = done.noUpdater === true && job === "update" && status !== undefined ? { version: status.update.version, image: status.update.image } : undefined;
      const image = offer?.image.kind === "none" ? await imageOf(run, slug) : undefined;
      if (signal.aborted) return;
      if (offer !== undefined) setByHand({ steps: updateByHand(slug, image, offer), offer });
      // An update or a roll back that was taken is under way, until a status with another version says it is over; a stop or a restart
      // that was taken ends any update, so the next look says what it finds.
      memory.current = afterButton(memory.current, job, done.tone === "ok", status?.version);
      setWorking(undefined);
      // The steps say it all when the agent has no update helper.
      setOutcome(offer !== undefined ? undefined : done);
      setLooks((n) => n + 1);
    };

    const { text, problem } = lineOf(view, container);
    const status = view?.kind === "status" ? view.status : undefined;
    const kind = view?.kind;
    const buttons = {
      update: kind === "status" && byHand === undefined,
      rollback: kind === "status",
      restart: kind === "status" || kind === "not-answering" || kind === "stopped",
      stop: kind === "status" || kind === "not-answering",
    };
    const busy = working !== undefined;
    const button = (job: Job, label: string, disabled = false) => (
      <button type="button" className="gp-button" disabled={busy || disabled} onClick={() => void press(job)}>
        {label}
      </button>
    );

    return (
      <section className="gp-panel gp-agent" aria-labelledby="gp-agent-title">
        <h2 id="gp-agent-title">{container}</h2>
        <p className="gp-status" role={problem ? "alert" : "status"}>
          {text}
        </p>
        {view?.kind === "not-answering" && (view.code !== undefined || view.message !== undefined) && (
          <p className="gp-note">{clip([view.message, view.code === undefined ? undefined : `(${view.code})`].filter(Boolean).join(" "))}</p>
        )}
        {status && <Facts status={status} />}
        {status?.error && (
          <dl className="gp-facts gp-problem">
            <dt>{WORDS.errorCode}</dt>
            <dd className="gp-mono">{clip(status.error.code)}</dd>
            <dt>{WORDS.errorMessage}</dt>
            <dd>{clip(status.error.message)}</dd>
          </dl>
        )}
        {status?.relay === "refused-not-member" && (
          <div className="gp-refused" role="alert">
            <p>{REFUSED_NOT_MEMBER}</p>
            <p className="gp-label">{WORDS.publicKey}</p>
            <CopyBlock text={status.agentPubkey} />
          </div>
        )}
        {(buttons.update || buttons.rollback || buttons.restart || buttons.stop) && (
          <div className="gp-buttons">
            {buttons.update && button("update", WORDS.buttons.update)}
            {buttons.rollback && button("rollback", WORDS.buttons.rollback, status?.previousVersion === null)}
            {buttons.restart && button("restart", WORDS.buttons.restart)}
            {buttons.stop && button("stop", WORDS.buttons.stop)}
          </div>
        )}
        {busy && <p role="status">{WORDS.working}</p>}
        {outcome && (
          <p className={outcome.tone === "problem" ? "gp-problem" : undefined} role={outcome.tone === "problem" ? "alert" : "status"}>
            {outcome.text}
          </p>
        )}
        {byHand && (
          <div className="gp-steps">
            <p>{byHand.steps.kind === "refused" ? WORDS.noUpdaterRefusedTitle : WORDS.noUpdaterTitle}</p>
            {byHand.steps.kind === "refused" ? (
              <p className="gp-problem" role="alert">
                {WORDS.noUpdaterRefused}
              </p>
            ) : (
              <>
                <p className="gp-note">{byHand.steps.kind === "pinned" ? WORDS.noUpdaterPinned : WORDS.noUpdaterDigest}</p>
                <ol>
                  {byHand.steps.steps.map((step) => (
                    <li key={step}>
                      <CopyBlock text={step} />
                    </li>
                  ))}
                </ol>
                <p className="gp-note">{WORDS.noUpdaterNote(`${container}-data`)}</p>
              </>
            )}
            {status?.update.available === true && !sameOffer(byHand.offer, status.update) && (
              <p className="gp-note" role="status">
                {WORDS.noUpdaterChanged}
              </p>
            )}
          </div>
        )}
      </section>
    );
  };
}
