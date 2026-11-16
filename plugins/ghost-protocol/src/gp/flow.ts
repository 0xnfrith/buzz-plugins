// The create flow, as the interface note's section 5 orders it, split where Buzz splits a Remote agent's creation:
//   provision (steps 1 to 3): check Docker, download the image, make the agent's key. Returns its public key.
//   activate  (steps 4 to 8): start the agent, start the update helper after a yes, hand it the owner's attestation, sign it in to
//                             Claude, wait until it runs.
// Buzz asks again after a failure, so every step is safe to repeat: it looks before it acts and never starts a second container.
// A failure is one `CreateError` whose message is the one line the person reads; the step it ended is marked in the progress too.
import { commands } from "./commands";
import type { Call } from "../docker";
import { INTERFACE, LIMITS, WORDS, type ClaudeWay } from "./constants";
import { containerOf, nameForInit, slugFromName, updaterOf } from "./names";
import type { Progress, StepId } from "./progress";
import { unknownInterface, parseStatus, type Status } from "./protocol";
import { lastLine, run, type Outcome, type StartDocker } from "./run";
import { isSignedIn, signInWithToken } from "./claude";
import { WORDS as DOCKER_WORDS, type Check } from "../docker";

export class CreateError extends Error {
  override readonly name = "CreateError";
}

export type Deps = Readonly<{
  start: StartDocker;
  /** Asks Docker for its server's version: the plugin's one check of Docker (src/docker.ts). Undefined when `signal` aborts first. */
  checkDocker(signal: AbortSignal): Promise<Check | undefined>;
  progress: Progress;
  /** The Claude setup token the person pasted (way B), or "". */
  token(): string;
  /** The token went to the agent, or was refused: forget it. */
  clearToken(): void;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
}>;

type Exit = Extract<Outcome, { kind: "exit" }>;

const HEX64 = /^[0-9a-f]{64}$/;

function stop(d: Deps, step: StepId, message: string): never {
  d.progress.set(step, "failed", message);
  d.progress.fail(message);
  throw new CreateError(message);
}

/** Runs one command for a step. Anything but an exit (no docker, too slow, stopped) ends the step. */
async function docker(d: Deps, step: StepId, command: Call, signal: AbortSignal, options: { stdin?: string; timeoutMs: number; onLine?(line: string): void }): Promise<Exit> {
  const outcome = await run(d.start, command, { ...options, signal });
  switch (outcome.kind) {
    case "exit":
      return outcome;
    case "cannot-start":
      return stop(d, step, WORDS.docker);
    case "timeout":
      return stop(d, step, "Docker did not answer in time.");
    case "aborted":
      throw new CreateError("Stopped.");
  }
}

/** GP printed an interface number this plugin does not know: nothing else of its answer is read. */
function checkInterface(d: Deps, step: StepId, exit: Exit): void {
  if (unknownInterface(exit.gp)) stop(d, step, WORDS.unknownInterface);
}

type Where = "missing" | "running" | "stopped";

/** Whether a container is there, and running. docker's "no such object" is its answer for a missing one, in whatever case it writes it. */
async function whereIs(d: Deps, step: StepId, container: string, signal: AbortSignal): Promise<Where> {
  const exit = await docker(d, step, commands.state(container), signal, { timeoutMs: LIMITS.quick });
  if (exit.code === 0) {
    const status = exit.stdout.trim().toLowerCase();
    return status === "running" || status === "restarting" ? "running" : "stopped";
  }
  if (/no such (object|container)/i.test(`${exit.stderr}\n${exit.stdout}`)) return "missing";
  return stop(d, step, WORDS.docker);
}

/** Makes sure a container runs: starts it when it is not there, starts it again when it stopped, leaves it when it runs. */
async function ensureRunning(d: Deps, step: StepId, container: string, create: Call, what: string, signal: AbortSignal): Promise<void> {
  const where = await whereIs(d, step, container, signal);
  if (where === "running") {
    d.progress.set(step, "done", "Already running");
    return;
  }
  const exit = await docker(d, step, where === "missing" ? create : commands.restart(container), signal, { timeoutMs: LIMITS.start });
  if (exit.code !== 0) {
    const why = lastLine(exit.stderr);
    stop(d, step, `Docker could not start ${what}${why === "" ? "." : `: ${why}`}`);
  }
  d.progress.set(step, "done");
}

// ---------------------------------------------------------------------------------------------------------------------------------

export type ProvisionInput = Readonly<{
  name: string;
  /** The `wss://` address of the person's current community. */
  community: string;
  /** The signed-in person's public key, 64 lower-case hex: the agent's owner and only allowed sender. */
  owner: string;
  /** The person's answer to "Let GHOST Protocol update itself?": a no leaves the helper's step out of the progress. */
  selfUpdate: boolean;
  signal: AbortSignal;
}>;

/** Steps 1 to 3. Resolves with the slug and the agent's public key. */
export async function provision(d: Deps, input: ProvisionInput): Promise<{ slug: string; pubkey: string }> {
  const { name, community, owner, selfUpdate, signal } = input;
  const slug = slugFromName(name);
  if (slug === undefined) throw new CreateError("Give the agent a name with at least one letter or number, as docker names are made of them.");
  if (!HEX64.test(owner)) throw new CreateError("Sign in to Buzz before you make the agent.");
  d.progress.begin({ skipUpdater: !selfUpdate });

  // 1. Docker.
  d.progress.set("docker", "running");
  const checked = await d.checkDocker(signal);
  if (checked === undefined) throw new CreateError("Stopped.");
  if (checked.state !== "ready") stop(d, "docker", checked.state === "unsupported" ? DOCKER_WORDS.unsupported : WORDS.docker);
  d.progress.set("docker", "done", `Docker ${checked.version}`);

  // 2. The image.
  d.progress.set("pull", "running");
  const pulled = await docker(d, "pull", commands.pull(), signal, {
    timeoutMs: LIMITS.pull,
    onLine: (line) => d.progress.set("pull", "running", line.length > 120 ? `${line.slice(0, 119)}…` : line),
  });
  if (pulled.code !== 0) {
    const why = lastLine(pulled.stderr);
    stop(d, "pull", `Docker could not download GHOST Protocol${why === "" ? "." : `: ${why}`}`);
  }
  d.progress.set("pull", "done");

  // 3. The key. A container of this name is another agent, or one that was never removed: init on its volume would change what it is
  // set up with, so it is left alone.
  d.progress.set("init", "running");
  if ((await whereIs(d, "init", containerOf(slug), signal)) !== "missing") {
    stop(d, "init", `A GHOST Protocol agent with the name "${containerOf(slug)}" is already on this computer. Choose another name, or remove it with: docker rm -f ${containerOf(slug)}`);
  }
  const made = await docker(d, "init", commands.init(slug, nameForInit(name, slug), community, owner), signal, { timeoutMs: LIMITS.init });
  checkInterface(d, "init", made);
  const pubkey = made.gp.values.get("AGENT_PUBKEY");
  if (made.code !== 0 || made.gp.error) {
    const why = made.gp.error?.message || lastLine(made.stderr);
    stop(d, "init", `GHOST Protocol could not set up the agent${why === "" ? "." : `: ${why}`}`);
  }
  if (pubkey === undefined || !HEX64.test(pubkey)) stop(d, "init", "GHOST Protocol did not return the agent's public key.");
  d.progress.set("init", "done");
  return { slug, pubkey };
}

// ---------------------------------------------------------------------------------------------------------------------------------

export type ActivateInput = Readonly<{
  name: string;
  pubkey: string;
  /** Buzz's signed attestation of the owner: `["auth", owner, conditions, signature]`. Public. */
  auth: readonly string[];
  /** The person's answer to "Let GHOST Protocol update itself?". */
  selfUpdate: boolean;
  /** "token": Create sends the pasted token. "login": the sign-in by address comes after, from the agent's panel (src/gp/claude.ts). */
  claudeWay: ClaudeWay;
  signal: AbortSignal;
}>;

/** Steps 4 to 8. Resolves with the agent's status once it runs. */
export async function activate(d: Deps, input: ActivateInput): Promise<Status> {
  const { name, pubkey, auth, selfUpdate, signal } = input;
  const slug = slugFromName(name);
  if (slug === undefined) throw new CreateError("Give the agent a name with at least one letter or number, as docker names are made of them.");
  d.progress.resume({ skipUpdater: !selfUpdate });

  // 4. The agent.
  d.progress.set("start", "running");
  await ensureRunning(d, "start", containerOf(slug), commands.start(slug), "the agent", signal);

  // 5. The update helper, only after a yes.
  if (selfUpdate) {
    d.progress.set("updater", "running");
    await ensureRunning(d, "updater", updaterOf(slug), commands.startUpdater(slug), "the update helper", signal);
  }

  // 6. The attestation.
  d.progress.set("tag", "running");
  if (auth.length !== 4 || auth.some((part) => typeof part !== "string")) stop(d, "tag", "Buzz did not give a well-formed attestation. Try again.");
  const tagged = await docker(d, "tag", commands.authTagSet(slug), signal, { stdin: `${JSON.stringify(auth)}\n`, timeoutMs: LIMITS.quick });
  checkInterface(d, "tag", tagged);
  if (tagged.code !== 0 || tagged.gp.error || tagged.gp.values.get("AUTH_TAG") !== "accepted") {
    stop(d, "tag", `GHOST Protocol did not accept your attestation${tagged.gp.error ? ` (${tagged.gp.error.code})` : ""}. Press Create to try again.`);
  }
  d.progress.set("tag", "done");

  // 7. Claude.
  d.progress.set("claude", "running");
  const later = await signIn(d, slug, input);

  // 8. Running. An agent whose sign-in is still to come waits at `needs-claude`, which is as far as Create can take it.
  d.progress.set("wait", "running");
  return await waitUntilRunning(d, slug, pubkey, signal, later);
}

/** Step 7. Resolves true when the sign-in is left for later, from the agent's panel. */
async function signIn(d: Deps, slug: string, input: ActivateInput): Promise<boolean> {
  const { signal } = input;
  const claude = { start: d.start };
  const current = await isSignedIn(claude, slug, signal);
  if (!current.ok) return stop(d, "claude", current.message);
  if (current.active) {
    d.clearToken();
    d.progress.set("claude", "done", "Already signed in");
    return false;
  }
  const held = d.token();
  // A token with a space in it is no token: it is refused, not put off.
  if (input.claudeWay === "token" && held.trim() !== "" && /\s/.test(held.trim())) {
    d.clearToken();
    return stop(d, "claude", "That is not a Claude setup token: it has a space in it. Make one with claude setup-token, paste it, and press Create again.");
  }
  if (input.claudeWay === "login" || held.trim() === "") {
    // The address's way needs the person to act while it runs, which Buzz's Create dialog does not allow: it runs from the agent's panel.
    // So does a token's way with no token held: Buzz's "Finish setup" and a restart of Buzz run this step again with the saved settings and
    // no form, and the token held in memory is gone, so the agent is left at `needs-claude` for its tab to sign in, not refused.
    d.clearToken();
    d.progress.set("claude", "skipped", "Sign in from the agent's panel");
    return true;
  }
  let result;
  try {
    result = await signInWithToken(claude, slug, d.token(), signal);
  } finally {
    // Whatever happened to the command, the token is not kept: a wrong one is no use again, and a right one is the agent's now.
    d.clearToken();
  }
  if (!result.ok) {
    if (result.stopped) throw new CreateError("Stopped.");
    // docker's own text and the interface number's are fixed words; the others are sentences that can take a next step.
    const fixed = result.message === WORDS.docker || result.message === WORDS.unknownInterface;
    return stop(d, "claude", fixed ? result.message : `${result.message} Then press Create again.`);
  }
  d.progress.set("claude", "done");
  return false;
}

/** Looks at the status until the agent runs, the relay refuses it, it reports an error, or the time is up. */
async function waitUntilRunning(d: Deps, slug: string, pubkey: string, signal: AbortSignal, atNeedsClaude: boolean): Promise<Status> {
  const deadline = d.now() + LIMITS.running;
  let last = "GHOST Protocol did not answer.";
  for (;;) {
    const exit = await docker(d, "wait", commands.status(slug), signal, { timeoutMs: LIMITS.quick });
    const read = exit.code === 0 ? parseStatus(exit.stdout) : undefined;
    if (read && read.interface !== INTERFACE) stop(d, "wait", WORDS.unknownInterface);
    const status = read?.status;
    if (status) {
      if (status.agentPubkey !== pubkey) stop(d, "wait", `The container ${containerOf(slug)} belongs to another agent.`);
      if (status.state === "running" || (atNeedsClaude && status.state === "needs-claude")) {
        d.progress.set("wait", "done", status.state === "running" ? `Version ${status.version}` : "Waiting for you to sign in to Claude");
        return status;
      }
      if (status.relay === "refused-not-member") {
        d.progress.refused(pubkey);
        stop(d, "wait", `${WORDS.refused} The agent's public key is ${pubkey}.`);
      }
      if (status.state === "error") stop(d, "wait", `GHOST Protocol reports an error${status.error?.message ? `: ${status.error.message}` : "."}`);
      last = status.relay === "unreachable" ? `GHOST Protocol could not reach your relay (${status.relayUrl}).` : `GHOST Protocol is still ${status.state.replace(/-/g, " ")}.`;
      d.progress.set("wait", "running", status.state.replace(/-/g, " "));
    } else {
      last = lastLine(exit.stderr) || "GHOST Protocol did not answer.";
    }
    if (d.now() >= deadline) stop(d, "wait", `${last} Press Create to try again.`);
    await d.sleep(LIMITS.pollMs, signal);
    if (signal.aborted) throw new CreateError("Stopped.");
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Removes an agent: its container and helper, then its data volume (the key, memory and sign-ins). One that is already gone counts as
 * removed. `-f` makes a missing container exit 0; a volume that is not there is docker's "no such volume".
 */
export async function remove(start: StartDocker, slug: string, signal: AbortSignal): Promise<void> {
  const gone = await run(start, commands.remove(slug), { timeoutMs: LIMITS.start, signal });
  if (gone.kind === "aborted") throw new CreateError("Stopped.");
  if (gone.kind !== "exit" || gone.code !== 0) throw new CreateError(gone.kind === "cannot-start" ? WORDS.docker : `Docker could not remove the agent's container${gone.kind === "exit" && lastLine(gone.stderr) ? `: ${lastLine(gone.stderr)}` : "."}`);
  const data = await run(start, commands.removeData(slug), { timeoutMs: LIMITS.start, signal });
  if (data.kind === "aborted") throw new CreateError("Stopped.");
  if (data.kind === "exit" && data.code === 0) return;
  if (data.kind === "exit" && /no such volume/i.test(`${data.stderr}\n${data.stdout}`)) return;
  throw new CreateError(data.kind === "cannot-start" ? WORDS.docker : `Docker could not remove the agent's data${data.kind === "exit" && lastLine(data.stderr) ? `: ${lastLine(data.stderr)}` : "."}`);
}
