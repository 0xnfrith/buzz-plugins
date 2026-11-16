import manifest from "../../manifest.json";
import { WORDS as DOCKER_WORDS } from "../docker";
import { OTHER_INTERFACE, REFUSED_NOT_MEMBER } from "../words";

// Everything the create flow takes from outside this plugin, in one place. Each is a single value to change when GHOST Protocol (GP)
// fixes it: the plugin's code reads these and holds no copy.

/**
 * The image's form: a registry (with a port, if it has one) and a path ending in `ghost-protocol`, a tag that is not `latest`, and a sha256
 * digest of 64 lower-case hex digits. A bare tag, a bare digest, a short or upper-case digest and anything after the digest are not it.
 */
export const PINNED_IMAGE =
  /^(?!.*\/ghost-protocol:latest@)[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*\/ghost-protocol:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}@sha256:[0-9a-f]{64}$/;

/**
 * The agent's one image, pinned: `<registry>/ghost-protocol:<exact tag>@sha256:<64 lower-case hex>`, as the `pull` process in manifest.json
 * names it (that is the only place it is written, so the review shows the image the plugin may pull and the code runs the same one). The
 * tag tells a person which version it is; the digest is what Docker checks, and a tag can be moved after it was tested where a digest
 * cannot. A bare tag and a bare digest are refused: the image is then an empty name, so the pull does not begin with the words the manifest
 * declares and Create stops before it runs anything. GHOST Protocol sends the registry path, the first version and its digest with its
 * first release; until then the manifest holds a placeholder (version 0.0.0, a digest of zeros) on a name that can never resolve
 * (`.invalid` is reserved for that), so Create ends at the pull with "Docker could not download GHOST Protocol".
 */
export const IMAGE = pinnedOrNothing((manifest.host.processes.find((process) => process.id === "pull")?.args ?? [])[1]);

function pinnedOrNothing(image: string | undefined): string {
  return image !== undefined && PINNED_IMAGE.test(image) ? image : "";
}

/** The interface number this plugin was written to (`GP_INTERFACE=` and the status's `interface`). Any other number stops Create. */
export const INTERFACE = 1;

/**
 * What the update helper runs, after the image and before `--target gp-<slug>`: the agent's own image with a different command, which
 * GHOST Protocol has fixed as `updater --target gp-<slug>`.
 */
export const UPDATER_COMMAND: readonly string[] = ["updater"];

/**
 * Which Claude sign-in the form leads with. Both are built; GP says which is the first choice.
 * - "login": the form shows an address from `gp claude login`, the person signs in there and pastes the code back.
 * - "token": the person pastes a setup token they made with `claude setup-token`.
 */
export type ClaudeWay = "login" | "token";
export const CLAUDE_LEADS: ClaudeWay = "token";

/** The words the interface and the brief fix; the three that the status screen shows too are its own constants. */
export const WORDS = {
  selfUpdateQuestion: "Let GHOST Protocol update itself? It needs control of Docker to swap in new versions. You can say no and update by hand.",
  docker: DOCKER_WORDS.unavailable,
  unknownInterface: OTHER_INTERFACE,
  refused: REFUSED_NOT_MEMBER,
  hostedSoon: "Hosted is coming soon.",
} as const;

/** How long each command may take before Create gives up on it. */
export const LIMITS = {
  /** The image is large. */
  pull: 15 * 60_000,
  init: 2 * 60_000,
  start: 60_000,
  quick: 30_000,
  /** The person has to sign in with Claude and copy a code back. */
  login: 15 * 60_000,
  /** From the agent starting to `running`. */
  running: 2 * 60_000,
  /** Between two looks at `gp status --json` while Create waits. */
  pollMs: 1_500,
} as const;
