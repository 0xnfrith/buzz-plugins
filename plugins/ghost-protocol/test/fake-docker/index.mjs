// What a test of the plugin uses to run against the fake `docker`: a state folder of its own, the environment that puts the fake first on the
// PATH, a way to choose the scenario, and a look at what the fake was asked and what it knows. See README.md.
//
//   const fake = createFakeDocker({ scenario: "claude-signed-in" });
//   spawn("docker", ["version", "--format", "{{.Server.Version}}"], { env: fake.env() });
//   fake.use("daemon-down");   // from now on
//   fake.cleanup();
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinnedImage } from "./image.mjs";
import { PRESETS, loadScenario, merge, parseScenario } from "./scenario.mjs";
import { readCalls, readState, withState } from "./store.mjs";

/** The folder that holds the executable `docker`. */
export const BIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "bin");
export const PRESET_NAMES = Object.keys(PRESETS);

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** The image of one version, as the fake pins it: `<repository>/ghost-protocol:<tag>@sha256:<digest>`. The repository is registry.example unless given. */
export const imageOfVersion = (tag, repository = "registry.example") => pinnedImage(repository, tag);

/** A made-up owner public key (64 hex), the same for the same label. */
export const ownerKey = (label = "owner") => sha256(`owner:${label}`);

/**
 * A well-formed owner attestation, as Buzz would hand it to the type's `activate`: ["auth", <owner>, <conditions>, <signature>]. The
 * signature is made up: the fake checks the shape and the owner, not the signature.
 */
export const attestationTag = (owner = ownerKey(), conditions = "") =>
  JSON.stringify(["auth", owner, conditions, sha256(`signature:${owner}:${conditions}:1`) + sha256(`signature:${owner}:${conditions}:2`)]);

export function createFakeDocker({ scenario = {}, dir } = {}) {
  const stateDir = dir ?? mkdtempSync(join(tmpdir(), "fake-docker-"));
  const emptyBin = join(stateDir, "no-docker-here");
  mkdirSync(emptyBin, { recursive: true });
  const scenarioFile = join(stateDir, "scenario.json");

  function write(next) {
    const given = typeof next === "string" ? parseScenario(next) : next;
    let before = null;
    try {
      before = readFileSync(scenarioFile, "utf8");
    } catch {
      // there was no scenario yet
    }
    writeFileSync(scenarioFile, JSON.stringify(given));
    try {
      loadScenario({}, stateDir); // an unknown key, preset or value is an error here, in the test, and not in the middle of a command
    } catch (error) {
      if (before === null) rmSync(scenarioFile, { force: true });
      else writeFileSync(scenarioFile, before); // the scenario that was in force stays in force
      throw error;
    }
  }
  write(scenario);

  const running = new Set();

  /**
   * Starts the fake and gives a handle on it: what it printed so far, a way to write to its stdin, and when it ended. A process that is
   * still there after `timeoutMs` (30 s) is killed and ends with `timedOut: true`, and `cleanup()` kills any that are left, so a test that
   * fails half way cannot leave one waiting (or hang the run).
   */
  function start(argv, { env, input, timeoutMs = 30_000 } = {}) {
    const child = spawn(join(BIN_DIR, "docker"), argv, { env: env ?? fake.env(), stdio: ["pipe", "pipe", "pipe"] });
    running.add(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.stdin.on("error", () => {}); // the fake may exit before it reads
    const exited = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        running.delete(child);
        resolve({ code, signal, stdout, stderr, timedOut });
      });
    });
    if (input !== undefined) child.stdin.end(input);
    return {
      child,
      exited,
      stdout: () => stdout,
      stderr: () => stderr,
      write: (text) => child.stdin.write(text),
      end: () => child.stdin.end(),
      kill: (signal = "SIGTERM") => child.kill(signal),
    };
  }

  const fake = {
    binDir: BIN_DIR,
    stateDir,
    /** `base` with the fake first on the PATH and its state folder named. */
    env: (base = process.env) => ({ ...base, PATH: `${BIN_DIR}${delimiter}${base.PATH ?? ""}`, FAKE_DOCKER_STATE: stateDir }),
    /** `base` with a PATH that has no `docker` anywhere, so that starting `docker` fails as it does when docker is not installed. */
    missingEnv: (base = process.env) => {
      const { FAKE_DOCKER_STATE: _state, ...rest } = base;
      return { ...rest, PATH: emptyBin };
    },
    /** Replaces the scenario, from now on: a preset name (or several joined with commas), or an object. */
    use: write,
    /** Changes some keys of the scenario and keeps the rest. */
    tweak(changes) {
      write(merge(JSON.parse(readFileSync(scenarioFile, "utf8")), changes));
    },
    start,
    /** Runs the fake once. `input` is what goes to its stdin (stdin is closed after it). */
    run: (argv, options) => start(argv, { input: "", ...options }).exited,
    /** Every command the fake was run with, in order: { n, argv, exit, stdin: { attached, bytes, sha256 }, refused? }. */
    calls: () => readCalls(stateDir),
    /** What docker would know now: { images, volumes, containers }. */
    state: () => readState(stateDir),
    /** Changes what docker would know, under the fake's own lock. */
    patchState: (change) => withState(stateDir, change),
    /**
     * Puts an agent in place without running its commands: a data volume (and a container, unless `container: false`) in the stated
     * condition. `condition`: needs-auth-tag | needs-claude | running | stopped. Returns the names and the made-up key.
     */
    seed(options = {}) {
      const { slug = "maple", name = "Maple", relay = "wss://relay.example.com", owner = ownerKey(), version = "0.0.0", condition = "running", container = true } = options;
      const volume = `gp-${slug}-data`;
      const image = options.image ?? imageOfVersion(version);
      // The update helper runs beside the agent when the user said yes to self-update (the scenario's `selfUpdate`), or as `updater` says.
      const helper = container && (options.updater ?? loadScenario({}, stateDir).selfUpdate === "yes");
      return withState(stateDir, (state) => {
        const pubkey = sha256(`agent-key:${volume}:seed`);
        const tagged = condition !== "needs-auth-tag";
        const signedIn = condition === "running" || condition === "stopped";
        state.images[image] = { tag: version, name: "ghost-protocol" };
        state.volumes[volume] = { pubkey, claude: signedIn ? "active" : "not-active", tagAccepted: tagged, loginAttempts: 0, name, relay, owner };
        if (container) {
          state.containers[`gp-${slug}`] = {
            id: sha256(`container:gp-${slug}:seed`),
            image,
            volume,
            version,
            running: condition !== "stopped",
            connectingLeft: 0,
            previousVersion: options.previousVersion ?? null,
            previousImage: null,
            update: null,
            transition: null,
          };
        }
        if (helper) {
          state.containers[`gp-${slug}.updater`] = {
            id: sha256(`container:gp-${slug}.updater:seed`),
            image, // the agent's own image
            volume: null,
            version,
            running: true,
            helper: true,
            target: `gp-${slug}`,
          };
        }
        return { container: `gp-${slug}`, volume, pubkey, owner, image };
      });
    },
    cleanup() {
      for (const child of running) child.kill("SIGKILL");
      rmSync(stateDir, { recursive: true, force: true });
    },
  };

  return fake;
}
