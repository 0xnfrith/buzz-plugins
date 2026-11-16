import manifest from "../../manifest.json";
import { WORDS as DOCKER_WORDS } from "../docker";
import { OTHER_INTERFACE, REFUSED_NOT_MEMBER } from "../words";

// Everything the create flow takes from outside this plugin, in one place. Each is a single value to change when GHOST Protocol (GP)
// fixes it: the plugin's code reads these and holds no copy.

/**
 * The agent's one image: `<registry>/ghost-protocol:<exact tag>`, as the `pull` process in manifest.json names it (that is the only place
 * it is written, so the review shows the image the plugin may pull and the code runs the same one). GHOST Protocol sends the registry
 * path and the first version with its first release candidate; until then the manifest holds a name that can never resolve (`.invalid` is
 * reserved for that), so Create ends at the pull with "Docker could not download GHOST Protocol" and never runs anything else.
 */
export const IMAGE = (manifest.host.processes.find((process) => process.id === "pull")?.args ?? [])[1] ?? "";

/** The interface number this plugin was written to (`GP_INTERFACE=` and the status's `interface`). Any other number stops Create. */
export const INTERFACE = 1;

/**
 * What the update helper runs, after the image and before `--target gp-<slug>`: the agent's own image with a different command. GP fixes
 * the command and its arguments in the interface note; this is a placeholder until it does.
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
