// A fake `docker`, for the tests of the GHOST Protocol plugin. bin/docker runs main() below. It answers the commands of the plugin's
// interface (README.md lists them with the rules each follows), keeps what docker would know in a folder (store.mjs), and does what the
// scenario says (scenario.mjs). It is strict on purpose: a command, a flag or a name the interface does not list is refused (exit 64,
// "fake-docker: ..." on stderr, and `refused: true` in calls.jsonl), so a plugin that drifts from the interface fails its test instead
// of passing against a lenient fake.
//
// Where the output is docker's own (version, pull, run -d, restart, stop, rm, inspect, volume rm, and the errors) it follows real docker's
// text and exit codes. Where it is GHOST Protocol's own (init, and everything after `docker exec ... gp`) it follows the interface note:
// `GP_INTERFACE=<n>` first, `GP_<KEY>=<value>` lines for the plugin, lines for people between them, and a failure as a non-zero exit with
// `GP_ERROR=<code>` and `GP_ERROR_MESSAGE=<one line>` on stdout.
import { createHash } from "node:crypto";
import { IMAGE, pinnedImage } from "./image.mjs";
import { FAILURES, loadScenario } from "./scenario.mjs";
import { finishCall, readState, startCall, withState } from "./store.mjs";

const REFUSED = 64; // what the fake exits with when it refuses a command the interface does not list
const SOCKET = "unix:///var/run/docker.sock";
const FIXED_TIME = "2026-01-01T00:00:00.000000000Z"; // docker's timestamps, fixed so that two runs print the same text
const HEX64 = /^[0-9a-f]{64}$/;

// The update helper: a second, long-lived container that swaps the agent's image. It runs the agent's own image, exact tag and digest, with a
// different command, and the plugin starts it after the agent's container, only when the user said yes to self-update. GHOST Protocol has not fixed the
// command and its arguments: UPDATER_COMMAND is the one place to set them. While it is null, any command words are taken.
const UPDATER_COMMAND = null;
const DOCKER_SOCKET_MOUNT = "/var/run/docker.sock:/var/run/docker.sock";
// The helper's container name. A dot cannot be in a slug, so it can never be an agent's: the one place to change if GHOST Protocol renames it.
const HELPER_SUFFIX = ".updater";
const HELPER_NAME = /^gp-(?<slug>[a-z0-9-]+)\.updater$/;
const HEX128 = /^[0-9a-f]{128}$/;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** docker's own failure: a message on stderr and an exit code. */
class DockerError extends Error {
  constructor(message, code = 1, stdout = "") {
    super(message);
    this.exitCode = code;
    this.stdout = stdout;
  }
}
/** GHOST Protocol's own failure: GP_ERROR on stdout and exit 1. */
class GpError extends Error {
  constructor(code, message) {
    super(message);
    this.gpCode = code;
  }
}
/** A command, flag or name the interface does not list. */
class Refused extends Error {}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading the command line

/**
 * Splits `args` into flags and positional arguments. `bool` and `value` list the flags a command knows, short and long. Short boolean
 * flags may be combined (-di). With `stop`, the first positional argument ends the flags (docker's rule for `run` and `exec`: what
 * follows belongs to the command inside the container).
 */
function parseFlags(args, { bool = [], value = [], stop = false } = {}) {
  const flags = {};
  const rest = [];
  let next = 0;
  const take = (name, given) => {
    const taken = given ?? args[next++];
    if (taken === undefined) throw new Refused(`the flag ${name} needs a value`);
    (flags[name] ??= []).push(taken);
  };
  while (next < args.length) {
    const arg = args[next++];
    if (arg === "--") {
      rest.push(...args.slice(next));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq < 0 ? arg : arg.slice(0, eq);
      const given = eq < 0 ? undefined : arg.slice(eq + 1);
      if (bool.includes(name)) {
        if (given !== undefined) throw new Refused(`the flag ${name} takes no value`);
        flags[name] = [true];
      } else if (value.includes(name)) take(name, given);
      else throw new Refused(`${shownFlag(name)} is not part of the interface`);
    } else if (arg.startsWith("-") && arg.length > 1) {
      for (let i = 1; i < arg.length; i++) {
        const name = `-${arg[i]}`;
        if (bool.includes(name)) flags[name] = [true];
        else if (value.includes(name)) {
          take(name, arg.length > i + 1 ? arg.slice(i + 1) : undefined);
          break;
        } else throw new Refused(`${shownFlag(name)} is not part of the interface`);
      }
    } else if (stop) {
      rest.push(arg, ...args.slice(next));
      break;
    } else rest.push(arg);
  }
  return { flags, rest };
}

/** A flag the interface does not list, for a message: shown when it looks like a flag, else not (it may be a secret given in its place). */
const shownFlag = (name) => (/^--?[a-z][a-z0-9-]{0,20}$/.test(name) ? `the flag ${name}` : "an argument that looks like a flag");

/** A word for a message: shown when it looks like a plain word, else not (it may be a secret given in its place). */
const plainWord = (text) => (/^[a-z][a-z0-9-]{0,15}$/.test(text ?? "") ? `"${text}"` : "that");

const flag = (flags, ...names) => names.some((name) => flags[name]);
function single(flags, label, ...names) {
  const found = names.flatMap((name) => flags[name] ?? []);
  if (found.length > 1) throw new Refused(`${label} is given more than once`);
  return found[0];
}
const oneLine = (text) => !/[\r\n\0]/.test(text);

function parseImage(reference) {
  const match = IMAGE.exec(reference ?? "");
  // The reference is not shown: a secret given in an image's place would be printed.
  if (!match) throw new Refused("that is not <registry>/ghost-protocol:<exact version>@sha256:<64 hex digits> (the interface pins the image by version tag and digest)");
  if (match.groups.tag === "latest") throw new Refused("the image must carry an exact version, not latest");
  return { reference, name: "ghost-protocol", ...match.groups };
}

function parseVolume(text) {
  const match = /^(?<name>gp-[a-z0-9-]+-data):\/data$/.exec(text ?? "");
  if (!match) throw new Refused("-v must be gp-<slug>-data:/data");
  return { name: match.groups.name, slug: match.groups.name.slice(3, -5) };
}

/** An agent's container, gp-<slug>, or the update helper's, gp-<slug>.updater. */
function parseContainerName(text) {
  const match = /^gp-(?<slug>[a-z0-9-]+)(?<helper>\.updater)?$/.exec(text ?? "");
  // The name is not shown: in `docker exec` it may be a secret given in the wrong place.
  if (!match) throw new Refused("that is not a container name of the interface (gp-<slug>, or gp-<slug>.updater for the update helper)");
  return { slug: match.groups.slug, name: text, helper: Boolean(match.groups.helper) };
}

/** `{{.Server.Version}}`-style templates, enough for the ones the plugin may use: a field path, or `json` and a field path. */
function render(template, data) {
  const out = template.replace(/\{\{\s*(json\s+)?\.([A-Za-z0-9_.]*)\s*\}\}/g, (_, json, path) => {
    const found = path.split(".").filter(Boolean).reduce((object, key) => (object == null ? undefined : object[key]), data);
    if (found === undefined) throw new DockerError(`template: :1:2: executing "" at <.${path}>: can't evaluate field ${path.split(".").pop()}`);
    return json || typeof found === "object" ? JSON.stringify(found) : String(found);
  });
  if (out.includes("{{")) throw new Refused(`the template "${template}" uses more than a field path`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Output

function makeOutput(io, scenario) {
  let started = false;
  const out = (text) => io.stdout.write(text);
  const err = (text) => io.stderr.write(text);
  const gp = {
    /** `GP_INTERFACE=<n>`, the first line of every GP command (and only once). */
    start() {
      if (started) return;
      started = true;
      out(`GP_INTERFACE=${scenario.interface}\n`);
    },
    pair: (key, value) => out(`GP_${key}=${value}\n`),
    /** A line for people. It never starts with `GP_`. */
    log: (text) => {
      if (scenario.logLines) out(`${text}\n`);
    },
  };
  return { out, err, gp };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// What the scenario says about docker itself

function checkDocker(scenario, argv) {
  if (scenario.docker === "missing") throw new DockerError("docker: command not found", 127);
  if (scenario.docker === "daemon-down") {
    if (scenario.dockerStyle === "classic") throw new DockerError(`Cannot connect to the Docker daemon at ${SOCKET}. Is the docker daemon running?`);
    // Docker 29: another text, and `inspect` and a formatted `version` still print their empty result on stdout.
    const formatted = argv.some((arg) => arg === "--format" || arg === "-f" || arg.startsWith("--format="));
    const stdout = formatted ? "\n" : argv[0] === "inspect" ? "[]\n" : "";
    throw new DockerError(
      `failed to connect to the docker API at ${SOCKET}; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory`,
      1,
      stdout,
    );
  }
  if (scenario.docker === "permission-denied") {
    throw new DockerError(
      `permission denied while trying to connect to the Docker daemon socket at ${SOCKET}: ` +
        `Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.47/containers/json": dial unix /var/run/docker.sock: connect: permission denied`,
    );
  }
}

async function wait(scenario, step) {
  if (scenario.hang.includes(step)) {
    setInterval(() => {}, 1 << 30); // keeps the process alive until it is killed
    await new Promise(() => {});
  }
  const ms = scenario.delayMs[step];
  if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
}

function failure(scenario, step) {
  const wanted = scenario.fail[step];
  if (!wanted) return null;
  return wanted === true ? FAILURES[step] : { ...FAILURES[step], ...wanted };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Containers

const containerId = (state, name) => sha256(`container:${name}:${++state.counter}`);

/** Partway through an update, after the `updating` answers: the helper has taken gp-<slug> away and not yet put the new one back. */
const inGap = (container) => {
  const t = container.transition;
  return Boolean(t) && t.startLeft === 0 && t.updatingLeft === 0 && t.gapLeft !== 0;
};

const notRunning = (container) => `Error response from daemon: container ${container.id} is not running`;

/** Why docker cannot run something in a container: it is not there, or it is not running. null when it can. */
function unreachable(state, name, scenario) {
  const container = state.containers[name];
  if (!container) return `Error response from daemon: No such container: ${name}`;
  if (inGap(container)) return scenario.updateGapKind === "stopped" ? notRunning(container) : `Error response from daemon: No such container: ${name}`;
  if (!container.running) return notRunning(container);
  return null;
}

function inspectOf(container, name, stopped) {
  const running = container.running && !stopped;
  return {
    Id: container.id,
    Created: FIXED_TIME,
    Path: "gp",
    Args: [],
    State: {
      Status: running ? "running" : "exited",
      Running: running,
      Paused: false,
      Restarting: false,
      OOMKilled: false,
      Dead: false,
      Pid: running ? 4242 : 0,
      ExitCode: 0,
      Error: "",
      StartedAt: FIXED_TIME,
      FinishedAt: running ? "0001-01-01T00:00:00Z" : FIXED_TIME,
    },
    Image: `sha256:${sha256(container.image)}`,
    Name: `/${name}`,
    RestartCount: 0,
    HostConfig: { RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 } },
    Mounts: container.volume ? [{ Type: "volume", Name: container.volume, Destination: "/data", RW: true }] : [],
    Config: { Image: container.image, Labels: {} },
  };
}

/** Runs `change({ state, container, volume })` for a container that docker can reach, under the lock. */
function onContainer(ctx, name, change) {
  return withState(ctx.dir, (state) => {
    const problem = unreachable(state, name, ctx.scenario);
    if (problem) throw new DockerError(problem);
    const container = state.containers[name];
    return change({ state, container, volume: state.volumes[container.volume] });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Stdin: a line, as `gp` reads it. Not attached (no -i) is an empty line, as docker gives the process.

function makeInput(io, record) {
  return async function readLine(attached) {
    if (!attached) {
      record.stdin = { attached: false, bytes: 0, sha256: sha256("") };
      return "";
    }
    const line = await new Promise((resolve, reject) => {
      let buffer = "";
      const stream = io.stdin;
      const finish = (text, terminated) => {
        stream.off("data", onData);
        stream.off("end", onEnd);
        stream.off("error", reject);
        stream.pause();
        stream.unref?.(); // the plugin may keep stdin open: that must not keep this process alive
        resolve({ text: text.replace(/\r$/, ""), terminated });
      };
      const onData = (chunk) => {
        buffer += chunk;
        const at = buffer.indexOf("\n");
        if (at >= 0) finish(buffer.slice(0, at), true);
        else if (buffer.length > 1 << 20) finish(buffer, false);
      };
      const onEnd = () => finish(buffer, false);
      stream.setEncoding("utf8");
      stream.on("data", onData);
      stream.on("end", onEnd);
      stream.on("error", reject);
    });
    // Only a digest of what came in is kept, never the text: it may be a code or a token.
    record.stdin = { attached: true, bytes: Buffer.byteLength(line.text), terminated: line.terminated, sha256: sha256(line.text) };
    return line.text;
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// docker's own commands

async function dockerVersion(ctx) {
  const { flags, rest } = parseFlags(ctx.args, { value: ["--format", "-f"] });
  if (rest.length) throw new Refused("`docker version` takes no arguments");
  const { scenario, output } = ctx;
  await wait(scenario, "version");
  const data = { Client: { Version: scenario.dockerVersion }, Server: { Version: scenario.dockerVersion, Os: "linux", Arch: "amd64" } };
  const format = single(flags, "--format", "--format", "-f");
  if (format !== undefined) output.out(`${render(format, data)}\n`);
  else {
    output.out(`Client:\n Version:           ${scenario.dockerVersion}\n OS/Arch:           linux/amd64\n\n`);
    output.out(`Server: Docker Engine - Community\n Engine:\n  Version:          ${scenario.dockerVersion}\n  OS/Arch:          linux/amd64\n`);
  }
  return 0;
}

function pullLines(image) {
  const layers = [1, 2].map((n) => sha256(`${image.reference}:${n}`).slice(0, 12));
  const path = [...image.repository.split("/").slice(1), image.name].join("/");
  return [
    `sha256:${image.digest}: Pulling from ${path}`, // a pull by digest is announced by its digest, not by its tag
    ...layers.map((layer) => `${layer}: Pulling fs layer`),
    ...layers.map((layer) => `${layer}: Download complete`),
    ...layers.map((layer) => `${layer}: Pull complete`),
    `Digest: sha256:${image.digest}`,
  ];
}

function pullFailure(image, scenario) {
  const host = image.repository.split("/")[0];
  const registry = /[.:]/.test(host) ? host : "registry-1.docker.io";
  if (scenario.pull === "not-found") return `Error response from daemon: manifest for ${image.reference} not found: manifest unknown: manifest unknown`;
  if (scenario.pull === "unauthorized") {
    return `Error response from daemon: pull access denied for ${image.repository}/${image.name}, repository does not exist or may require 'docker login': denied: requested access to the resource is denied`;
  }
  if (scenario.pull === "network") return `Error response from daemon: Get "https://${registry}/v2/": dial tcp: lookup ${registry} on 127.0.0.11:53: no such host`;
  return null;
}

async function dockerPull(ctx) {
  const { rest } = parseFlags(ctx.args);
  if (rest.length !== 1) throw new Refused("`docker pull` takes one image");
  const image = parseImage(rest[0]); // Create pulls one image: the update helper runs the agent's own
  const { scenario, dir, output } = ctx;
  await wait(scenario, "pull");
  const problem = pullFailure(image, scenario);
  if (problem) throw new DockerError(problem);
  const fresh = withState(dir, (state) => {
    const known = Boolean(state.images[image.reference]);
    state.images[image.reference] = { tag: image.tag, name: image.name };
    return !known;
  });
  for (const line of pullLines(image)) output.out(`${line}\n`);
  output.out(fresh ? `Status: Downloaded newer image for ${image.reference}\n` : `Status: Image is up to date for ${image.reference}\n`);
  output.out(`${image.reference}\n`);
  return 0;
}

/** `docker run` pulls the image first when it is not there, and says so on stderr. */
function implicitPull(state, image, output) {
  if (state.images[image.reference]) return;
  output.err(`Unable to find image '${image.reference}' locally\n`);
  output.err(`${pullLines(image).join("\n")}\nStatus: Downloaded newer image for ${image.reference}\n`);
  state.images[image.reference] = { tag: image.tag, name: image.name };
}

async function dockerRun(ctx) {
  const { flags, rest } = parseFlags(ctx.args, {
    bool: ["-d", "--detach", "--rm"],
    value: ["--name", "--restart", "-v", "--volume"],
    stop: true,
  });
  const detached = flag(flags, "-d", "--detach");
  // The update helper is told by its name, which no agent can have, or by its mount: the Docker socket. An agent's start that forgets its
  // data volume is not taken for it, so its refusal says what is wrong.
  const mountsGiven = ["-v", "--volume"].flatMap((flagName) => flags[flagName] ?? []);
  const socketMounted = mountsGiven.some((mount) => mount.startsWith("/var/run/docker.sock"));
  if (detached && (socketMounted || (single(flags, "--name", "--name") ?? "").endsWith(HELPER_SUFFIX))) return startHelper(ctx, { flags, rest });
  const image = parseImage(rest[0]);
  const command = rest.slice(1);
  const volume = parseVolume(single(flags, "-v", "-v", "--volume"));
  if (command.length) return init(ctx, { flags, image, volume, command, detached });

  // The start: docker run -d --name gp-<slug> --restart unless-stopped -v gp-<slug>-data:/data <IMAGE>
  if (!detached) throw new Refused("`docker run` without a command is the start: -d --name gp-<slug> --restart unless-stopped -v ...");
  if (flag(flags, "--rm")) throw new Refused("the agent's container is not started with --rm");
  const name = parseContainerName(single(flags, "--name", "--name"));
  if (name.slug !== volume.slug) throw new Refused(`the container ${name.name} and the volume ${volume.name} are for different agents`);
  if (single(flags, "--restart", "--restart") !== "unless-stopped") throw new Refused("the agent's container is started with --restart unless-stopped");
  const { scenario, dir, output } = ctx;
  await wait(scenario, "start");
  const id = withState(dir, (state) => {
    if (!state.volumes[volume.name]) throw new Refused(`the volume ${volume.name} was never set up: run \`init\` on it first`);
    conflict(state, name.name);
    implicitPull(state, image, output);
    const created = containerId(state, name.name);
    state.containers[name.name] = {
      id: created,
      image: image.reference,
      volume: volume.name,
      version: image.tag,
      running: true,
      connectingLeft: scenario.connectingPolls,
      previousVersion: null,
      previousImage: null,
      update: null,
      transition: null,
    };
    return created;
  });
  output.out(`${id}\n`);
  return 0;
}

function conflict(state, name) {
  if (!state.containers[name]) return;
  throw new DockerError(
    `docker: Error response from daemon: Conflict. The container name "/${name}" is already in use by container "${state.containers[name].id}". ` +
      "You have to remove (or rename) that container to be able to reuse that name.",
    125,
  );
}

/** The helper's arguments after the image: its command, then `--target gp-<slug>`. null when they are as the interface has them. */
function helperArgsProblem(args, slug) {
  const tail = JSON.stringify(args.slice(-2));
  const command = args.slice(0, -2);
  if (tail !== JSON.stringify(["--target", `gp-${slug}`])) return `the update helper's arguments end with \`--target gp-${slug}\``;
  if (UPDATER_COMMAND) {
    return JSON.stringify(command) === JSON.stringify(UPDATER_COMMAND) ? null : `the update helper's command is \`${UPDATER_COMMAND.join(" ")}\``;
  }
  if (!command.length || command[0].startsWith("-")) return `the update helper's arguments are its command, then \`--target gp-${slug}\``;
  return null;
}

/**
 * The update helper, started by the plugin after the agent's container, when the user said yes to self-update. It runs the agent's own image
 * and exact tag with a different command:
 * docker run -d --name gp-<slug>.updater --restart unless-stopped -v /var/run/docker.sock:/var/run/docker.sock <agent image>:<tag> <updater command> --target gp-<slug>
 */
async function startHelper(ctx, { flags, rest }) {
  const name = single(flags, "--name", "--name");
  const named = HELPER_NAME.exec(name ?? "");
  if (!named) throw new Refused(`the update helper is named gp-<slug>${HELPER_SUFFIX}`);
  const slug = named.groups.slug;
  if (flag(flags, "--rm")) throw new Refused("the update helper is long-lived: it is not started with --rm");
  if (single(flags, "--restart", "--restart") !== "unless-stopped") throw new Refused("the update helper is started with --restart unless-stopped");
  const mounts = ["-v", "--volume"].flatMap((flagName) => flags[flagName] ?? []);
  if (mounts.length !== 1 || mounts[0] !== DOCKER_SOCKET_MOUNT) throw new Refused(`the update helper is started with -v ${DOCKER_SOCKET_MOUNT}, and nothing else mounted`);
  const image = parseImage(rest[0]);
  const problem = helperArgsProblem(rest.slice(1), slug);
  if (problem) throw new Refused(problem);
  const { scenario, dir, output } = ctx;
  if (scenario.selfUpdate === "no") throw new Refused("the user said no to self-update: the plugin must not start the update helper");
  await wait(scenario, "start-updater");
  const id = withState(dir, (state) => {
    const agent = state.containers[`gp-${slug}`];
    if (!agent) throw new Refused(`the update helper is started after the agent's container, and gp-${slug} is not there`);
    if (image.reference !== agent.image) throw new Refused(`the update helper runs the agent's own image and exact tag (${agent.image}), not ${image.reference}`);
    conflict(state, name);
    implicitPull(state, image, output);
    const created = containerId(state, name);
    state.containers[name] = { id: created, image: image.reference, volume: null, version: image.tag, running: true, helper: true, target: `gp-${slug}` };
    return created;
  });
  output.out(`${id}\n`);
  return 0;
}

async function dockerRestart(ctx) {
  const { rest } = parseFlags(ctx.args);
  if (rest.length !== 1) throw new Refused("`docker restart` takes one container");
  const name = parseContainerName(rest[0]).name;
  await wait(ctx.scenario, "restart");
  withState(ctx.dir, (state) => {
    const container = state.containers[name];
    if (!container) throw new DockerError(`Error response from daemon: No such container: ${name}`);
    container.running = true;
    container.connectingLeft = ctx.scenario.connectingPolls; // the agent connects again
  });
  ctx.output.out(`${name}\n`);
  return 0;
}

async function dockerStop(ctx) {
  const { rest } = parseFlags(ctx.args);
  if (rest.length !== 1) throw new Refused("`docker stop` takes one container");
  const name = parseContainerName(rest[0]).name;
  await wait(ctx.scenario, "stop");
  withState(ctx.dir, (state) => {
    const container = state.containers[name];
    if (!container) throw new DockerError(`Error response from daemon: No such container: ${name}`);
    container.running = false;
  });
  ctx.output.out(`${name}\n`);
  return 0;
}

async function dockerRm(ctx) {
  const { flags, rest } = parseFlags(ctx.args, { bool: ["-f", "--force"] });
  if (!rest.length) throw new Refused("`docker rm` takes at least one container");
  const names = rest.map((text) => parseContainerName(text).name);
  const force = flag(flags, "-f", "--force");
  await wait(ctx.scenario, "rm");
  // One name at a time, as docker does: the ones it can remove are removed and named on stdout, the others are errors on stderr. With -f a
  // container that is not there is an error line and not a failure (docker's exit code stays 0, as docker 29 does); without -f, and for
  // any other error, the exit code is 1.
  const results = withState(ctx.dir, (state) =>
    names.map((name) => {
      const container = state.containers[name];
      if (!container) return { error: `Error response from daemon: No such container: ${name}`, missing: true };
      if (container.running && !force) {
        return { error: `Error response from daemon: cannot remove container "/${name}": container is running: stop the container before removing or force remove` };
      }
      delete state.containers[name];
      return { name };
    }),
  );
  for (const result of results) {
    if (result.error) ctx.output.err(`${result.error}\n`);
    else ctx.output.out(`${result.name}\n`);
  }
  return results.some((result) => result.error && !(result.missing && force)) ? 1 : 0;
}

async function dockerInspect(ctx) {
  const { flags, rest } = parseFlags(ctx.args, { value: ["--format", "-f"] });
  if (rest.length !== 1) throw new Refused("`docker inspect` takes one container");
  const name = parseContainerName(rest[0]).name;
  const format = single(flags, "--format", "--format", "-f");
  const { scenario, output } = ctx;
  await wait(scenario, "inspect");
  const container = readState(ctx.dir).containers[name];
  const gap = Boolean(container) && inGap(container);
  if (!container || (gap && scenario.updateGapKind !== "stopped")) {
    // docker 27: `Error: No such object: x`. docker 29: `error: no such object: x`, and a formatted inspect prints an empty line.
    if (format === undefined) output.out("[]\n");
    else if (scenario.dockerStyle === "current") output.out("\n");
    output.err(scenario.dockerStyle === "current" ? `error: no such object: ${name}\n` : `Error: No such object: ${name}\n`);
    return 1;
  }
  const view = inspectOf(container, name, gap);
  output.out(format === undefined ? `${JSON.stringify([view], null, 4)}\n` : `${render(format, view)}\n`);
  return 0;
}

async function dockerVolume(ctx) {
  const [action, ...args] = ctx.args;
  if (action !== "rm") throw new Refused("only `docker volume rm` is part of the interface");
  const { rest } = parseFlags(args);
  if (rest.length !== 1 || !/^gp-[a-z0-9-]+-data$/.test(rest[0])) throw new Refused("`docker volume rm` takes one volume, gp-<slug>-data");
  const name = rest[0];
  await wait(ctx.scenario, "volume-rm");
  withState(ctx.dir, (state) => {
    if (!state.volumes[name]) throw new DockerError(`Error response from daemon: get ${name}: no such volume`);
    const users = Object.values(state.containers).filter((container) => container.volume === name);
    if (users.length) {
      throw new DockerError(`Error response from daemon: remove ${name}: volume is in use - [${users.map((container) => container.id).join(", ")}]`);
    }
    delete state.volumes[name];
  });
  ctx.output.out(`${name}\n`);
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// GHOST Protocol's own commands

/** `docker run --rm -v gp-<slug>-data:/data <IMAGE> init --name <name> --relay <url> --owner <hex>` */
async function init(ctx, { flags, image, volume, command, detached }) {
  if (detached || !flag(flags, "--rm") || flags["--name"] || flags["--restart"]) {
    throw new Refused("`init` runs as `docker run --rm -v gp-<slug>-data:/data <IMAGE> init ...`, without -d, --name or --restart");
  }
  if (command[0] !== "init") throw new Refused(`${plainWord(command[0])} is not a command of the image the interface lists (init)`);
  const { flags: given, rest } = parseFlags(command.slice(1), { value: ["--name", "--relay", "--owner"] });
  if (rest.length) throw new Refused("`init` takes only --name, --relay and --owner");
  const name = single(given, "--name", "--name");
  const relay = single(given, "--relay", "--relay");
  const owner = single(given, "--owner", "--owner");
  if (!name || !oneLine(name)) throw new Refused("--name must be one non-empty line");
  if (!relay || !/^wss?:\/\/[^\s]+$/.test(relay)) throw new Refused("--relay must be a ws:// or wss:// address");
  if (!HEX64.test(owner ?? "")) throw new Refused("--owner must be 64 lower-case hex characters");
  const { scenario, dir, output } = ctx;
  const { gp } = output;
  await wait(scenario, "init");
  gp.start();
  const problem = failure(scenario, "init");
  if (problem) throw new GpError(problem.code, problem.message);
  const pubkey = withState(dir, (state) => {
    implicitPull(state, image, output);
    const data = state.volumes[volume.name] ?? {
      pubkey: sha256(`agent-key:${volume.name}:${++state.counter}`),
      claude: scenario.claude,
      tagAccepted: false,
      loginAttempts: 0,
    };
    // Running init again keeps the key; the other settings are the latest given.
    Object.assign(data, { name, relay, owner });
    state.volumes[volume.name] = data;
    return data.pubkey;
  });
  gp.log(`Preparing the data volume ${volume.name}`);
  gp.log("Making the agent key. It stays in the volume and is never printed.");
  gp.pair("VERSION", image.tag);
  gp.pair("AGENT_PUBKEY", pubkey);
  return 0;
}

function validateTag(text, volume) {
  let tag;
  try {
    tag = JSON.parse(text);
  } catch {
    return "The tag is not JSON.";
  }
  if (!Array.isArray(tag) || tag.length !== 4 || tag.some((part) => typeof part !== "string")) return "The tag must be a JSON array of four strings.";
  const [kind, owner, , signature] = tag;
  if (kind !== "auth") return 'The first part of the tag must be "auth".';
  if (!HEX64.test(owner)) return "The owner in the tag is not 64 hex characters.";
  if (owner !== volume.owner) return "The owner in the tag is not the owner this agent was set up for.";
  if (!HEX128.test(signature)) return "The signature in the tag is not 128 hex characters.";
  return null;
}

async function gpAuthTag(ctx, name) {
  const { scenario, output } = ctx;
  const { gp } = output;
  onContainer(ctx, name, () => {}); // docker looks for the container before gp reads anything
  gp.start();
  const text = await ctx.readLine(ctx.interactive);
  ctx.record.tag = text; // the tag is public data (the owner signs it, the relay sees it): the one input kept as text
  gp.log("Checking the owner attestation");
  onContainer(ctx, name, ({ container, volume }) => {
    const wrong = failure(scenario, "authTag");
    if (wrong) throw new GpError(wrong.code, wrong.message);
    if (scenario.authTag === "reject") throw new GpError("bad-auth-tag", FAILURES.authTag.message);
    const problem = validateTag(text, volume);
    if (problem) throw new GpError("bad-auth-tag", problem);
    volume.tagAccepted = true;
    if (volume.claude === "active") container.connectingLeft = scenario.connectingPolls;
  });
  gp.pair("AUTH_TAG", "accepted");
  return 0;
}

async function gpClaude(ctx, name, action) {
  const { scenario, output } = ctx;
  const { gp } = output;
  if (action === "status") {
    await wait(scenario, "claude-status");
    const claude = onContainer(ctx, name, ({ volume }) => volume.claude);
    gp.start();
    gp.pair("CLAUDE", claude);
    return 0;
  }
  let given;
  if (action === "login") {
    // One process: the address goes out first, and the code comes back on stdin later.
    await wait(scenario, "claude-login");
    const attempt = onContainer(ctx, name, ({ volume }) => ++volume.loginAttempts);
    const volume = onContainer(ctx, name, ({ container }) => container.volume);
    gp.start();
    gp.log("Open the address below, sign in, and send back the code.");
    gp.pair("CLAUDE_LOGIN_URL", `https://claude.example/login?state=${sha256(`login:${volume}:${attempt}`).slice(0, 16)}`);
    given = await ctx.readLine(ctx.interactive);
  } else {
    await wait(scenario, "claude-token");
    onContainer(ctx, name, () => {});
    gp.start();
    given = await ctx.readLine(ctx.interactive);
  }
  // `given` is a code or a token: it is checked and dropped. It is not printed, stored, or put in a message.
  onContainer(ctx, name, ({ container, volume }) => {
    const wrong = failure(scenario, action === "login" ? "claudeLogin" : "claudeToken");
    if (wrong) throw new GpError(wrong.code, wrong.message);
    if (action === "login") {
      if (given === "" || (scenario.loginCode !== null && given !== scenario.loginCode)) {
        throw new GpError("claude-login-failed", FAILURES.claudeLogin.message);
      }
    } else if (given === "" || /\s/.test(given)) throw new GpError("claude-token-invalid", FAILURES.claudeToken.message);
    volume.claude = "active";
    if (volume.tagAccepted) container.connectingLeft = scenario.connectingPolls;
  });
  gp.pair("CLAUDE", "active");
  return 0;
}

/**
 * The scenario's update on offer as the status prints it: `image` and `digest` only when the scenario has the keys (an older GHOST Protocol
 * has none). The version the container already runs is not on offer, as GHOST Protocol has it (an agent started by hand on the new image).
 */
function offerOf({ available, version, ...pins }, current) {
  if (available && version === current) return { available: false, version: null };
  return { available, version, ...("image" in pins && { image: pins.image }), ...("digest" in pins && { digest: pins.digest }) };
}

/** The offer after a way back: `version`, the one it left, with the image it ran as `before`, pinned, when the scenario's GHOST Protocol gives images. */
function offerAfterRollback(scenario, version, before) {
  const offer = { available: true, version };
  if (!("image" in scenario.update)) return offer;
  if (scenario.update.image === null) return { ...offer, image: null, digest: null };
  return { ...offer, image: before, digest: `sha256:${IMAGE.exec(before).groups.digest}` };
}

/** The image an update to `version` runs: the one the offer named when it is a pinned image of that version, else none (the fake makes one up). */
function offeredImage(update) {
  const match = typeof update.image === "string" ? IMAGE.exec(update.image) : null;
  return match && match.groups.tag === update.version && update.digest === `sha256:${match.groups.digest}` ? update.image : undefined;
}

/** One status call moves an update on by one step: the answers `running`, `updating`, then the swap is over. */
function advance(state, container, name, scenario) {
  const t = container.transition;
  if (t.startLeft > 0) {
    t.startLeft--;
    return "running";
  }
  if (t.updatingLeft > 0) {
    t.updatingLeft--;
    return "updating";
  }
  container.previousVersion = t.kind === "update" ? t.from : null;
  container.version = t.to;
  // The agent's container runs the new image (the one the offer named, when it was pinned for that version), or the one it ran before when
  // it goes back; the helper keeps the one it was started with.
  const before = container.image;
  // After an update nothing is on offer: no `image` or `digest` keys. After a way back the version it left is on offer again,
  // pinned as before when the scenario's GHOST Protocol gives images: the image the container ran, which is that version's.
  container.update = t.kind === "update" ? { available: false, version: null } : offerAfterRollback(scenario, t.from, before);
  container.image = t.kind === "rollback" && container.previousImage ? container.previousImage : t.image ?? pinnedImage(IMAGE.exec(before).groups.repository, t.to);
  container.previousImage = t.kind === "update" ? before : null;
  state.images[container.image] = { tag: t.to, name: "ghost-protocol" };
  container.transition = null;
  return "running";
}

function statusOf(state, container, name, scenario) {
  const volume = state.volumes[container.volume];
  let current;
  if (container.transition) current = advance(state, container, name, scenario);
  else if (!volume.tagAccepted) current = "needs-auth-tag";
  else if (volume.claude !== "active") current = "needs-claude";
  else if (container.connectingLeft > 0) {
    container.connectingLeft--;
    current = "connecting";
  } else current = scenario.relay === "connected" ? "running" : "connecting";
  // `relay` is one of the note's three values. Until the agent has tried to connect it is not connected, so: unreachable.
  const tried = current === "running" || current === "updating" || (current === "connecting" && container.connectingLeft === 0 && scenario.relay !== "connected");
  const status = {
    interface: scenario.interface,
    version: container.version,
    state: current,
    agent_pubkey: volume.pubkey,
    relay_url: volume.relay,
    relay: tried ? scenario.relay : "unreachable",
    claude: volume.claude,
    update: container.update ?? offerOf(scenario.update, container.version),
    previous_version: container.previousVersion ?? null,
    error: null,
  };
  return scenario.statusOverride ? { ...status, ...scenario.statusOverride } : status;
}

function gpStatus(ctx, name) {
  const { scenario, output } = ctx;
  const outcome = withState(ctx.dir, (state) => {
    const container = state.containers[name];
    const problem = unreachable(state, name, scenario);
    if (problem) {
      // A status call that lands in the gap of an update uses up one of the gap's calls.
      if (container && inGap(container) && container.transition.gapLeft > 0) container.transition.gapLeft--;
      return { problem };
    }
    return { status: statusOf(state, container, name, scenario) };
  });
  if (outcome.problem) throw new DockerError(outcome.problem);
  if (scenario.statusPreamble) output.gp.start();
  output.out(scenario.statusFormat === "compact" ? `${JSON.stringify(outcome.status)}\n` : `${JSON.stringify(outcome.status, null, 2)}\n`);
  return 0;
}

function gpUpdate(ctx, name, action) {
  const { scenario, output } = ctx;
  const { gp } = output;
  onContainer(ctx, name, ({ state, container }) => {
    gp.start();
    const problem = failure(scenario, action === "request" ? "updateRequest" : "updateRollback");
    if (problem) throw new GpError(problem.code, problem.message);
    const helper = state.containers[`${name}${HELPER_SUFFIX}`];
    if (!helper?.helper || !helper.running) throw new GpError("no-updater", "No update helper is running.");
    if (container.transition) throw new GpError("update-in-progress", "An update is already under way.");
    const t = { from: container.version, startLeft: scenario.updateStartPolls, updatingLeft: scenario.updatingPolls };
    t.gapLeft = scenario.updateGapPolls === "forever" ? -1 : scenario.updateGapPolls;
    if (action === "request") {
      const update = container.update ?? scenario.update;
      if (!update.available) throw new GpError("no-update-available", "There is no update to install.");
      container.transition = { ...t, kind: "update", to: update.version, image: offeredImage(update) };
    } else {
      if (!container.previousVersion) throw new GpError("no-previous-version", "There is no earlier version to go back to.");
      container.transition = { ...t, kind: "rollback", to: container.previousVersion };
    }
  });
  gp.log(action === "request" ? "The agent finishes its task, then the update starts." : "The agent finishes its task, then it goes back.");
  gp.pair("UPDATE", action === "request" ? "requested" : "rollback-requested");
  return 0;
}

// The words of the `gp` commands the interface lists. Anything else after `gp` may be a secret given by mistake, as an argument and not on
// stdin: it is neither shown in a message nor kept in the call log.
const GP_WORDS = { "auth-tag": ["set"], claude: ["status", "login", "token"], status: ["--json"], update: ["request", "rollback"] };

function describeGp(command) {
  const [group, action] = command;
  if (!Object.hasOwn(GP_WORDS, group ?? "")) return "`gp` followed by a command the interface does not list";
  const shown = GP_WORDS[group].includes(action) ? [group, action] : [group];
  const hidden = command.length - shown.length;
  return `\`gp ${shown.join(" ")}\`${hidden > 0 ? ` with ${hidden} more argument${hidden > 1 ? "s" : ""} (not shown: an argument may be a secret)` : ""}`;
}

// What the call log keeps of a command, word by word, for every command: only what the interface has in that place. Anything else, such as a
// token put in an environment flag, a `--token` flag, a container's or an image's place or a stray word, is `<not logged>`.
const LOGGED_WORDS = [
  /^(exec|version|pull|run|restart|stop|rm|inspect|volume|init|gp)$/, // the commands
  /^(-d|--detach|--rm|--name|--restart|-v|--volume|-i|--interactive|-f|--force|--format|--target|--relay|--owner)$/, // the flags the interface lists
  /^gp-[a-z0-9-]+(\.updater|-data(:\/data)?)?$/, // containers, the helper, the data volume and its mount
  /^unless-stopped$/,
  /^\/var\/run\/docker\.sock:\/var\/run\/docker\.sock$/,
  /^wss?:\/\/\S{1,200}$/, // the relay
  /^[0-9a-f]{64}$/, // the owner's public key
  /^\{\{[A-Za-z0-9_. ]*\}\}$/, // a template
];

/** argv as the call log keeps it. */
function loggedArgv(argv) {
  const known = new Set([...Object.keys(GP_WORDS), ...Object.values(GP_WORDS).flat()]);
  const initial = argv.includes("init");
  return argv.map((word, at) => {
    if (known.has(word) || IMAGE.test(word) || LOGGED_WORDS.some((pattern) => pattern.test(word))) return word;
    // The agent's name, given to `init` after --name: free text, but one line and short.
    if (initial && argv[at - 1] === "--name" && /^[^\r\n\0]{1,80}$/.test(word)) return word;
    return "<not logged>";
  });
}

async function dockerExec(ctx) {
  const { flags, rest } = parseFlags(ctx.args, { bool: ["-i", "--interactive"], stop: true });
  const name = parseContainerName(rest[0]).name;
  const [program, ...command] = rest.slice(1);
  if (program !== "gp") throw new Refused(`${plainWord(program)} is not a program of the interface (gp)`);
  ctx.interactive = flag(flags, "-i", "--interactive");
  if (readState(ctx.dir).containers[name]?.helper) throw new Refused(`${name} is the update helper: the interface runs no gp command in it`);
  const [group, action, ...extra] = command;
  const step =
    (group === "auth-tag" && action === "set" && !extra.length && "auth-tag") ||
    (group === "claude" && ["status", "login", "token"].includes(action) && !extra.length && `claude-${action}`) ||
    (group === "status" && action === "--json" && !extra.length && "status") ||
    (group === "update" && ["request", "rollback"].includes(action) && !extra.length && `update-${action}`);
  if (!step) throw new Refused(`${describeGp(command)} is not a command of the interface`);
  await wait(ctx.scenario, step);
  if (step === "auth-tag") return gpAuthTag(ctx, name);
  if (step === "status") return gpStatus(ctx, name);
  if (group === "claude") return gpClaude(ctx, name, action);
  return gpUpdate(ctx, name, action);
}

// ---------------------------------------------------------------------------------------------------------------------------------

const COMMANDS = {
  version: dockerVersion,
  pull: dockerPull,
  run: dockerRun,
  exec: dockerExec,
  restart: dockerRestart,
  stop: dockerStop,
  rm: dockerRm,
  inspect: dockerInspect,
  volume: dockerVolume,
};

function report(error, ctx) {
  if (error instanceof DockerError) {
    if (error.stdout) ctx.output.out(error.stdout);
    ctx.output.err(`${error.message}\n`);
    return error.exitCode;
  }
  if (error instanceof GpError) {
    ctx.output.gp.start();
    ctx.output.out(`GP_ERROR=${error.gpCode}\nGP_ERROR_MESSAGE=${error.message.replace(/\s+/g, " ")}\n`);
    return 1;
  }
  if (error instanceof Refused) {
    ctx.record.refused = true;
    ctx.output.err(`fake-docker: ${error.message}\n`);
    return REFUSED;
  }
  ctx.output.err(`fake-docker: internal error: ${error.stack}\n`);
  return 70;
}

/**
 * Runs one command. `io` has `env`, `stdout`, `stderr` and `stdin` (read only when a command takes input, so a getter is fine).
 * Returns the exit code.
 */
export async function main(argv, io) {
  const dir = io.env.FAKE_DOCKER_STATE;
  if (!dir) {
    io.stderr.write("fake-docker: FAKE_DOCKER_STATE is not set: it names the folder where the fake keeps its state (index.mjs makes one)\n");
    return REFUSED;
  }
  let scenario;
  try {
    scenario = loadScenario(io.env, dir);
  } catch (error) {
    io.stderr.write(`fake-docker: ${error.message}\n`);
    return REFUSED;
  }
  const record = { argv };
  const n = startCall(dir, { argv: loggedArgv(argv) });
  const ctx = { args: argv.slice(1), scenario, dir, record, output: makeOutput(io, scenario), readLine: makeInput(io, record), interactive: false };
  let code;
  try {
    const run = COMMANDS[argv[0]];
    if (!run) throw new Refused(`${plainWord(argv[0])} is not a command of the interface`);
    checkDocker(scenario, argv);
    code = await run(ctx);
  } catch (error) {
    code = report(error, ctx);
  }
  const { argv: _, ...more } = record;
  finishCall(dir, n, { ...more, exit: code });
  return code;
}
