// Whether the container the plugin has found for an agent is that agent's. The tab shows buttons (Stop, Restart, Update, Roll back) and a
// place to put a Claude token, and all of them act on `gp-<slug>`. The slug is the pair the plugin wrote down when it made the agent, or,
// when that is gone, one made from the agent's current name, which another container may have: so nothing acts on a container that says
// it belongs to another agent, and a name that nothing has written down is acted on only when the container says it is this agent's.
import type { Host } from "../buzz";
import { statusCall } from "../commands";
import { runnerFor } from "../docker";
import { parseStatus } from "./protocol";

export type Guard =
  /** Its status names this agent's key, or it cannot say and the pair was written down when the agent was made. */
  | "ok"
  /** Its status names another agent's key. */
  | "other"
  /** It cannot say (stopped, missing, no answer) and the name is only a guess from the agent's name. */
  | "unknown";

/**
 * Asks `gp status --json` of `gp-<slug>` and compares the key it names with the agent's. Resolves with `undefined` when `signal` aborts
 * first. `written` is true when the slug is the pair the plugin wrote down.
 */
export async function verifyContainer(host: Host, slug: string, pubkey: string, written: boolean, signal: AbortSignal): Promise<Guard | undefined> {
  const ran = await runnerFor(host, signal)(statusCall(slug));
  if (ran === undefined) return undefined;
  const read = ran.kind === "exit" && ran.code === 0 ? parseStatus(ran.stdout) : undefined;
  if (read?.status) return read.status.agentPubkey === pubkey ? "ok" : "other";
  return written ? "ok" : "unknown";
}
