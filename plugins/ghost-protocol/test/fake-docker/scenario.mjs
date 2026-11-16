// What a test can change about the fake `docker` without editing it: the scenario. It is read at the start of every command, from three
// places, and later ones win (objects are merged key by key; everything else is replaced):
//   1. DEFAULTS below
//   2. the environment variable FAKE_DOCKER_SCENARIO: a preset name, several joined with commas ("relay-refuses,claude-signed-in"), or a
//      JSON object
//   3. scenario.json in the state folder (FAKE_DOCKER_STATE), same forms, so a test can change the scenario between two commands
// Every key is documented in README.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULTS = {
  docker: "ok", // ok | missing | daemon-down | permission-denied
  dockerVersion: "27.3.1",
  dockerStyle: "classic", // classic: the wording of docker 27 | current: the wording of docker 29 (inspect, and a daemon that is not there)
  interface: 1, // the number in `GP_INTERFACE=` and in the status
  pull: "ok", // ok | not-found | unauthorized | network
  authTag: "accept", // accept | reject
  claude: "not-active", // what a new data volume starts with: not-active | active
  loginCode: null, // the code `gp claude login` wants; null accepts any non-empty line
  relay: "connected", // what the status says once the agent has tried to connect: connected | refused-not-member | unreachable
  connectingPolls: 1, // status calls that say `connecting` before `running`
  update: { available: false, version: null }, // what the status says about an update
  updateStartPolls: 0, // status calls that still say `running` after `gp update request` (the agent finishes its task first)
  updatingPolls: 2, // status calls that say `updating`
  updateGapPolls: 0, // status calls, during the update, for which gp-<slug> is not there (the helper swaps it): a number or "forever"
  updateGapKind: "gone", // gone: "No such container" | stopped: the container exists but is not running
  selfUpdate: "yes", // what the user said to "Let GHOST Protocol update itself?": yes | no. After a no the plugin never starts the helper, and the fake refuses the command
  statusFormat: "pretty", // pretty | compact: how the status JSON is printed
  statusPreamble: false, // print `GP_INTERFACE=<n>` before the status JSON
  statusOverride: null, // an object merged over the status JSON, to force any value
  fail: {}, // step -> true | { code, message }: init, authTag, claudeLogin, claudeToken, updateRequest, updateRollback
  delayMs: {}, // step -> milliseconds the command waits before it answers
  hang: [], // steps that never answer (until they are killed)
  logLines: true, // lines for people between the GP_ lines
};

// A failure the fake makes up when the scenario says `fail: { step: true }`. Codes marked (note) are in the interface note; the others are
// assumptions, and README.md lists them.
export const FAILURES = {
  init: { code: "init-failed", message: "Could not set up the data volume." },
  authTag: { code: "bad-auth-tag", message: "The owner attestation was refused." }, // (note)
  claudeLogin: { code: "claude-login-failed", message: "The sign-in code was not accepted." }, // (note)
  claudeToken: { code: "claude-token-invalid", message: "The Claude token was not accepted." },
  updateRequest: { code: "update-failed", message: "The update could not be requested." },
  updateRollback: { code: "rollback-failed", message: "The roll back could not be requested." },
};

const STATUS_ERROR = { code: "crashed", message: "The agent stopped unexpectedly." };

export const PRESETS = {
  ok: {},
  "docker-missing": { docker: "missing" },
  "daemon-down": { docker: "daemon-down" },
  "permission-denied": { docker: "permission-denied" },
  "pull-not-found": { pull: "not-found" },
  "pull-unauthorized": { pull: "unauthorized" },
  "pull-offline": { pull: "network" },
  "init-fails": { fail: { init: true } },
  "bad-auth-tag": { authTag: "reject" },
  "claude-signed-in": { claude: "active" },
  "login-fails": { fail: { claudeLogin: true } },
  "token-rejected": { fail: { claudeToken: true } },
  "relay-refuses": { relay: "refused-not-member" },
  "relay-unreachable": { relay: "unreachable" },
  "update-available": { update: { available: true, version: "0.1.1" } },
  "update-gap": { update: { available: true, version: "0.1.1" }, updateGapPolls: 2 },
  "update-gap-stopped": { update: { available: true, version: "0.1.1" }, updateGapPolls: 2, updateGapKind: "stopped" },
  "update-never-returns": { update: { available: true, version: "0.1.1" }, updateGapPolls: "forever" },
  "no-self-update": { selfUpdate: "no" },
  "docker-29-wording": { dockerStyle: "current", dockerVersion: "29.1.3" },
  "unknown-interface": { interface: 2 },
  "status-error": { statusOverride: { state: "error", error: STATUS_ERROR } },
  "status-compact-with-preamble": { statusFormat: "compact", statusPreamble: true },
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function merge(base, extra) {
  const result = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    result[key] = isObject(value) && isObject(base[key]) ? merge(base[key], value) : value;
  }
  return result;
}

/** A preset name, several joined with commas, or a JSON object, as one object. Throws on anything else. */
export function parseScenario(text) {
  const trimmed = String(text).trim();
  if (trimmed === "") return {};
  if (trimmed.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`the scenario is not valid JSON: ${error.message}`);
    }
    if (!isObject(parsed)) throw new Error("the scenario must be a JSON object");
    return parsed;
  }
  let result = {};
  for (const name of trimmed.split(",").map((part) => part.trim()).filter(Boolean)) {
    if (!Object.hasOwn(PRESETS, name)) throw new Error(`no scenario preset called "${name}" (${Object.keys(PRESETS).join(", ")})`);
    result = merge(result, PRESETS[name]);
  }
  return result;
}

/** The steps a scenario can slow (`delayMs`) or stop (`hang`): one per command the fake answers. */
export const STEPS = [
  "version", "pull", "init", "start", "start-updater", "auth-tag", "claude-status", "claude-login", "claude-token", "status",
  "update-request", "update-rollback", "restart", "stop", "rm", "inspect", "volume-rm",
];

const ENUMS = {
  docker: ["ok", "missing", "daemon-down", "permission-denied"],
  dockerStyle: ["classic", "current"],
  pull: ["ok", "not-found", "unauthorized", "network"],
  authTag: ["accept", "reject"],
  claude: ["not-active", "active"],
  relay: ["connected", "refused-not-member", "unreachable"],
  selfUpdate: ["yes", "no"],
  updateGapKind: ["gone", "stopped"],
  statusFormat: ["pretty", "compact"],
};
const BOOLEANS = ["statusPreamble", "logLines"];
const COUNTS = ["connectingPolls", "updateStartPolls", "updatingPolls"];

const count = (value) => Number.isInteger(value) && value >= 0;
const text = (value) => typeof value === "string" && value !== "";

/** Every value of the scenario checked: an enum, a number's type, a step's name. A typo in a value would otherwise do nothing, quietly. */
function validate(scenario) {
  const bad = (key, expected, got) => {
    throw new Error(`the scenario has a bad value for "${key}": ${JSON.stringify(got)} (expected ${expected})`);
  };
  for (const [key, allowed] of Object.entries(ENUMS)) if (!allowed.includes(scenario[key])) bad(key, `one of ${allowed.join(", ")}`, scenario[key]);
  for (const key of BOOLEANS) if (typeof scenario[key] !== "boolean") bad(key, "true or false", scenario[key]);
  for (const key of COUNTS) if (!count(scenario[key])) bad(key, "a whole number, 0 or more", scenario[key]);
  if (!Number.isInteger(scenario.interface) || scenario.interface < 1) bad("interface", "a whole number, 1 or more", scenario.interface);
  if (!text(scenario.dockerVersion)) bad("dockerVersion", "a version such as 27.3.1", scenario.dockerVersion);
  if (scenario.loginCode !== null && !text(scenario.loginCode)) bad("loginCode", "a non-empty string, or null", scenario.loginCode);
  if (scenario.updateGapPolls !== "forever" && !count(scenario.updateGapPolls)) bad("updateGapPolls", 'a whole number, 0 or more, or "forever"', scenario.updateGapPolls);

  const update = scenario.update;
  if (!isObject(update) || Object.keys(update).some((key) => !["available", "version"].includes(key))) bad("update", "{ available, version }", update);
  if (typeof update.available !== "boolean") bad("update.available", "true or false", update.available);
  if (update.version !== null && !text(update.version)) bad("update.version", "a version, or null", update.version);

  if (scenario.statusOverride !== null && !isObject(scenario.statusOverride)) bad("statusOverride", "an object, or null", scenario.statusOverride);

  if (!isObject(scenario.fail)) bad("fail", "an object of steps", scenario.fail);
  for (const [step, wanted] of Object.entries(scenario.fail)) {
    if (!Object.hasOwn(FAILURES, step)) bad(`fail.${step}`, `a step: ${Object.keys(FAILURES).join(", ")}`, step);
    const fine =
      typeof wanted === "boolean" ||
      (isObject(wanted) && Object.entries(wanted).every(([key, value]) => ["code", "message"].includes(key) && text(value)));
    if (!fine) bad(`fail.${step}`, "true, false, or { code, message }", wanted);
  }

  if (!isObject(scenario.delayMs)) bad("delayMs", "an object of steps", scenario.delayMs);
  for (const [step, ms] of Object.entries(scenario.delayMs)) {
    if (!STEPS.includes(step)) bad(`delayMs.${step}`, `a step: ${STEPS.join(", ")}`, step);
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) bad(`delayMs.${step}`, "milliseconds, 0 or more", ms);
  }

  if (!Array.isArray(scenario.hang)) bad("hang", "a list of steps", scenario.hang);
  for (const step of scenario.hang) if (!STEPS.includes(step)) bad("hang", `steps from: ${STEPS.join(", ")}`, step);
}

const KNOWN = new Set(Object.keys(DEFAULTS));

/** The scenario for this command: defaults, then the environment's, then scenario.json's. An unknown key, or a value it cannot mean, is an error. */
export function loadScenario(env, stateDir) {
  let scenario = DEFAULTS;
  if (env.FAKE_DOCKER_SCENARIO) scenario = merge(scenario, parseScenario(env.FAKE_DOCKER_SCENARIO));
  if (stateDir) {
    let text = null;
    try {
      text = readFileSync(join(stateDir, "scenario.json"), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (text !== null) scenario = merge(scenario, parseScenario(text));
  }
  for (const key of Object.keys(scenario)) {
    if (!KNOWN.has(key)) throw new Error(`the scenario has a key the fake does not know: "${key}"`);
  }
  validate(scenario);
  return scenario;
}
