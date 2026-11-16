// The rules of the plugin's interface note that the fake's output must follow, as code. The fake's own tests hold every command to
// them; a test of the plugin can use them to check what it reads. Sections named below are the note's.
import assert from "node:assert/strict";

/** Section 8: the values `state`, `relay` and `claude` take. */
export const STATES = ["needs-claude", "needs-auth-tag", "connecting", "running", "updating", "error"];
export const RELAYS = ["connected", "refused-not-member", "unreachable"];
export const CLAUDE = ["active", "not-active"];
/** Section 8: the keys of `gp status --json`, in the note's order. */
export const STATUS_KEYS = ["interface", "version", "state", "agent_pubkey", "relay_url", "relay", "claude", "update", "previous_version", "error"];

const GP_LINE = /^GP_([A-Z][A-Z0-9_]*)=(.*)$/;
export const HEX64 = /^[0-9a-f]{64}$/;

/** Section 4: the lines of stdout that are `GP_<KEY>=<value>` are for the plugin, and every other line is for people. */
export function parseGp(stdout) {
  const lines = stdout.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const values = {};
  const order = [];
  const log = [];
  for (const line of lines) {
    const match = GP_LINE.exec(line);
    if (!match) log.push(line);
    else {
      assert.ok(!(match[1] in values), `GP_${match[1]} appears twice`);
      values[match[1]] = match[2];
      order.push(match[1]);
    }
  }
  return { lines, values, order, log };
}

/** Section 4: exit 0 means done, and the first line is GP_INTERFACE. */
export function assertGpSuccess(result, { interface: number = 1 } = {}) {
  assert.equal(result.code, 0, `exit ${result.code}: ${result.stdout}${result.stderr}`);
  const parsed = parseGp(result.stdout);
  assert.equal(parsed.lines[0], `GP_INTERFACE=${number}`, "the first line of every GP command is GP_INTERFACE");
  assert.ok(!("ERROR" in parsed.values), "a command that succeeds has no GP_ERROR");
  return parsed;
}

/** Section 4: any other exit code comes with GP_ERROR=<code> and GP_ERROR_MESSAGE=<one line>. */
export function assertGpFailure(result, code, { interface: number = 1 } = {}) {
  assert.notEqual(result.code, 0, "a failure exits non-zero");
  const parsed = parseGp(result.stdout);
  assert.equal(parsed.lines[0], `GP_INTERFACE=${number}`, "the first line of every GP command is GP_INTERFACE");
  assert.equal(parsed.values.ERROR, code);
  assert.match(parsed.values.ERROR_MESSAGE ?? "", /\S/, "GP_ERROR_MESSAGE is there and says something");
  assert.ok(!(parsed.values.ERROR_MESSAGE ?? "").includes("\n"));
  return parsed;
}

/** Section 8, as draft 0.1 of the interface has it: the keys, the values, the shapes. */
export function assertStatusShape(status) {
  assert.deepEqual(Object.keys(status), STATUS_KEYS);
  assert.equal(typeof status.interface, "number");
  assert.equal(typeof status.version, "string");
  assert.ok(STATES.includes(status.state), `state ${status.state}`);
  assert.match(status.agent_pubkey, HEX64);
  assert.match(status.relay_url, /^wss?:\/\//);
  assert.ok(RELAYS.includes(status.relay), `relay ${status.relay}`);
  assert.ok(CLAUDE.includes(status.claude), `claude ${status.claude}`);
  assert.deepEqual(Object.keys(status.update), ["available", "version"]);
  assert.equal(typeof status.update.available, "boolean");
  assert.ok(status.update.version === null || typeof status.update.version === "string");
  assert.ok(status.previous_version === null || typeof status.previous_version === "string");
  assert.ok(status.error === null || (typeof status.error.code === "string" && typeof status.error.message === "string"));
}
