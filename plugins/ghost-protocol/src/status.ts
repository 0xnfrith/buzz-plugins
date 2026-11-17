// What `docker exec gp-<slug> gp status --json` prints (GHOST Protocol's interface): one JSON object, alone on stdout, which may be
// written over several lines, so all of stdout is parsed. Its `interface` field carries the number of the interface it speaks; this
// plugin knows one. A `GP_<KEY>=<value>` line before or after the object (the first line, `GP_INTERFACE=1`, of GHOST Protocol's other
// commands, if it ever prints it here) is not part of it: no line of a JSON object begins that way.
import { PINNED_IMAGE } from "./gp/constants";

/** The interface number this plugin was written for. */
export const INTERFACE = 1;

export const STATES = ["needs-claude", "needs-auth-tag", "connecting", "running", "updating", "error"] as const;
export type State = (typeof STATES)[number];

export const RELAYS = ["connected", "refused-not-member", "unreachable"] as const;
export type Relay = (typeof RELAYS)[number];

export const CLAUDES = ["active", "not-active"] as const;
export type Claude = (typeof CLAUDES)[number];

/**
 * What `update.image` of the status is worth (GHOST Protocol's interface, note 15f). With an update on offer GHOST Protocol gives the image
 * of that version pinned by digest, `<registry>/ghost-protocol:<version>@sha256:<64 hex>`, and `digest` (`sha256:<64 hex>`).
 * - `pinned`: it is that, for the version on offer, and the same digest as `update.digest`. Nothing else is `pinned`.
 * - `none`: the keys are not there (an older GHOST Protocol, or nothing on offer), or are `null` (an offer made by hand in a test).
 * - `refused`: there is an `image` that is not a pinned image for the version on offer. The plugin shows no command for it.
 */
export type UpdateImage = Readonly<{ kind: "pinned"; image: string }> | Readonly<{ kind: "none" }> | Readonly<{ kind: "refused" }>;

export const NO_UPDATE_IMAGE: UpdateImage = { kind: "none" };

export type Status = Readonly<{
  state: State;
  version: string;
  /** The agent's public key, 64 hex characters. */
  agentPubkey: string;
  relayUrl: string;
  relay: Relay;
  claude: Claude;
  update: Readonly<{ available: boolean; version: string | null; image: UpdateImage }>;
  previousVersion: string | null;
  error: Readonly<{ code: string; message: string }> | null;
}>;

export type StatusRead =
  | Readonly<{ kind: "status"; status: Status }>
  /** `interface` is not the number this plugin knows (an older or a newer GHOST Protocol): nothing else of the answer is read. */
  | Readonly<{ kind: "other-interface" }>
  /** Not JSON, not an object, or an object of interface 1 that lacks a field or has one of the wrong kind or value. */
  | Readonly<{ kind: "unreadable" }>;

const PUBKEY = /^[0-9a-fA-F]{64}$/;
const GP_LINE = /^GP_[A-Z][A-Z0-9_]*=/;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);
const isText = (value: unknown): value is string => typeof value === "string" && value !== "";
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

/**
 * `image` and `digest` of the status's `update`, as they were printed (`undefined` when the key is not there). The rule is the one the
 * agent's own image has (`PINNED_IMAGE`): a registry, a path ending in `ghost-protocol`, a tag that is not `latest`, and a sha256 digest of 64
 * lower-case hex digits, alone. On top of it, the same two checks GHOST Protocol makes before it names an image: the tag is the version on
 * offer, and the digest is the one in `digest`. Without them the steps would pull another version than the screen says is on offer.
 */
export function updateImageOf(version: string | null, image: unknown, digest: unknown): UpdateImage {
  if (image === undefined || image === null) return NO_UPDATE_IMAGE;
  if (typeof image !== "string" || !PINNED_IMAGE.test(image) || version === null) return { kind: "refused" };
  const at = image.lastIndexOf("@");
  const reference = image.slice(0, at);
  if (reference.slice(reference.lastIndexOf(":") + 1) !== version) return { kind: "refused" };
  if (digest !== undefined && digest !== null && digest !== image.slice(at + 1)) return { kind: "refused" };
  return { kind: "pinned", image };
}

/** Reads the whole of stdout as a status. */
export function readStatus(stdout: string): StatusRead {
  let json: unknown;
  try {
    json = JSON.parse(stdout.split(/\r?\n/).filter((line) => !GP_LINE.test(line)).join("\n"));
  } catch {
    return { kind: "unreadable" };
  }
  if (!isObject(json)) return { kind: "unreadable" };
  if (json.interface !== INTERFACE) return { kind: "other-interface" };
  const { state, version, agent_pubkey: agentPubkey, relay_url: relayUrl, relay, claude, update, previous_version: previousVersion, error } = json;
  if (!isOneOf(STATES, state) || !isOneOf(RELAYS, relay) || !isOneOf(CLAUDES, claude)) return { kind: "unreadable" };
  if (!isText(version) || typeof agentPubkey !== "string" || !PUBKEY.test(agentPubkey) || typeof relayUrl !== "string") return { kind: "unreadable" };
  if (!isTextOrNull(previousVersion)) return { kind: "unreadable" };
  if (!isObject(update) || typeof update.available !== "boolean" || !isTextOrNull(update.version)) return { kind: "unreadable" };
  if (error !== null && !(isObject(error) && typeof error.code === "string" && typeof error.message === "string")) return { kind: "unreadable" };
  return {
    kind: "status",
    status: {
      state,
      version,
      agentPubkey,
      relayUrl,
      relay,
      claude,
      update: { available: update.available, version: update.version, image: updateImageOf(update.version, update.image, update.digest) },
      previousVersion,
      error: error === null ? null : { code: error.code as string, message: error.message as string },
    },
  };
}

/** The `GP_<KEY>=<value>` lines of stdout (GHOST Protocol's interface), by key. A key printed twice keeps its last value. */
export function gpLines(stdout: string): ReadonlyMap<string, string> {
  const lines = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const found = /^GP_([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (found?.[1] !== undefined && found[2] !== undefined) lines.set(found[1], found[2]);
  }
  return lines;
}
