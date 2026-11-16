// Every `docker` call this plugin makes about an agent, as the process it names and the arguments that follow that process's fixed ones
// (GHOST Protocol's interface: the status, the update and the way back, restart and stop). They are the only calls the status screen
// makes, each built from a fixed list and the agent's checked slug. None takes a `-i` or `-t` (nothing is written to a process), and
// none has an argument that begins with `-` but `gp`'s own `--json`: the flags of `docker` itself are fixed in the manifest, ahead of them.
import { PROCESS, type Call } from "./docker";
import { isSlug } from "./slug";

/** `gp-<slug>`: the agent's container. */
export const containerOf = (slug: string): string => {
  if (!isSlug(slug)) throw new Error("not a slug");
  return `gp-${slug}`;
};

/** `docker exec gp-<slug> gp status --json`: the status, one JSON object (several lines when it is printed for people). */
export const statusCall = (slug: string): Call => ({ process: PROCESS.exec, args: [containerOf(slug), "gp", "status", "--json"] });
/** `docker exec gp-<slug> gp update request`: asks GHOST Protocol to update itself once the agent has finished its task. */
export const updateCall = (slug: string): Call => ({ process: PROCESS.exec, args: [containerOf(slug), "gp", "update", "request"] });
/** `docker exec gp-<slug> gp update rollback`: asks GHOST Protocol to go back to the version before the last update. */
export const rollbackCall = (slug: string): Call => ({ process: PROCESS.exec, args: [containerOf(slug), "gp", "update", "rollback"] });
/** `docker restart gp-<slug>` */
export const restartCall = (slug: string): Call => ({ process: PROCESS.restart, args: [containerOf(slug)] });
/** `docker stop gp-<slug>` */
export const stopCall = (slug: string): Call => ({ process: PROCESS.stop, args: [containerOf(slug)] });
/** `docker inspect --format {{.State.Status}} gp-<slug>`: what the container is doing (`running`, `exited`…). It fails when there is no such container. */
export const stateCall = (slug: string): Call => ({ process: PROCESS.inspectState, args: [containerOf(slug)] });
/** `docker inspect --format {{.Config.Image}} gp-<slug>`: the image the container was made from, with its tag. */
export const imageCall = (slug: string): Call => ({ process: PROCESS.inspectImage, args: [containerOf(slug)] });
