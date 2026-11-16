// Section 8 of the interface note, and section 10's update and way back: `gp status --json` in every state, relay and Claude value, an
// update available, an unknown interface number, and an update that walks through `updating` (with or without the gap of the swap).
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { RELAYS, STATES, STATUS_KEYS, assertGpFailure, assertGpSuccess, assertStatusShape } from "./contract.mjs";
import { RELAY, createAgent, attest, gp, gpInput, imageOfVersion, runningAgent, status, statusArgs, withFake } from "./support.mjs";

let fake;
afterEach(() => fake?.cleanup());

const polls = async (count, slug = "maple") => {
  const seen = [];
  for (let i = 0; i < count; i++) seen.push(await status(fake, slug));
  return seen;
};

describe("the shape", () => {
  beforeEach(async () => {
    fake = withFake();
    await runningAgent(fake);
  });

  test("the JSON alone on stdout: no GP_INTERFACE line before it, one object, the note's keys in the note's order", async () => {
    const result = await fake.run(statusArgs());
    assert.equal(result.code, 0);
    assert.ok(result.stdout.startsWith("{\n"), "the first character is the start of the JSON");
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed), STATUS_KEYS);
    assertStatusShape(parsed);
    assert.equal(parsed.interface, 1);
  });

  test("a running agent: connected, active, no update, no previous version, no error", async () => {
    const current = await status(fake);
    assert.deepEqual(
      { state: current.state, relay: current.relay, claude: current.claude, update: current.update, previous: current.previous_version, error: current.error },
      { state: "running", relay: "connected", claude: "active", update: { available: false, version: null }, previous: null, error: null },
    );
    assert.equal(current.relay_url, RELAY);
    assert.equal(current.version, "0.0.0");
  });

  test("the scenario can print it compact, or with GP_INTERFACE before it", async () => {
    fake.use({ statusFormat: "compact" });
    const compact = (await fake.run(statusArgs())).stdout;
    assert.equal(compact.trimEnd().split("\n").length, 1);
    assertStatusShape(JSON.parse(compact));
    fake.use("status-compact-with-preamble");
    const preamble = (await fake.run(statusArgs())).stdout.split("\n");
    assert.equal(preamble[0], "GP_INTERFACE=1");
    assertStatusShape(JSON.parse(preamble[1]));
  });

  test("statusOverride forces any value, so every value of the note can be shown", async () => {
    for (const state of STATES) {
      fake.use({ statusOverride: { state } });
      assert.equal((await status(fake)).state, state);
    }
    for (const relay of RELAYS) {
      fake.use({ statusOverride: { relay } });
      assert.equal((await status(fake)).relay, relay);
    }
    fake.use("status-error");
    const failed = await status(fake);
    assert.equal(failed.state, "error");
    assert.deepEqual(Object.keys(failed.error), ["code", "message"]);
    assertStatusShape(failed);
  });
});

describe("from a new agent to a running one", () => {
  test("needs-auth-tag, needs-claude, connecting, running; relay unreachable until the agent has connected", async () => {
    fake = withFake();
    await createAgent(fake);
    const seen = [await status(fake)];
    await attest(fake);
    seen.push(await status(fake));
    await fake.run(gpInput("maple", "claude", "token"), { input: "made-up-token\n" });
    seen.push(...(await polls(2)));
    assert.deepEqual(seen.map((s) => [s.state, s.relay, s.claude]), [
      ["needs-auth-tag", "unreachable", "not-active"],
      ["needs-claude", "unreachable", "not-active"],
      ["connecting", "unreachable", "active"],
      ["running", "connected", "active"],
    ]);
    seen.forEach(assertStatusShape);
  });

  test("a Claude sign-in made before the attestation still waits for the attestation", async () => {
    fake = withFake("claude-signed-in");
    await createAgent(fake);
    assert.equal((await status(fake)).state, "needs-auth-tag");
    await attest(fake);
    assert.deepEqual((await polls(2)).map((s) => s.state), ["connecting", "running"]);
  });

  test("connectingPolls sets how many answers say connecting", async () => {
    fake = withFake({ claude: "active", connectingPolls: 3 });
    await createAgent(fake);
    await attest(fake);
    assert.deepEqual((await polls(5)).map((s) => s.state), ["connecting", "connecting", "connecting", "running", "running"]);
  });
});

describe("the relay", () => {
  test("refused-not-member: the state stays connecting, and the relay field says why (draft 0.1)", async () => {
    fake = withFake("relay-refuses,claude-signed-in");
    await createAgent(fake);
    await attest(fake);
    const seen = await polls(4);
    assert.deepEqual([...new Set(seen.map((s) => s.state))], ["connecting"]);
    assert.equal(seen.at(-1).relay, "refused-not-member");
    assert.match(seen.at(-1).agent_pubkey, /^[0-9a-f]{64}$/, "the public key is there for the copy button");
  });

  test("unreachable: the same, with the other value", async () => {
    fake = withFake("relay-unreachable,claude-signed-in");
    await createAgent(fake);
    await attest(fake);
    const seen = await polls(4);
    assert.equal(seen.at(-1).state, "connecting");
    assert.equal(seen.at(-1).relay, "unreachable");
  });
});

describe("an unknown interface number", () => {
  test("the status carries the number, and so does the first line of every GP command", async () => {
    fake = withFake();
    await createAgent(fake);
    fake.use("unknown-interface");
    assert.equal((await status(fake)).interface, 2);
    const claude = await fake.run(gp("maple", "claude", "status"));
    assert.equal(claude.stdout.split("\n")[0], "GP_INTERFACE=2");
    assertGpSuccess(claude, { interface: 2 });
  });
});

describe("update and way back", () => {
  beforeEach(async () => {
    fake = withFake("update-available");
    await runningAgent(fake);
  });

  test("the status says an update is available, and nothing about a previous version yet", async () => {
    const before = await status(fake);
    assert.deepEqual(before.update, { available: true, version: "0.1.1" });
    assert.equal(before.previous_version, null);
  });

  test("`gp update request` prints GP_UPDATE=requested; the state goes updating and back to running with the new version", async () => {
    const out = assertGpSuccess(await fake.run(gp("maple", "update", "request")));
    assert.deepEqual(out.order, ["INTERFACE", "UPDATE"]);
    assert.equal(out.values.UPDATE, "requested");
    const seen = await polls(4);
    assert.deepEqual(seen.map((s) => [s.state, s.version]), [["updating", "0.0.0"], ["updating", "0.0.0"], ["running", "0.1.1"], ["running", "0.1.1"]]);
    assert.equal(seen[2].previous_version, "0.0.0");
    assert.deepEqual(seen[2].update, { available: false, version: null });
    seen.forEach(assertStatusShape);
  });

  test("the agent finishes its task first: updateStartPolls answers still say running", async () => {
    fake.tweak({ updateStartPolls: 2 });
    await fake.run(gp("maple", "update", "request"));
    assert.deepEqual((await polls(5)).map((s) => s.state), ["running", "running", "updating", "updating", "running"]);
  });

  test("`gp update rollback` prints GP_UPDATE=rollback-requested and goes back, with the update offered again", async () => {
    await fake.run(gp("maple", "update", "request"));
    await polls(3);
    const out = assertGpSuccess(await fake.run(gp("maple", "update", "rollback")));
    assert.equal(out.values.UPDATE, "rollback-requested");
    const seen = await polls(3);
    assert.deepEqual(seen.map((s) => [s.state, s.version]), [["updating", "0.1.1"], ["updating", "0.1.1"], ["running", "0.0.0"]]);
    assert.equal(seen[2].previous_version, null);
    assert.deepEqual(seen[2].update, { available: true, version: "0.1.1" });
  });

  test("the agent's container runs the new image after an update and the old one after a rollback; the helper keeps the one it was started with", async () => {
    const image = async (name) => (await fake.run(["inspect", "-f", "{{.Config.Image}}", name])).stdout.trim();
    assert.equal(await image("gp-maple"), imageOfVersion("0.0.0"));
    await fake.run(gp("maple", "update", "request"));
    await polls(3);
    assert.equal(await image("gp-maple"), imageOfVersion("0.1.1"), "the new image has its own tag and its own digest");
    assert.notEqual(imageOfVersion("0.1.1").split("@")[1], imageOfVersion("0.0.0").split("@")[1]);
    assert.equal(await image("gp-maple.updater"), imageOfVersion("0.0.0"));
    assert.equal(fake.state().images[imageOfVersion("0.1.1")].name, "ghost-protocol");
    await fake.run(gp("maple", "update", "rollback"));
    await polls(3);
    assert.equal(await image("gp-maple"), imageOfVersion("0.0.0"));
  });

  test("without an update, `request` is no-update-available; without a previous version, `rollback` is no-previous-version", async () => {
    assertGpFailure(await fake.run(gp("maple", "update", "rollback")), "no-previous-version");
    fake.use({});
    assertGpFailure(await fake.run(gp("maple", "update", "request")), "no-update-available");
  });

  test("a second request while one is under way is update-in-progress", async () => {
    await fake.run(gp("maple", "update", "request"));
    assertGpFailure(await fake.run(gp("maple", "update", "request")), "update-in-progress");
  });

  test("the scenario can make a request or a rollback fail", async () => {
    fake.tweak({ fail: { updateRequest: true } });
    assertGpFailure(await fake.run(gp("maple", "update", "request")), "update-failed");
    fake.tweak({ fail: { updateRequest: false, updateRollback: { code: "disk-full", message: "No room to go back." } } });
    assertGpFailure(await fake.run(gp("maple", "update", "rollback")), "disk-full");
  });
});

describe("a roll back puts back the image the agent had, digest included", () => {
  // A digest the fake did not make up, so that giving back a digest made up for the version would be a different image.
  const started = `registry.example/ghost-protocol:0.0.0@sha256:${"b".repeat(64)}`;
  const image = async (name) => (await fake.run(["inspect", "-f", "{{.Config.Image}}", name])).stdout.trim();

  test("the update swaps to the new version's image, and the roll back goes back to the one the agent started with", async () => {
    fake = withFake("update-available");
    fake.seed({ image: started });
    assert.equal(await image("gp-maple"), started);
    await fake.run(gp("maple", "update", "request"));
    await polls(3);
    assert.equal(await image("gp-maple"), imageOfVersion("0.1.1"));
    await fake.run(gp("maple", "update", "rollback"));
    await polls(3);
    assert.equal(await image("gp-maple"), started);
    assert.equal(await image("gp-maple.updater"), started, "the helper kept the one it was started with throughout");
  });
});

describe("the gap while the helper swaps the container (interface draft 0.1)", () => {
  async function untilGap() {
    await runningAgent(fake);
    await fake.run(gp("maple", "update", "request"));
    assert.deepEqual((await polls(2)).map((s) => s.state), ["updating", "updating"]);
  }

  test("gone: the status calls fail with 'No such container', inspect finds nothing, and then the new version is back", async () => {
    fake = withFake("update-gap");
    await untilGap();
    const failed = await fake.run(statusArgs());
    assert.equal(failed.code, 1);
    assert.equal(failed.stdout, "");
    assert.equal(failed.stderr, "Error response from daemon: No such container: gp-maple\n");
    const looked = await fake.run(["inspect", "gp-maple"]);
    assert.deepEqual([looked.code, looked.stdout, looked.stderr], [1, "[]\n", "Error: No such object: gp-maple\n"]);
    assert.equal((await fake.run(statusArgs())).code, 1, "the gap lasts for updateGapPolls (2) status calls");
    assert.equal(JSON.parse((await fake.run(["inspect", "gp-maple"])).stdout)[0].State.Status, "running", "and then the container is there again");
    const back = await status(fake);
    assert.deepEqual([back.state, back.version, back.previous_version], ["running", "0.1.1", "0.0.0"]);
  });

  test("stopped: the container is there but not running, and the call fails with that", async () => {
    fake = withFake("update-gap-stopped");
    await untilGap();
    const failed = await fake.run(statusArgs());
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /^Error response from daemon: container [0-9a-f]{64} is not running\n$/);
    const looked = JSON.parse((await fake.run(["inspect", "gp-maple"])).stdout)[0];
    assert.deepEqual([looked.State.Status, looked.State.Running], ["exited", false]);
    await fake.run(statusArgs());
    assert.equal((await status(fake)).state, "running");
  });

  test("never returns: every call fails, for a plugin to give up after its two minutes", async () => {
    fake = withFake("update-never-returns");
    await untilGap();
    for (let i = 0; i < 6; i++) assert.equal((await fake.run(statusArgs())).code, 1);
  });

  test("the other commands see the gap too: `gp claude status` fails the same way", async () => {
    fake = withFake("update-gap");
    await untilGap();
    const result = await fake.run(gp("maple", "claude", "status"));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No such container: gp-maple/);
  });
});
