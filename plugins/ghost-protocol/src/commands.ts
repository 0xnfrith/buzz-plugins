// Every `docker` call this plugin makes about an agent, as the argument list that follows `docker` (interface note, sections 8 and 10).
// They are the only calls the status screen makes, each built from a fixed list and the agent's checked slug. None takes a `-i` or `-t`
// (nothing is written to a process), and none has an argument that begins with `-` except the fixed flags below.
import { isSlug } from "./slug";

/** `gp-<slug>`: the agent's container. */
export const containerOf = (slug: string): string => {
  if (!isSlug(slug)) throw new Error("not a slug");
  return `gp-${slug}`;
};

/** The status, one JSON object (several lines when it is printed for people). */
export const statusArgs = (slug: string): readonly string[] => ["exec", containerOf(slug), "gp", "status", "--json"];
/** Asks GHOST Protocol to update itself once the agent has finished its task. */
export const updateArgs = (slug: string): readonly string[] => ["exec", containerOf(slug), "gp", "update", "request"];
/** Asks GHOST Protocol to go back to the version before the last update. */
export const rollbackArgs = (slug: string): readonly string[] => ["exec", containerOf(slug), "gp", "update", "rollback"];
export const restartArgs = (slug: string): readonly string[] => ["restart", containerOf(slug)];
export const stopArgs = (slug: string): readonly string[] => ["stop", containerOf(slug)];
/** What the container is doing: `running`, `exited` and so on. It fails when there is no such container. */
export const stateArgs = (slug: string): readonly string[] => ["inspect", "--format", "{{.State.Status}}", containerOf(slug)];
/** The image the container was made from, with its tag. */
export const imageArgs = (slug: string): readonly string[] => ["inspect", "--format", "{{.Config.Image}}", containerOf(slug)];
