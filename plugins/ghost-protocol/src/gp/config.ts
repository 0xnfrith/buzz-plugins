// The type's config, which Buzz keeps with each agent (and with an agent whose setup is unfinished, in its agent store). It holds the
// person's two choices and nothing secret: a Claude token has its own in-memory holder (progress.ts) and never comes here.
import { CLAUDE_LEADS, type ClaudeWay } from "./constants";

export type Config = Readonly<{
  /** Which agent the person chose. Absent is a personal agent, as every agent made before this field was: its saved config has none. The
   * content machine is shown, but it is not made yet: it needs a megatech sign-in, and nothing accepts it. */
  machine?: "content";
  /** Where it runs. "hosted" is not a choice yet: the form shows it disabled, and nothing accepts it. */
  place: "local";
  /** The answer to "Let GHOST Protocol update itself?"; null until the person answers, and Create waits for an answer. */
  selfUpdate: boolean | null;
  claudeWay: ClaudeWay;
}>;

/** A new agent's settings: the way Claude leads with is `leads`, which is `CLAUDE_LEADS` unless a test asks for the other. */
export const startingConfig = (leads: ClaudeWay = CLAUDE_LEADS): Config => ({ place: "local", selfUpdate: null, claudeWay: leads });

/** What a saved config says, or why it cannot be used. */
export type Chosen = Readonly<{ selfUpdate: boolean; claudeWay: ClaudeWay }>;

/** What Create says of the content machine, and what its form says when it is chosen. */
export const CONTENT_MACHINE_SOON = "The content machine runs on a megatech machine. It needs a megatech sign-in, and sign-up is coming soon.";

export function chosenFrom(config: unknown): Chosen | { problem: string } {
  const value = typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};
  // First, before anything else is read: whatever else the config holds, a content machine makes no agent and runs no command.
  if (value.machine !== undefined) return { problem: value.machine === "content" ? CONTENT_MACHINE_SOON : "Choose which agent to make." };
  if (value.place === "hosted") return { problem: "Hosted is coming soon." };
  if (value.place !== "local") return { problem: "Choose where the agent runs." };
  if (typeof value.selfUpdate !== "boolean") return { problem: "Answer the question about updating itself." };
  if (value.claudeWay !== "login" && value.claudeWay !== "token") return { problem: "Choose how to sign in to Claude." };
  return { selfUpdate: value.selfUpdate, claudeWay: value.claudeWay };
}
