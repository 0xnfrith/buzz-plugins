// The type's config, which Buzz keeps with each agent (and with an agent whose setup is unfinished, in its agent store). It holds the
// person's two choices and nothing secret: a Claude token has its own in-memory holder (progress.ts) and never comes here.
import { CLAUDE_LEADS, type ClaudeWay } from "./constants";

export type Config = Readonly<{
  /** Where it runs. "hosted" is not a choice yet: the form shows it disabled, and nothing accepts it. */
  place: "local";
  /** The answer to "Let GHOST Protocol update itself?"; null until the person answers, and Create waits for an answer. */
  selfUpdate: boolean | null;
  claudeWay: ClaudeWay;
}>;

export const startingConfig = (): Config => ({ place: "local", selfUpdate: null, claudeWay: CLAUDE_LEADS });

/** What a saved config says, or why it cannot be used. */
export type Chosen = Readonly<{ selfUpdate: boolean; claudeWay: ClaudeWay }>;

export function chosenFrom(config: unknown): Chosen | { problem: string } {
  const value = typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};
  if (value.place === "hosted") return { problem: "Hosted is coming soon." };
  if (value.place !== "local") return { problem: "Choose where the agent runs." };
  if (typeof value.selfUpdate !== "boolean") return { problem: "Answer the question about updating itself." };
  if (value.claudeWay !== "login" && value.claudeWay !== "token") return { problem: "Choose how to sign in to Claude." };
  return { selfUpdate: value.selfUpdate, claudeWay: value.claudeWay };
}
