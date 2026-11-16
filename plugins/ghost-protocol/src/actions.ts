// The four buttons (interface note, section 10): Update and Roll back ask GHOST Protocol inside the container; Restart and Stop ask Docker.
// Each runs one `docker` call and comes back as a line to show.
import type { Runner } from "./docker";
import { restartArgs, rollbackArgs, stopArgs, updateArgs, containerOf } from "./commands";
import { gpLines } from "./status";
import { WORDS } from "./words";

export type Outcome = Readonly<{
  /** `ok` it was done or asked for; `info` GHOST Protocol answered that there is nothing to do; `problem` it did not work. */
  tone: "ok" | "info" | "problem";
  text: string;
  /** GHOST Protocol answered `no-updater`: the agent has no update helper, and the update goes by hand. */
  noUpdater?: true;
}>;

/** An update or a roll back waits for the agent to finish its task, and `docker exec` returns at once; this is for a slow Docker. */
const GP_MS = 30_000;
/** `docker stop` gives the container ten seconds before it kills it, and `restart` does that and starts it again. */
const DOCKER_MS = 60_000;
const LINE_MAX = 200;

/** The first non-empty line of what Docker said, cut to a length that fits a line. */
export function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((one) => one.trim() !== "")?.trim() ?? "";
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX)}…` : line;
}

const withDetail = (text: string, detail: string): string => (detail === "" ? text : `${text} ${detail}`);

type Ran = NonNullable<Awaited<ReturnType<Runner>>>;

/** The outcome of a call that did not end at all: no Docker, or a Buzz that cannot start a process. */
function notRun(ran: Ran): Outcome | undefined {
  if (ran.kind === "unsupported") return { tone: "problem", text: WORDS.unsupported };
  if (ran.kind === "unavailable") return { tone: "problem", text: WORDS.dockerUnavailable };
  return undefined;
}

/**
 * `gp update request`, or `gp update rollback`. Resolves with `undefined` when the caller left first.
 * The answers are the interface note's (answer 4, and `no-updater`): `GP_UPDATE=requested` or `rollback-requested` on exit 0, and on a
 * failure a `GP_ERROR` that is `no-updater`, `no-update-available`, `update-in-progress` or `no-previous-version`, or another code.
 */
export async function askToUpdate(run: Runner, slug: string, which: "update" | "rollback"): Promise<Outcome | undefined> {
  const ran = await run(which === "update" ? updateArgs(slug) : rollbackArgs(slug), GP_MS);
  if (ran === undefined) return undefined;
  const failed = notRun(ran);
  if (failed) return failed;
  if (ran.kind !== "exit") return undefined;
  const lines = gpLines(ran.stdout);
  if (ran.code === 0) {
    const answer = lines.get("UPDATE");
    if (which === "update" && answer === "requested") return { tone: "ok", text: WORDS.updateRequested };
    if (which === "rollback" && answer === "rollback-requested") return { tone: "ok", text: WORDS.rollbackRequested };
    return { tone: "problem", text: WORDS.gpNotUnderstood };
  }
  const code = lines.get("ERROR");
  if (code === undefined) return { tone: "problem", text: withDetail(WORDS.dockerFailed, firstLine(ran.stderr)) };
  if (code === "no-updater") return { tone: "info", text: which === "update" ? WORDS.noUpdaterTitle : WORDS.noUpdaterRollback, noUpdater: true };
  if (code === "no-update-available") return { tone: "info", text: WORDS.noUpdateAvailable };
  if (code === "update-in-progress") return { tone: "info", text: WORDS.updateInProgress };
  if (code === "no-previous-version") return { tone: "info", text: WORDS.noPreviousVersion };
  const message = lines.get("ERROR_MESSAGE");
  return { tone: "problem", text: message === undefined || message === "" ? WORDS.gpRefused(code) : `${message} (${code})` };
}

/** `docker restart gp-<slug>` or `docker stop gp-<slug>`. Resolves with `undefined` when the caller left first. */
export async function askDocker(run: Runner, slug: string, which: "restart" | "stop"): Promise<Outcome | undefined> {
  const container = containerOf(slug);
  const ran = await run(which === "restart" ? restartArgs(slug) : stopArgs(slug), DOCKER_MS);
  if (ran === undefined) return undefined;
  const failed = notRun(ran);
  if (failed) return failed;
  if (ran.kind !== "exit") return undefined;
  if (ran.code === 0) return { tone: "ok", text: which === "restart" ? WORDS.restarted(container) : WORDS.stoppedNow(container) };
  const text = which === "restart" ? WORDS.restartFailed(container) : WORDS.stopFailed(container);
  return { tone: "problem", text: withDetail(text, firstLine(ran.stderr)) };
}
