// Section 5 of the interface note, step by step: what each command of the create flow prints, against the note's output rules.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { HEX64, assertGpFailure, assertGpSuccess, parseGp } from "./contract.mjs";
import { attestationTag, ownerKey } from "./index.mjs";
import { IMAGE, OWNER, RELAY, attest, createAgent, gp, gpInput, initArgs, ok, pullArgs, startArgs, status, statusArgs, versionArgs, withFake } from "./support.mjs";

let fake;
beforeEach(() => {
  fake = withFake();
});
afterEach(() => fake.cleanup());

describe("1. check docker", () => {
  test("`docker version --format {{.Server.Version}}` prints the version alone", async () => {
    const result = await fake.run(versionArgs);
    assert.deepEqual([result.code, result.stdout, result.stderr], [0, "27.3.1\n", ""]);
  });

  test("the version is the scenario's", async () => {
    fake.use({ dockerVersion: "26.1.4" });
    assert.equal((await fake.run(versionArgs)).stdout, "26.1.4\n");
  });

  test("without --format it prints the client and server blocks, as docker does", async () => {
    const result = await fake.run(["version"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^Client:\n Version: +27\.3\.1\n/);
    assert.match(result.stdout, /\nServer: Docker Engine - Community\n/);
  });
});

describe("2. fetch", () => {
  test("`docker pull <IMAGE>` prints progress lines, the digest, the status and the image, and no GP_ line", async () => {
    const result = await fake.run(pullArgs());
    assert.equal(result.code, 0);
    const lines = result.stdout.trimEnd().split("\n");
    assert.equal(lines[0], "0.0.0: Pulling from ghost-protocol");
    assert.ok(lines.some((line) => /^[0-9a-f]{12}: Pull complete$/.test(line)));
    assert.match(lines.find((line) => line.startsWith("Digest: ")), /^Digest: sha256:[0-9a-f]{64}$/);
    assert.equal(lines.at(-2), `Status: Downloaded newer image for ${IMAGE}`);
    assert.equal(lines.at(-1), IMAGE);
    assert.deepEqual(parseGp(result.stdout).order, [], "docker's own output has no GP_ lines");
  });

  test("a second pull says the image is up to date", async () => {
    await fake.run(pullArgs());
    const second = await fake.run(pullArgs());
    assert.match(second.stdout, new RegExp(`Status: Image is up to date for ${IMAGE.replace(/\./g, "\\.")}`));
  });

  test("the registry path in front of ghost-protocol can be longer", async () => {
    const result = await fake.run(pullArgs("ghcr.io/example/ghost-protocol:1.2.3-rc.1"));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^1\.2\.3-rc\.1: Pulling from example\/ghost-protocol\n/);
  });
});

describe("3. provision", () => {
  test("`init` prints GP_INTERFACE first, then GP_VERSION and GP_AGENT_PUBKEY, and nothing else the plugin would read", async () => {
    const { gp: out, result } = await ok(fake, initArgs());
    assert.equal(result.stdout.split("\n")[0], "GP_INTERFACE=1");
    assert.deepEqual(out.order, ["INTERFACE", "VERSION", "AGENT_PUBKEY"]);
    assert.equal(out.values.VERSION, "0.0.0", "the version is the image's tag");
    assert.match(out.values.AGENT_PUBKEY, HEX64);
    assert.ok(out.log.length > 0, "and it has lines for people between them");
  });

  test("the key is made in the volume and never printed", async () => {
    const { result } = await ok(fake, initArgs());
    const key = fake.state().volumes["gp-maple-data"].pubkey;
    assert.equal(result.stdout.split(key).length - 1, 1, "the public key is printed once, as GP_AGENT_PUBKEY");
    assert.ok(!/secret|private|nsec/i.test(result.stdout + result.stderr));
  });

  test("running it again on the same volume prints the same public key; another volume gets another key", async () => {
    const first = await ok(fake, initArgs("maple"));
    const again = await ok(fake, initArgs("maple", { name: "Maple, renamed" }));
    const other = await ok(fake, initArgs("birch"));
    assert.equal(again.gp.values.AGENT_PUBKEY, first.gp.values.AGENT_PUBKEY);
    assert.notEqual(other.gp.values.AGENT_PUBKEY, first.gp.values.AGENT_PUBKEY);
  });

  test("the version it prints follows the tag of the image given", async () => {
    const { gp: out } = await ok(fake, initArgs("maple", { image: "registry.example/ghost-protocol:2.4.6" }));
    assert.equal(out.values.VERSION, "2.4.6");
  });

  test("a name with spaces and non-ASCII characters is one argument", async () => {
    await ok(fake, initArgs("maple", { name: "Måple the 2nd" }));
    assert.equal(fake.state().volumes["gp-maple-data"].name, "Måple the 2nd");
  });

  test("an image that is not pulled yet is pulled by `run`, and says so on stderr, as docker does", async () => {
    const result = await fake.run(initArgs());
    assert.match(result.stderr, /^Unable to find image 'registry\.example\/ghost-protocol:0\.0\.0' locally\n/);
    assert.equal(result.code, 0);
  });
});

describe("4. start", () => {
  test("`docker run -d` prints the container id alone: 64 hex characters", async () => {
    await ok(fake, initArgs());
    const result = await fake.run(startArgs());
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^[0-9a-f]{64}\n$/);
    assert.equal(result.stderr, "");
  });

  test("the agent waits for its attestation: the status says needs-auth-tag", async () => {
    await createAgent(fake);
    assert.equal((await status(fake)).state, "needs-auth-tag");
  });

  test("the container is named gp-<slug>, runs the image, and keeps the policy unless-stopped", async () => {
    const { container, id } = await createAgent(fake);
    const inspect = JSON.parse((await fake.run(["inspect", container])).stdout)[0];
    assert.equal(inspect.Name, "/gp-maple");
    assert.equal(inspect.Id, id);
    assert.equal(inspect.Config.Image, IMAGE);
    assert.equal(inspect.HostConfig.RestartPolicy.Name, "unless-stopped");
    assert.deepEqual(inspect.Mounts.map((mount) => [mount.Name, mount.Destination]), [["gp-maple-data", "/data"]]);
  });

  test("a second container of the same name is docker's own conflict error, exit 125", async () => {
    await createAgent(fake);
    const again = await fake.run(startArgs());
    assert.equal(again.code, 125);
    assert.match(again.stderr, /^docker: Error response from daemon: Conflict\. The container name "\/gp-maple" is already in use by container "[0-9a-f]{64}"/);
  });
});

describe("5. the attestation", () => {
  beforeEach(() => createAgent(fake));

  test("a well-formed tag for the agent's owner is accepted: GP_AUTH_TAG=accepted", async () => {
    const result = await attest(fake);
    const out = assertGpSuccess(result);
    assert.deepEqual(out.order, ["INTERFACE", "AUTH_TAG"]);
    assert.equal(out.values.AUTH_TAG, "accepted");
  });

  test("the status then moves on to needs-claude", async () => {
    await attest(fake);
    assert.equal((await status(fake)).state, "needs-claude");
  });

  test("the call log keeps the tag as text (it is public) and notes the newline the plugin wrote", async () => {
    await attest(fake);
    const call = fake.calls().find((entry) => entry.argv.includes("auth-tag"));
    assert.equal(call.tag, attestationTag(OWNER));
    assert.deepEqual([call.stdin.attached, call.stdin.terminated], [true, true]);
  });

  test("a tag for another owner is GP_ERROR=bad-auth-tag, with a message on one line", async () => {
    const result = await fake.run(gpInput("maple", "auth-tag", "set"), { input: `${attestationTag(ownerKey("someone else"))}\n` });
    assert.equal(result.code, 1);
    assertGpFailure(result, "bad-auth-tag");
  });

  test("a tag that is not four strings, not JSON, or not signed is refused the same way", async () => {
    for (const bad of ["not json", '["auth","x"]', JSON.stringify(["auth", OWNER, "", "short"]), JSON.stringify(["nope", OWNER, "", "f".repeat(128)])]) {
      assertGpFailure(await fake.run(gpInput("maple", "auth-tag", "set"), { input: `${bad}\n` }), "bad-auth-tag");
    }
  });

  test("conditions may be empty, or not", async () => {
    assertGpSuccess(await fake.run(gpInput("maple", "auth-tag", "set"), { input: `${attestationTag(OWNER, "")}\n` }));
    assertGpSuccess(await fake.run(gpInput("maple", "auth-tag", "set"), { input: `${attestationTag(OWNER, "kind=1&created_at<9999999999")}\n` }));
  });

  test("run without -i the command gets no input, so the tag is not there: bad-auth-tag (the plugin must pass -i)", async () => {
    const result = await fake.run(gp("maple", "auth-tag", "set"), { input: `${attestationTag(OWNER)}\n` });
    assertGpFailure(result, "bad-auth-tag");
    assert.equal(fake.calls().at(-1).stdin.attached, false);
  });

  test("the tag need not end in a newline if stdin is closed after it", async () => {
    assertGpSuccess(await fake.run(gpInput("maple", "auth-tag", "set"), { input: attestationTag(OWNER) }));
    assert.equal(fake.calls().at(-1).stdin.terminated, false);
  });

  test("the process ends after one line even when the plugin keeps stdin open", async () => {
    const running = fake.start(gpInput("maple", "auth-tag", "set"));
    running.write(`${attestationTag(OWNER)}\n`);
    const result = await Promise.race([running.exited, new Promise((resolve) => setTimeout(() => resolve("hung"), 5000))]);
    running.end();
    assert.notEqual(result, "hung", "the fake waited for the end of stdin");
    assert.equal(result.code, 0);
  });
});

describe("6 and 7. Claude, then waiting for `running`", () => {
  beforeEach(async () => {
    await createAgent(fake);
    await attest(fake);
  });

  test("`gp claude status` prints GP_CLAUDE=not-active, then active after a sign-in", async () => {
    assert.equal(assertGpSuccess(await fake.run(gp("maple", "claude", "status"))).values.CLAUDE, "not-active");
    await fake.run(gpInput("maple", "claude", "token"), { input: "made-up-token\n" });
    const after = assertGpSuccess(await fake.run(gp("maple", "claude", "status")));
    assert.deepEqual(after.order, ["INTERFACE", "CLAUDE"]);
    assert.equal(after.values.CLAUDE, "active");
  });

  test("way A: `claude login` prints the address first and waits for the code on stdin, then GP_CLAUDE=active", async () => {
    const login = fake.start(gpInput("maple", "claude", "login"));
    await waitFor(() => login.stdout().includes("GP_CLAUDE_LOGIN_URL="), "the address");
    assert.equal(login.child.exitCode, null, "it is still running, waiting for the code");
    assert.match(login.stdout(), /^GP_INTERFACE=1\n/);
    assert.match(login.stdout(), /\nGP_CLAUDE_LOGIN_URL=https:\/\/claude\.example\/login\?state=[0-9a-f]{16}\n/);
    login.write("a-made-up-code\n");
    const result = await login.exited;
    const out = assertGpSuccess(result);
    assert.deepEqual(out.order, ["INTERFACE", "CLAUDE_LOGIN_URL", "CLAUDE"]);
    assert.equal(out.values.CLAUDE, "active");
  });

  test("a second login prints another address", async () => {
    const first = (await fake.run(gpInput("maple", "claude", "login"), { input: "code\n" })).stdout;
    const second = (await fake.run(gpInput("maple", "claude", "login"), { input: "code\n" })).stdout;
    const address = (text) => /GP_CLAUDE_LOGIN_URL=(.*)/.exec(text)[1];
    assert.notEqual(address(first), address(second));
  });

  test("an empty code, or the wrong one when the scenario wants one, is GP_ERROR=claude-login-failed", async () => {
    assertGpFailure(await fake.run(gpInput("maple", "claude", "login"), { input: "\n" }), "claude-login-failed");
    fake.use({ loginCode: "123456" });
    assertGpFailure(await fake.run(gpInput("maple", "claude", "login"), { input: "654321\n" }), "claude-login-failed");
    assertGpSuccess(await fake.run(gpInput("maple", "claude", "login"), { input: "123456\n" }));
  });

  test("way B: `claude token` takes the token on stdin and prints GP_CLAUDE=active", async () => {
    const out = assertGpSuccess(await fake.run(gpInput("maple", "claude", "token"), { input: "made-up-token-0123456789\n" }));
    assert.deepEqual(out.order, ["INTERFACE", "CLAUDE"]);
  });

  test("a token with a space in it, or an empty one, is claude-token-invalid", async () => {
    assertGpFailure(await fake.run(gpInput("maple", "claude", "token"), { input: "two words\n" }), "claude-token-invalid");
    assertGpFailure(await fake.run(gpInput("maple", "claude", "token"), { input: "\n" }), "claude-token-invalid");
  });

  test("the status goes needs-claude, connecting, running, as the polls go on", async () => {
    assert.equal((await status(fake)).state, "needs-claude");
    await fake.run(gpInput("maple", "claude", "token"), { input: "made-up-token\n" });
    assert.deepEqual([(await status(fake)).state, (await status(fake)).state, (await status(fake)).state], ["connecting", "running", "running"]);
  });
});

describe("the whole flow, as the plugin runs it", () => {
  test("version, pull, init, start, attest, token, poll until running", async () => {
    const steps = [
      [versionArgs],
      [pullArgs()],
      [initArgs()],
      [startArgs()],
      [gpInput("maple", "auth-tag", "set"), `${attestationTag(OWNER)}\n`],
      [gpInput("maple", "claude", "token"), "made-up-token\n"],
    ];
    for (const [argv, input] of steps) assert.equal((await fake.run(argv, input === undefined ? undefined : { input })).code, 0, argv.join(" "));
    const seen = [];
    for (let i = 0; i < 5 && seen.at(-1) !== "running"; i++) seen.push((await status(fake)).state);
    assert.deepEqual(seen, ["connecting", "running"]);
    const final = JSON.parse((await fake.run(statusArgs())).stdout);
    assert.equal(final.relay, "connected");
    assert.equal(final.relay_url, RELAY);
    assert.equal(final.agent_pubkey, fake.state().volumes["gp-maple-data"].pubkey);
    assert.equal(fake.calls().filter((call) => call.refused).length, 0, "the fake refused none of the plugin's commands");
  });
});

async function waitFor(condition, what, ms = 5000) {
  const give = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > give) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
