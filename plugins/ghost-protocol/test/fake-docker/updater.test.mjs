// The update helper: a second, long-lived container that swaps the agent's image. The plugin starts it, after the agent's container, only
// when the user said yes to "Let GHOST Protocol update itself?":
//   docker run -d --name gp-<slug>-updater --restart unless-stopped -v /var/run/docker.sock:/var/run/docker.sock <updater image>:<the agent's tag> --target gp-<slug>
// The updater image's name and the arguments after it are a placeholder until GHOST Protocol fixes them (UPDATER_IMAGE_NAME and updaterArgs in
// fake-docker.mjs); everything else in the command is held to what is written above.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { assertGpFailure, assertGpSuccess } from "./contract.mjs";
import { UPDATER_IMAGE, createAgent, gp, pullArgs, runningAgent, startArgs, startHelperArgs, status, withFake } from "./support.mjs";

let fake;
afterEach(() => fake?.cleanup());

describe("the command", () => {
  beforeEach(async () => {
    fake = withFake();
    await createAgent(fake);
  });

  test("starting it prints the container id alone, and the helper then exists, running, beside the agent", async () => {
    assert.equal((await fake.run(["inspect", "gp-maple-updater"])).code, 1, "it exists only after this command");
    const result = await fake.run(startHelperArgs());
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^[0-9a-f]{64}\n$/);
    const [view] = JSON.parse((await fake.run(["inspect", "gp-maple-updater"])).stdout);
    assert.deepEqual([view.Name, view.State.Running, view.Config.Image, view.Mounts], ["/gp-maple-updater", true, UPDATER_IMAGE, []]);
    assert.equal(view.HostConfig.RestartPolicy.Name, "unless-stopped");
    assert.equal(fake.state().containers["gp-maple-updater"].target, "gp-maple");
  });

  test("the image can have any name under any registry path: only the name is a placeholder", async () => {
    const result = await fake.run(startHelperArgs("maple", "ghcr.io/example/other-name.v2:0.0.0"));
    assert.equal(result.code, 0, result.stderr);
  });

  test("an image that is not there yet is pulled by `run`, and says so on stderr", async () => {
    const result = await fake.run(startHelperArgs());
    assert.match(result.stderr, /^Unable to find image 'registry\.example\/ghost-protocol-updater:0\.0\.0' locally\n0\.0\.0: Pulling from ghost-protocol-updater\n/);
  });

  test("a second helper of the same name is docker's own conflict, exit 125", async () => {
    await fake.run(startHelperArgs());
    const again = await fake.run(startHelperArgs());
    assert.equal(again.code, 125);
    assert.match(again.stderr, /Conflict\. The container name "\/gp-maple-updater" is already in use/);
  });

  test("the helper does not hold the agent's data volume, so the volume can be removed once the agent's container is", async () => {
    await fake.run(startHelperArgs());
    await fake.run(["rm", "-f", "gp-maple"]);
    const result = await fake.run(["volume", "rm", "gp-maple-data"]);
    assert.equal(result.code, 0, result.stderr);
  });
});

describe("what is refused: exit 64, and the call log says refused", () => {
  const refused = [
    ["a tag that is not the agent's", startHelperArgs("maple", "registry.example/ghost-protocol-updater:0.0.1"), /must be the agent's \(0\.0\.0\)/],
    ["the tag latest", startHelperArgs("maple", "registry.example/ghost-protocol-updater:latest"), /not latest/],
    ["no tag", startHelperArgs("maple", "registry.example/ghost-protocol-updater"), /is not <registry>\/<updater image>:<exact version>/],
    ["no Docker socket mount", startHelperArgs().filter((arg, i, all) => arg !== "-v" && all[i - 1] !== "-v"), /-v \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/],
    ["the socket mounted somewhere else", startHelperArgs().map((arg) => (arg.startsWith("/var/run/docker.sock:") ? "/var/run/docker.sock:/docker.sock" : arg)), /-v \/var\/run\/docker\.sock/],
    ["the agent's data volume mounted as well", [...startHelperArgs().slice(0, 8), "-v", "gp-maple-data:/data", ...startHelperArgs().slice(8)], /nothing else mounted/],
    ["the socket mounted read-only", startHelperArgs().map((arg) => (arg.startsWith("/var/run/docker.sock:") ? `${arg}:ro` : arg)), /-v \/var\/run\/docker\.sock/],
    ["--rm", ["run", "--rm", ...startHelperArgs().slice(1)], /long-lived/],
    ["no restart policy", startHelperArgs().filter((arg, i, all) => arg !== "--restart" && all[i - 1] !== "--restart"), /--restart unless-stopped/],
    ["another restart policy", startHelperArgs().map((arg) => (arg === "unless-stopped" ? "always" : arg)), /--restart unless-stopped/],
    ["a target that is not the agent", startHelperArgs().map((arg) => (arg === "gp-maple" ? "gp-birch" : arg)), /arguments are `--target gp-maple`/],
    ["no target", startHelperArgs().slice(0, -2), /arguments are `--target gp-maple`/],
    ["more arguments", [...startHelperArgs(), "--verbose"], /arguments are `--target gp-maple`/],
    ["a name that is not gp-<slug>-updater", startHelperArgs().map((arg) => (arg === "gp-maple-updater" ? "maple-updater" : arg)), /./],
  ];
  for (const [label, argv, message] of refused) {
    test(label, async () => {
      fake = withFake();
      await createAgent(fake);
      const result = await fake.run(argv);
      assert.equal(result.code, 64, `${argv.join(" ")} -> ${result.stderr}`);
      assert.match(result.stderr, /^fake-docker: /);
      assert.match(result.stderr, message);
      assert.equal(fake.calls().at(-1).refused, true);
      assert.equal(fake.state().containers["gp-maple-updater"], undefined, "nothing was started");
    });
  }

  test("before the agent's container is started", async () => {
    fake = withFake();
    const result = await fake.run(startHelperArgs());
    assert.equal(result.code, 64);
    assert.match(result.stderr, /started after the agent's container, and gp-maple is not there/);
  });

  test("after a no: `no-self-update` means the plugin never runs it", async () => {
    fake = withFake("no-self-update");
    await createAgent(fake);
    const result = await fake.run(startHelperArgs());
    assert.equal(result.code, 64);
    assert.match(result.stderr, /the user said no to self-update/);
    assert.equal(fake.state().containers["gp-maple-updater"], undefined);
  });

  test("a gp command run in the helper: the interface runs none there", async () => {
    fake = withFake();
    await runningAgent(fake);
    const result = await fake.run(gp("maple-updater", "status", "--json"));
    assert.equal(result.code, 64);
    assert.match(result.stderr, /^fake-docker: gp-maple-updater is the update helper/);
  });
});

describe("pulling the helper's image: during Create, right after the agent's image, with the same exact tag", () => {
  beforeEach(() => {
    fake = withFake();
  });

  test("after the agent's image, `docker pull` of the helper's image prints docker's progress lines for it", async () => {
    await fake.run(pullArgs());
    const result = await fake.run(pullArgs(UPDATER_IMAGE));
    assert.equal(result.code, 0, result.stderr);
    const lines = result.stdout.trimEnd().split("\n");
    assert.equal(lines[0], "0.0.0: Pulling from ghost-protocol-updater");
    assert.equal(lines.at(-2), `Status: Downloaded newer image for ${UPDATER_IMAGE}`);
    assert.equal(lines.at(-1), UPDATER_IMAGE);
  });

  test("the start then does not pull it again: no 'Unable to find image' on stderr", async () => {
    await createAgent(fake); // pulls the agent's image first
    await fake.run(pullArgs(UPDATER_IMAGE));
    const started = await fake.run(startHelperArgs());
    assert.equal(started.code, 0);
    assert.equal(started.stderr, "");
  });

  test("before the agent's image is pulled, or with another tag, it is refused", async () => {
    const before = await fake.run(pullArgs(UPDATER_IMAGE));
    assert.equal(before.code, 64);
    assert.match(before.stderr, /pulled after the agent's image, with the same exact tag \(0\.0\.0\)/);
    await fake.run(pullArgs());
    const other = await fake.run(pullArgs("registry.example/ghost-protocol-updater:0.0.1"));
    assert.equal(other.code, 64);
    assert.match(other.stderr, /pulled after the agent's image, with the same exact tag \(0\.0\.1\)/);
  });

  test("after a no, the plugin pulls nothing for the helper", async () => {
    fake.use("no-self-update");
    await fake.run(pullArgs());
    const result = await fake.run(pullArgs(UPDATER_IMAGE));
    assert.equal(result.code, 64);
    assert.match(result.stderr, /the user said no to self-update: the plugin must not pull the update helper's image/);
  });

  test("a pull that fails fails for the helper's image too", async () => {
    await fake.run(pullArgs());
    fake.use("pull-not-found");
    const result = await fake.run(pullArgs(UPDATER_IMAGE));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /manifest for registry\.example\/ghost-protocol-updater:0\.0\.0 not found/);
  });
});

describe("an update needs a running helper: GP_ERROR=no-updater", () => {
  test("without a helper (the user said no, or the plugin did not start it), request and rollback are no-updater", async () => {
    fake = withFake({ update: { available: true, version: "0.1.1" } });
    await runningAgent(fake, { helper: false });
    assertGpFailure(await fake.run(gp("maple", "update", "request")), "no-updater");
    assertGpFailure(await fake.run(gp("maple", "update", "rollback")), "no-updater");
    fake.use({ selfUpdate: "no", update: { available: true, version: "0.1.1" } });
    assertGpFailure(await fake.run(gp("maple", "update", "request")), "no-updater");
  });

  test("with a helper that is stopped, the same", async () => {
    fake = withFake({ update: { available: true, version: "0.1.1" } });
    await runningAgent(fake);
    await fake.run(["stop", "gp-maple-updater"]);
    assertGpFailure(await fake.run(gp("maple", "update", "request")), "no-updater");
    await fake.run(["restart", "gp-maple-updater"]);
    assertGpSuccess(await fake.run(gp("maple", "update", "request")));
  });

  test("the error comes before the answer about whether there is an update", async () => {
    fake = withFake();
    await runningAgent(fake, { helper: false });
    assertGpFailure(await fake.run(gp("maple", "update", "request")), "no-updater");
  });

  test("the agent's status is not affected by there being no helper", async () => {
    fake = withFake();
    await runningAgent(fake, { helper: false });
    assert.equal((await status(fake)).state, "running");
  });

  test("the agent's start does not start the helper", async () => {
    fake = withFake();
    await createAgent(fake);
    await fake.run(startArgs("maple"));
    assert.equal(fake.state().containers["gp-maple-updater"], undefined);
  });
});
