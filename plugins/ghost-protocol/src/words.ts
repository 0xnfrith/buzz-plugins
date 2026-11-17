// Every line the status screen says, in one place. The wording of the relay refusal and of the unknown interface is the one GHOST
// Protocol gave for them, to the letter.
import { WORDS as DOCKER } from "./docker";
import type { Claude, Relay, State } from "./status";

export const STATE_WORDS: Readonly<Record<State, string>> = {
  "needs-claude": "Waiting for a Claude sign-in",
  "needs-auth-tag": "Waiting for the owner's attestation",
  connecting: "Connecting to the relay",
  running: "Running",
  updating: "Updating",
  error: "Error",
};

/** `refused-not-member` is GHOST Protocol's text for it, to the letter. */
export const REFUSED_NOT_MEMBER =
  "Your relay does not accept owner attestations. Ask its admin to turn them on, or to add this agent as a relay member.";

export const RELAY_WORDS: Readonly<Record<Relay, string>> = {
  connected: "Connected",
  "refused-not-member": "Refused: not a member",
  unreachable: "Cannot be reached",
};

export const CLAUDE_WORDS: Readonly<Record<Claude, string>> = {
  active: "Active",
  "not-active": "Not active",
};

/** The only thing shown when GHOST Protocol speaks an interface this plugin does not know (GHOST Protocol's interface). */
export const OTHER_INTERFACE = "Update this plugin, or update GHOST Protocol";

export const WORDS = {
  slugLabel: "Agent name in Docker",
  slugHelp: "The agent's name as Docker has it: its container is gp- followed by this name.",
  slugBad: "Use lower-case letters, digits and - only, starting with a letter or a digit.",
  show: "Show status",
  looking: (container: string) => `Looking for ${container}…`,
  unreadable: "GHOST Protocol answered, but this plugin could not read the answer.",
  swapping: "Updating. The agent is being swapped for the new version, which can take a minute or two.",
  stopped: (container: string, dockerState: string) => `${container} is stopped (${dockerState}).`,
  gone: (container: string) => `There is no container ${container}.`,
  notAnswering: (container: string) => `${container} is running, but GHOST Protocol did not answer.`,
  dockerUnavailable: DOCKER.unavailable,
  unsupported: DOCKER.unsupported,
  state: "State",
  version: "Version",
  relay: "Relay",
  relayUrl: "Relay address",
  claude: "Claude",
  update: "Update",
  previousVersion: "Previous version",
  publicKey: "Agent's public key",
  noUpdate: "No update is available",
  noPrevious: "None",
  updateAvailable: (version: string | null) => (version === null ? "An update is available" : `Version ${version} is available`),
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Could not copy. Select the key and copy it.",
  buttons: { update: "Update", rollback: "Roll back", restart: "Restart", stop: "Stop" },
  working: "Working…",
  updateRequested: "Update requested. The agent finishes its task first, then updates.",
  rollbackRequested: "Roll back requested. Watch the state: it goes to Updating, then back to Running.",
  noUpdateAvailable: "No update is available.",
  updateInProgress: "An update is already in progress.",
  noPreviousVersion: "There is no earlier version to roll back to.",
  noUpdaterRollback: "This agent has no update helper, so it cannot roll back from here.",
  noUpdaterTitle: "This agent has no update helper, so update it by hand. Run these three commands, one after the other:",
  noUpdaterDigest:
    "Before you run anything, replace <digest of that version> in steps 1 and 3 with the sha256 digest of the new version's image: the image is pinned by digest, so a tag that is moved later cannot change what runs. Step 1 does not run until you have. Run step 2 only once step 1 has pulled the image without an error, because step 2 removes the container.",
  noUpdaterPinned:
    "The image is pinned by digest, so a tag that is moved later cannot change what runs. Run step 2 only once step 1 has pulled the image without an error, because step 2 removes the container.",
  noUpdaterRefusedTitle: "This agent has no update helper, so update it by hand.",
  noUpdaterRefused: "GHOST Protocol named an image for this update that is not pinned by digest, so this plugin shows no commands for it. Nothing was run.",
  noUpdaterChanged: "The update on offer has changed since these steps were shown. They are still for the earlier one: leave this screen and open it again to see the new one.",
  noUpdaterNote: (volume: string) => `Your data and sign-ins live in the volume ${volume}, so nothing is lost between steps 2 and 3.`,
  restarted: (container: string) => `Restarted ${container}.`,
  stoppedNow: (container: string) => `Stopped ${container}.`,
  restartFailed: (container: string) => `Docker could not restart ${container}.`,
  stopFailed: (container: string) => `Docker could not stop ${container}.`,
  gpRefused: (code: string) => `GHOST Protocol refused: ${code}.`,
  gpNotUnderstood: "GHOST Protocol answered in a way this plugin does not understand.",
  dockerFailed: "Docker could not run it.",
  errorCode: "Error code",
  errorMessage: "Message",
} as const;
