// What GP prints, read as the interface note's section 4 and 8 say. `GP_<KEY>=<value>` lines are for the plugin; every other line is for
// people and is kept apart. Nothing here reads a secret: none is ever printed.
import { INTERFACE } from "./constants";

export type Gp = Readonly<{
  /** `GP_INTERFACE=`, when the command printed it. */
  interface: number | undefined;
  /** Every `GP_<KEY>=<value>` line, the last one of a key winning. */
  values: ReadonlyMap<string, string>;
  /** `GP_ERROR=` and `GP_ERROR_MESSAGE=`, when there. */
  error: Readonly<{ code: string; message: string }> | undefined;
}>;

const LINE = /^GP_([A-Z0-9_]+)=(.*)$/;

export function parseGp(stdout: string): Gp {
  const values = new Map<string, string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const match = LINE.exec(raw);
    if (match) values.set(match[1] as string, (match[2] as string).trim());
  }
  const code = values.get("ERROR");
  const number = values.get("INTERFACE");
  return {
    interface: number !== undefined && /^\d+$/.test(number) ? Number(number) : undefined,
    values,
    error: code === undefined ? undefined : { code, message: values.get("ERROR_MESSAGE") ?? "" },
  };
}

/** True when a command printed an interface number and it is not the one this plugin knows. */
export const unknownInterface = (gp: Gp): boolean => gp.interface !== undefined && gp.interface !== INTERFACE;

export const STATES = ["needs-claude", "needs-auth-tag", "connecting", "running", "updating", "error"] as const;
export const RELAYS = ["connected", "refused-not-member", "unreachable"] as const;
export type State = (typeof STATES)[number];
export type Relay = (typeof RELAYS)[number];

export type Status = Readonly<{
  interface: number;
  version: string;
  state: State;
  agentPubkey: string;
  relayUrl: string;
  relay: Relay;
  claude: "active" | "not-active";
  update: Readonly<{ available: boolean; version: string | null }>;
  previousVersion: string | null;
  error: Readonly<{ code: string; message: string }> | null;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);

/**
 * Reads `gp status --json`: one JSON object, on several lines or one, which the note's section 14 says has no `GP_` line before it. A
 * `GP_` line before it is dropped all the same. `undefined` for anything else. The interface number is the one field that must be there
 * and a number: when it is not the one this plugin knows, the caller stops before it reads anything else.
 */
export function parseStatus(stdout: string): { interface: number; status: Status | undefined } | undefined {
  const text = stdout
    .split(/\r?\n/)
    .filter((line) => !LINE.test(line))
    .join("\n")
    .trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || typeof value.interface !== "number" || !Number.isInteger(value.interface)) return undefined;
  const found = value.interface;
  if (found !== INTERFACE) return { interface: found, status: undefined };
  const { version, state, agent_pubkey: agentPubkey, relay_url: relayUrl, relay, claude, update, previous_version: previous, error } = value;
  if (
    typeof version !== "string" ||
    !isOneOf(STATES, state) ||
    typeof agentPubkey !== "string" ||
    typeof relayUrl !== "string" ||
    !isOneOf(RELAYS, relay) ||
    (claude !== "active" && claude !== "not-active") ||
    !isRecord(update) ||
    typeof update.available !== "boolean" ||
    (update.version !== null && typeof update.version !== "string") ||
    (previous !== null && typeof previous !== "string")
  )
    return undefined;
  let failure: Status["error"] = null;
  if (error !== null && error !== undefined) {
    if (!isRecord(error) || typeof error.code !== "string") return undefined;
    failure = { code: error.code, message: typeof error.message === "string" ? error.message : "" };
  }
  return {
    interface: found,
    status: { interface: found, version, state, agentPubkey, relayUrl, relay, claude, update: { available: update.available, version: update.version }, previousVersion: previous, error: failure },
  };
}
