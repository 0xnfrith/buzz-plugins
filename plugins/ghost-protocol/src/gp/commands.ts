// Every `docker` call this plugin makes to make or remove an agent, built here and nowhere else. Each is written as the whole command line
// the interface note gives, and `make` checks that it begins with its process's declared words (processes.ts) before it hands over only
// what follows them. A page, a form field or a status never supplies a word of its own, and a secret (a Claude token, a login code) is
// never one: it goes on stdin.
import { IMAGE, UPDATER_COMMAND } from "./constants";
import { containerOf, updaterOf, volumeOf } from "./names";
import { PROCESS, type Call } from "../docker";
import { DECLARED } from "./processes";

/** The Docker socket, as Docker Desktop on macOS and Windows and Docker on Linux all take it. */
const SOCKET = "/var/run/docker.sock";

function make(process: Call["process"], ...line: string[]): Call {
  const fixed: readonly string[] = DECLARED[process] ?? [];
  if (fixed.some((word, at) => line[at] !== word)) throw new Error(`"${line.join(" ")}" does not begin with the words of ${process}`);
  return { process, args: line.slice(fixed.length) };
}

/**
 * The agent's image, pinned by tag and digest. An image that is not (constants.ts) is an empty name, and no command is built with an empty
 * name: not the pull, which would not begin with the manifest's words, and not a `docker run` either, which would get an empty image.
 */
function pinned(): string {
  if (IMAGE === "") throw new Error("the agent's image is not pinned by tag and digest");
  return IMAGE;
}

export const commands = {
  /** The agent's image. */
  pull: (): Call => make(PROCESS.pull, "pull", pinned()),

  /** Makes the agent's key in its data volume and prints its public key. The same volume gives the same key. */
  init: (slug: string, name: string, relay: string, owner: string): Call =>
    make(PROCESS.runInit, "run", "--rm", "-v", `${volumeOf(slug)}:/data`, pinned(), "init", "--name", name, "--relay", relay, "--owner", owner),

  /** The container's state, or docker's "no such object" when it is not there. The helper's too: it is a container. */
  state: (container: string): Call => make(PROCESS.inspectState, "inspect", "--format", "{{.State.Status}}", container),

  /** The agent. */
  start: (slug: string): Call =>
    make(PROCESS.runAgent, "run", "-d", "--restart", "unless-stopped", "--name", containerOf(slug), "-v", `${volumeOf(slug)}:/data`, pinned()),

  /** The update helper: the agent's own image and tag with another command, and the Docker socket. Only after a yes. */
  startUpdater: (slug: string): Call =>
    make(PROCESS.runUpdater, "run", "-d", "--restart", "unless-stopped", "-v", `${SOCKET}:${SOCKET}`, "--name", updaterOf(slug), pinned(), ...UPDATER_COMMAND, "--target", containerOf(slug)),

  /** A container that exists and is not running. */
  restart: (container: string): Call => make(PROCESS.restart, "restart", container),

  /** The owner's attestation on stdin. */
  authTagSet: (slug: string): Call => make(PROCESS.exec, "exec", "-i", containerOf(slug), "gp", "auth-tag", "set"),

  claudeStatus: (slug: string): Call => make(PROCESS.exec, "exec", containerOf(slug), "gp", "claude", "status"),
  /** Way A: prints an address, then waits for the code on stdin. */
  claudeLogin: (slug: string): Call => make(PROCESS.exec, "exec", "-i", containerOf(slug), "gp", "claude", "login"),
  /** Way B: a setup token on stdin. */
  claudeToken: (slug: string): Call => make(PROCESS.exec, "exec", "-i", containerOf(slug), "gp", "claude", "token"),

  status: (slug: string): Call => make(PROCESS.exec, "exec", containerOf(slug), "gp", "status", "--json"),

  /** The agent and its helper. `-f` makes a missing container no failure. */
  remove: (slug: string): Call => make(PROCESS.rm, "rm", "-f", containerOf(slug), updaterOf(slug)),
  /** The agent's key and memory, for good. Only after the person was warned. */
  removeData: (slug: string): Call => make(PROCESS.volumeRm, "volume", "rm", volumeOf(slug)),
} as const;
