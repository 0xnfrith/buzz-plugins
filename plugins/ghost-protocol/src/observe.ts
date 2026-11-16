// One look at an agent: ask `gp status --json`, and when that fails ask `docker inspect` why. The status screen repeats it about every ten
// seconds while it is open. What one look shows can depend on the looks before it, in one case only:
// while an update swaps the container, `gp-<slug>` is missing or stopped for a few seconds, and that is not an error yet. An update is
// under way when the last status said `updating`, and also from the moment this screen asked for one (an Update or a Roll back that was
// taken) until a status with another version arrives: a swap can be over in less than the ten seconds between two looks.
import type { Runner } from "./docker";
import { imageCall, stateCall, statusCall } from "./commands";
import { gpLines, readStatus, type State, type Status } from "./status";

/** About how often the screen looks, in milliseconds. */
export const POLL_MS = 10_000;
/** How long a missing or stopped container counts as an update still under way, from the first look that finds it so. */
export const SWAP_MS = 120_000;

export type View =
  | Readonly<{ kind: "status"; status: Status }>
  /** `interface` is a number this plugin does not know. */
  | Readonly<{ kind: "other-interface" }>
  /** `gp status --json` printed something this plugin cannot read. */
  | Readonly<{ kind: "unreadable" }>
  /** The container is missing or stopped, and the last status said `updating`: the update is swapping it. */
  | Readonly<{ kind: "swapping" }>
  /** The container exists and is not running; `dockerState` is Docker's word for it (`exited`, `created`, `paused`…). */
  | Readonly<{ kind: "stopped"; dockerState: string }>
  /** There is no container `gp-<slug>`. */
  | Readonly<{ kind: "gone" }>
  /** The container runs and `gp status` failed; `code` and `message` are GHOST Protocol's `GP_ERROR` lines when it printed them. */
  | Readonly<{ kind: "not-answering"; code: string | undefined; message: string | undefined }>
  | Readonly<{ kind: "docker-unavailable" }>
  | Readonly<{ kind: "unsupported" }>;

/** What one look carries to the next. */
export type Memory = Readonly<{
  /** The `state` of the last status that was read. */
  lastState: State | undefined;
  /** When a look first found the container missing or stopped during an update (milliseconds). */
  gapSince: number | undefined;
  /**
   * An Update or a Roll back this screen asked for, which has not finished: `from` is the version the agent was on when it asked, and
   * `sawUpdating` says whether a status has said `updating` since.
   */
  asked: Readonly<{ from: string; sawUpdating: boolean }> | undefined;
}>;

export const NOTHING_YET: Memory = { lastState: undefined, gapSince: undefined, asked: undefined };

/** The memory after the screen asked for an update or a roll back, while the agent was on `version`. */
export const askedFor = (before: Memory, version: string): Memory => ({ ...before, asked: { from: version, sawUpdating: false } });

/**
 * What a button that Docker or GHOST Protocol accepted does to what the screen knows. An Update or a Roll back is under way from then on
 * (`version` is the one the agent was on). A Stop or a Restart is the user's own doing and ends any update that was under way: the next
 * look says what it finds, so a container that is stopped is shown as stopped, with its Restart, and not as being swapped.
 */
export function afterButton(before: Memory, job: "update" | "rollback" | "restart" | "stop", accepted: boolean, version: string | undefined): Memory {
  if (!accepted) return before;
  if (job === "restart" || job === "stop") return NOTHING_YET;
  return version === undefined ? before : askedFor(before, version);
}

/** What a status does to an ask that is under way: the new version ends it, and so does an update that ended on the old one. */
function afterStatus(asked: Memory["asked"], status: Status): Memory["asked"] {
  if (asked === undefined || status.version !== asked.from) return undefined;
  if (status.state === "updating") return { from: asked.from, sawUpdating: true };
  return asked.sawUpdating ? undefined : asked;
}

export type Seen = Readonly<{ view: View; memory: Memory }>;

/** What Docker says of a container that is not there: `Error: No such object: gp-x`, or `No such container: gp-x`. */
const NOT_THERE = /No such (object|container)/i;

/** Looks once. Resolves with `undefined` when the caller left first (the runner returns nothing). */
export async function observe(run: Runner, slug: string, before: Memory, now: number): Promise<Seen | undefined> {
  const asked = await run(statusCall(slug));
  if (asked === undefined) return undefined;
  if (asked.kind === "unsupported") return { view: { kind: "unsupported" }, memory: before };
  if (asked.kind === "unavailable") return { view: { kind: "docker-unavailable" }, memory: before };
  if (asked.code === 0) {
    const read = readStatus(asked.stdout);
    if (read.kind === "status") {
      const memory = { lastState: read.status.state, gapSince: undefined, asked: afterStatus(before.asked, read.status) };
      return { view: { kind: "status", status: read.status }, memory };
    }
    return { view: { kind: read.kind }, memory: before };
  }
  // `docker exec` failed: the container is stopped or gone (or Docker is down, or `gp` itself failed). `docker inspect` tells which.
  const inspected = await run(stateCall(slug));
  if (inspected === undefined) return undefined;
  if (inspected.kind === "unsupported") return { view: { kind: "unsupported" }, memory: before };
  if (inspected.kind === "unavailable") return { view: { kind: "docker-unavailable" }, memory: before };
  let view: View;
  if (inspected.code === 0) {
    const dockerState = inspected.stdout.trim();
    if (dockerState === "running") {
      const lines = gpLines(asked.stdout);
      view = { kind: "not-answering", code: lines.get("ERROR"), message: lines.get("ERROR_MESSAGE") };
    } else {
      view = { kind: "stopped", dockerState };
    }
  } else if (NOT_THERE.test(inspected.stderr)) {
    view = { kind: "gone" };
  } else {
    return { view: { kind: "docker-unavailable" }, memory: before };
  }
  // Still updating, for two minutes from the first look that found the container missing, stopped, or running and not yet answering.
  if (before.lastState !== "updating" && before.asked === undefined) return { view, memory: before };
  const gapSince = before.gapSince ?? now;
  return { view: now - gapSince < SWAP_MS ? { kind: "swapping" } : view, memory: { ...before, gapSince } };
}

/**
 * The image the container was made from, as Docker prints it (`registry/ghost-protocol:1.2.3`), or undefined when it cannot be read.
 * Resolves with `undefined` as well when the caller left first.
 */
export async function imageOf(run: Runner, slug: string): Promise<string | undefined> {
  const ran = await run(imageCall(slug));
  if (ran === undefined || ran.kind !== "exit" || ran.code !== 0) return undefined;
  const image = ran.stdout.trim();
  return image === "" ? undefined : image;
}
