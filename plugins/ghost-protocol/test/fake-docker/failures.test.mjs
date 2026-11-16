// What goes wrong, and what the fake answers: docker missing, the daemon down, a pull that fails, a step of GHOST Protocol that fails, a
// container that is stopped or gone, a command that never answers. And the other half of the fake's job: refusing a command, a flag or a
// name that the interface does not list.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, test } from "node:test";
import { assertGpFailure, parseGp } from "./contract.mjs";
import { BARE_TAG, IMAGE, createAgent, gp, gpInput, imageOfVersion, initArgs, literal, pullArgs, runningAgent, startArgs, status, statusArgs, versionArgs, withFake } from "./support.mjs";

let fake;
afterEach(() => fake?.cleanup());

describe("docker is not installed", () => {
  beforeEach(() => {
    fake = withFake();
  });

  test("starting `docker` fails the way it does when there is none: the process cannot be started (ENOENT)", async () => {
    const failure = await new Promise((resolve) => {
      const child = spawn("docker", versionArgs, { env: fake.missingEnv() });
      child.on("error", resolve);
      child.on("close", () => resolve(null));
    });
    assert.equal(failure?.code, "ENOENT");
  });

  test("or, through a shell, exit 127 and 'command not found' (scenario docker-missing)", async () => {
    fake.use("docker-missing");
    const result = await fake.run(versionArgs);
    assert.deepEqual([result.code, result.stdout, result.stderr], [127, "", "docker: command not found\n"]);
  });
});

describe("the Docker daemon is not running", () => {
  beforeEach(() => {
    fake = withFake("daemon-down");
  });

  test("every command exits 1 and says so on stderr, with nothing on stdout", async () => {
    const commands = [
      versionArgs,
      pullArgs(),
      initArgs(),
      startArgs(),
      gp("maple", "status", "--json"),
      ["restart", "gp-maple"],
      ["stop", "gp-maple"],
      ["rm", "-f", "gp-maple"],
      ["inspect", "gp-maple"],
    ];
    for (const argv of commands) {
      const result = await fake.run(argv);
      assert.equal(result.code, 1, argv.join(" "));
      assert.equal(result.stdout, "", argv.join(" "));
      assert.equal(result.stderr, "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n");
    }
  });

  test("permission denied on the socket is its own text", async () => {
    fake.use("permission-denied");
    const result = await fake.run(versionArgs);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^permission denied while trying to connect to the Docker daemon socket at unix:\/\/\/var\/run\/docker\.sock/);
  });

  test("it comes back when the scenario does", async () => {
    fake.use("ok");
    assert.equal((await fake.run(versionArgs)).code, 0);
  });
});

describe("the wording of newer docker (docker 29) is a scenario of its own: dockerStyle current", () => {
  const down = "failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory\n";

  test("a daemon that is not there: the new text, and docker's empty results on stdout (`[]` for inspect, an empty line for a formatted command)", async () => {
    fake = withFake("daemon-down,docker-29-wording");
    const version = await fake.run(versionArgs);
    assert.deepEqual([version.code, version.stdout, version.stderr], [1, "\n", down]);
    const inspect = await fake.run(["inspect", "gp-maple"]);
    assert.deepEqual([inspect.code, inspect.stdout, inspect.stderr], [1, "[]\n", down]);
    const formatted = await fake.run(["inspect", "-f", "{{.State.Status}}", "gp-maple"]);
    assert.deepEqual([formatted.code, formatted.stdout], [1, "\n"]);
    const pull = await fake.run(pullArgs());
    assert.deepEqual([pull.code, pull.stdout, pull.stderr], [1, "", down]);
  });

  test("a container that is not there: `error: no such object` in lower case, and an empty line from a formatted inspect", async () => {
    fake = withFake("docker-29-wording");
    const plain = await fake.run(["inspect", "gp-nobody"]);
    assert.deepEqual([plain.code, plain.stdout, plain.stderr], [1, "[]\n", "error: no such object: gp-nobody\n"]);
    const formatted = await fake.run(["inspect", "--format", "{{.State.Status}}", "gp-nobody"]);
    assert.deepEqual([formatted.code, formatted.stdout, formatted.stderr], [1, "\n", "error: no such object: gp-nobody\n"]);
  });

  test("the texts the two versions share are the same: no such container, volume in use, not running", async () => {
    for (const style of ["classic", "current"]) {
      fake = withFake({ dockerStyle: style });
      const exec = await fake.run(statusArgs());
      assert.equal(exec.stderr, "Error response from daemon: No such container: gp-maple\n", style);
      const volume = await fake.run(["volume", "rm", "gp-nobody-data"]);
      assert.equal(volume.stderr, "Error response from daemon: get gp-nobody-data: no such volume\n", style);
      fake.cleanup();
    }
  });

  test("the default is the wording of docker 27", async () => {
    fake = withFake();
    const looked = await fake.run(["inspect", "gp-nobody"]);
    assert.equal(looked.stderr, "Error: No such object: gp-nobody\n");
  });

  test("the gap in an update shows the wording of the style chosen", async () => {
    fake = withFake("update-gap,docker-29-wording");
    await runningAgent(fake);
    await fake.run(gp("maple", "update", "request"));
    await status(fake);
    await status(fake);
    await fake.run(statusArgs());
    const looked = await fake.run(["inspect", "gp-maple"]);
    assert.equal(looked.stderr, "error: no such object: gp-maple\n");
  });
});

describe("a pull that fails", () => {
  beforeEach(() => {
    fake = withFake();
  });

  for (const [preset, pattern] of [
    ["pull-not-found", new RegExp(`^Error response from daemon: manifest for ${literal(IMAGE)} not found: manifest unknown`)],
    ["pull-unauthorized", /^Error response from daemon: pull access denied for registry\.example\/ghost-protocol, repository does not exist or may require 'docker login'/],
    ["pull-offline", /^Error response from daemon: Get "https:\/\/registry\.example\/v2\/": dial tcp: lookup registry\.example .* no such host/],
  ]) {
    test(preset, async () => {
      fake.use(preset);
      const result = await fake.run(pullArgs());
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, pattern);
      assert.equal(fake.state().images[IMAGE], undefined, "nothing was pulled");
    });
  }
});

describe("a step of GHOST Protocol that fails: GP_ERROR and GP_ERROR_MESSAGE, exit 1, GP_INTERFACE first", () => {
  test("init-fails: init-failed, and no data volume is made", async () => {
    fake = withFake("init-fails");
    assertGpFailure(await fake.run(initArgs()), "init-failed");
    assert.equal(fake.state().volumes["gp-maple-data"], undefined);
  });

  test("bad-auth-tag: even a well-formed tag", async () => {
    fake = withFake("bad-auth-tag");
    await createAgent(fake);
    const { attestationTag } = await import("./index.mjs");
    const { OWNER } = await import("./support.mjs");
    assertGpFailure(await fake.run(gpInput("maple", "auth-tag", "set"), { input: `${attestationTag(OWNER)}\n` }), "bad-auth-tag");
    assert.equal((await status(fake)).state, "needs-auth-tag");
  });

  test("login-fails: claude-login-failed, and the agent stays signed out", async () => {
    fake = withFake("login-fails");
    await createAgent(fake);
    assertGpFailure(await fake.run(gpInput("maple", "claude", "login"), { input: "a-code\n" }), "claude-login-failed");
    assert.equal(fake.state().volumes["gp-maple-data"].claude, "not-active");
  });

  test("token-rejected: claude-token-invalid, and the token is not in the message", async () => {
    fake = withFake("token-rejected");
    await createAgent(fake);
    const result = await fake.run(gpInput("maple", "claude", "token"), { input: "a-made-up-secret-token-value\n" });
    assertGpFailure(result, "claude-token-invalid");
    assert.ok(!(result.stdout + result.stderr).includes("a-made-up-secret-token-value"));
  });

  test("a failure can carry the scenario's own code and message, always on one line", async () => {
    fake = withFake({ fail: { init: { code: "volume-locked", message: "Line one.\nLine two." } } });
    const result = await fake.run(initArgs());
    const parsed = assertGpFailure(result, "volume-locked");
    assert.equal(parsed.values.ERROR_MESSAGE, "Line one. Line two.");
  });
});

describe("a container that is stopped or gone", () => {
  beforeEach(async () => {
    fake = withFake();
    await createAgent(fake);
  });

  test("gone: every `exec` is 'No such container', and `inspect` says there is no such object", async () => {
    await fake.run(["rm", "-f", "gp-maple"]);
    for (const argv of [statusArgs(), gp("maple", "claude", "status"), gpInput("maple", "auth-tag", "set")]) {
      const result = await fake.run(argv);
      assert.deepEqual([result.code, result.stdout, result.stderr], [1, "", "Error response from daemon: No such container: gp-maple\n"]);
    }
    const looked = await fake.run(["inspect", "gp-maple"]);
    assert.deepEqual([looked.code, looked.stdout], [1, "[]\n"]);
  });

  test("stopped: `exec` fails, and `inspect` shows exited", async () => {
    await fake.run(["stop", "gp-maple"]);
    assert.equal((await fake.run(statusArgs())).code, 1);
    const [view] = JSON.parse((await fake.run(["inspect", "gp-maple"])).stdout);
    assert.equal(view.State.Status, "exited");
  });
});

describe("a command that is slow, or never answers", () => {
  test("delayMs holds an answer back", async () => {
    fake = withFake({ delayMs: { version: 400 } });
    const began = Date.now();
    const result = await fake.run(versionArgs);
    assert.equal(result.code, 0);
    assert.ok(Date.now() - began >= 400);
  });

  test("hang never answers, until it is killed; the call is in the log without an exit code", async () => {
    fake = withFake({ hang: ["version"] });
    const running = fake.start(versionArgs);
    const outcome = await Promise.race([running.exited, new Promise((resolve) => setTimeout(() => resolve("still running"), 700))]);
    assert.equal(outcome, "still running");
    running.kill();
    const ended = await running.exited;
    assert.equal(ended.signal, "SIGTERM");
    const call = fake.calls().find((entry) => entry.argv[0] === "version");
    assert.ok(call && !("exit" in call));
  });
});

describe("a command the interface does not list is refused: exit 64, 'fake-docker: ...' on stderr, refused in the call log", () => {
  beforeEach(async () => {
    fake = withFake();
    await createAgent(fake);
  });

  const refused = [
    ["an image without a tag", pullArgs("registry.example/ghost-protocol")],
    ["a bare tag, with no digest", pullArgs(BARE_TAG)],
    ["a bare tag, in init", initArgs("maple", { image: BARE_TAG })],
    ["a bare tag, in a start", startArgs("maple", BARE_TAG)],
    ["the tag latest, even with a digest", pullArgs(imageOfVersion("latest"))],
    ["an image that is not ghost-protocol", pullArgs(imageOfVersion("1.0.0").replace("/ghost-protocol:", "/other:"))],
    ["an image pinned by digest only", pullArgs("registry.example/ghost-protocol@sha256:" + "a".repeat(64))],
    ["a digest of 63 hex digits", pullArgs(`${BARE_TAG}@sha256:${"a".repeat(63)}`)],
    ["a digest of 65 hex digits", pullArgs(`${BARE_TAG}@sha256:${"a".repeat(65)}`)],
    ["a digest in upper case", pullArgs(`${BARE_TAG}@sha256:${"A".repeat(64)}`)],
    ["a digest that is not hex", pullArgs(`${BARE_TAG}@sha256:${"g".repeat(64)}`)],
    ["a digest of another kind", pullArgs(`${BARE_TAG}@sha512:${"a".repeat(64)}`)],
    ["something after the digest", pullArgs(`${IMAGE}:extra`)],
    ["more than one image", ["pull", IMAGE, IMAGE]],
    ["a volume that is not gp-<slug>-data:/data", initArgs("maple").map((arg) => (arg === "gp-maple-data:/data" ? "maple-data:/data" : arg))],
    ["init without --owner", initArgs().slice(0, -2)],
    ["init with an owner that is not 64 hex", initArgs("maple", { owner: "abc" })],
    ["init with a relay that is not ws:// or wss://", initArgs("maple", { relay: "https://relay.example.com" })],
    ["init with a flag it does not know", [...initArgs(), "--debug"]],
    ["a start without --restart", startArgs().filter((arg, i, all) => arg !== "--restart" && all[i - 1] !== "--restart")],
    ["a start with a different restart policy", startArgs().map((arg) => (arg === "unless-stopped" ? "always" : arg))],
    ["a start with --rm", ["run", "--rm", ...startArgs().slice(1)]],
    ["a start whose container and volume are for different agents", startArgs().map((arg) => (arg === "gp-maple" ? "gp-birch" : arg))],
    ["a start that is not detached", ["run", "--name", "gp-maple", "--restart", "unless-stopped", "-v", "gp-maple-data:/data", IMAGE]],
    ["a command in the image that is not init", ["run", "--rm", "-v", "gp-maple-data:/data", IMAGE, "shell"]],
    ["exec with a terminal", ["exec", "-it", "gp-maple", "gp", "status", "--json"]],
    ["exec of something that is not gp", ["exec", "gp-maple", "sh", "-c", "id"]],
    ["gp status without --json", gp("maple", "status")],
    ["a gp command the note does not list", gp("maple", "reset")],
    ["gp claude with an action the note does not list", gp("maple", "claude", "logout")],
    ["a container name that is not gp-<slug>", ["restart", "maple"]],
    ["docker ps", ["ps"]],
    ["docker version with an argument", ["version", "extra"]],
    ["a global docker flag", ["--host", "tcp://x", "version"]],
  ];
  for (const [label, argv] of refused) {
    test(label, async () => {
      const result = await fake.run(argv);
      assert.equal(result.code, 64, `${argv.join(" ")} -> ${result.stderr}`);
      assert.match(result.stderr, /^fake-docker: /);
      assert.equal(parseGp(result.stdout).order.length, 0);
      assert.equal(fake.calls().at(-1).refused, true);
    });
  }

  test("a start on a volume that was never set up", async () => {
    const result = await fake.run(startArgs("birch"));
    assert.equal(result.code, 64);
    assert.match(result.stderr, /^fake-docker: the volume gp-birch-data was never set up/);
  });
});
