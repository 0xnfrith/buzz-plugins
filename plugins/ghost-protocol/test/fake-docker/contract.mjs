// The rules of the plugin's interface note that the fake's output must follow, as code. The fake's own tests hold every command to
// them; a test of the plugin can use them to check what it reads. Sections named below are the note's.
import assert from "node:assert/strict";
import { IMAGE } from "./image.mjs";

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
  assertUpdateShape(status.update);
  assert.ok(status.previous_version === null || typeof status.previous_version === "string");
  assert.ok(status.error === null || (typeof status.error.code === "string" && typeof status.error.message === "string"));
}

/**
 * The update on offer: `update` is `{available: false, version: null}` with nothing on offer. With a version on offer it is
 * `{available: true, version}` (a GHOST Protocol that gives no image), or also `image` and `digest`: the image of that version pinned by
 * digest, `<registry>/ghost-protocol:<version>@<digest>`, and `sha256:<64 hex>`. Both are `null` only for a version offered by hand in a test.
 */
export function assertUpdateShape(update) {
  assert.equal(typeof update.available, "boolean");
  assert.ok(update.version === null || typeof update.version === "string");
  if (!update.available) {
    assert.deepEqual(update, { available: false, version: null }, "with nothing on offer, update has no image or digest");
    return;
  }
  assert.equal(typeof update.version, "string", "an update on offer has a version");
  if (!("image" in update) && !("digest" in update)) return;
  assert.deepEqual(Object.keys(update), ["available", "version", "image", "digest"]);
  if (update.image === null || update.digest === null) {
    assert.deepEqual([update.image, update.digest], [null, null], "image and digest are null together");
    return;
  }
  assert.equal(typeof update.image, "string");
  assert.match(update.digest, /^sha256:[0-9a-f]{64}$/);
  const match = IMAGE.exec(update.image);
  assert.ok(match, `update.image ${update.image} is a pinned image`);
  assert.notEqual(match.groups.tag, "latest", "update.image is not latest");
  assert.equal(match.groups.tag, update.version, "update.image is the version on offer");
  assert.equal(`sha256:${match.groups.digest}`, update.digest, "update.digest is the digest of update.image");
}
