// The update helper: a second, long-lived container that swaps the agent's image. It runs the agent's own image and exact tag with a different
// command. The plugin starts it, after the agent's container, only when the user said yes to "Let GHOST Protocol update itself?":
//   docker run -d --name gp-<slug>.updater --restart unless-stopped -v /var/run/docker.sock:/var/run/docker.sock <agent image>:<tag> <updater command> --target gp-<slug>
// The updater command and its arguments are a placeholder until GHOST Protocol fixes them (UPDATER_COMMAND in fake-docker.mjs, null for now:
// any command words are taken); everything else in the command is held to what is written above.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { assertGpFailure, assertGpSuccess } from "./contract.mjs";
import { IMAGE, createAgent, gp, pullArgs, runningAgent, startArgs, startHelperArgs, status, withFake } from "./support.mjs";

let fake;
afterEach(() => fake?.cleanup());

describe("the command", () => {
  beforeEach(async () => {
    fake = withFake();
    await createAgent(fake);
  });

  test("starting it prints the container id alone, and the helper then exists, running, beside the agent", async () => {
    assert.equal((await fake.run(["inspect", "gp-maple.updater"])).code, 1, "it exists only after this command");
    const result = await fake.run(startHelperArgs());
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^[0-9a-f]{64}\n$/);
    assert.equal(result.stderr, "", "the agent's image is there already: Create pulled it");
    const [view] = JSON.parse((await fake.run(["inspect", "gp-maple.updater"])).stdout);
    assert.deepEqual([view.Name, view.State.Running, view.Config.Image, view.Mounts], ["/gp-maple.updater", true, IMAGE, []]);
    assert.equal(view.HostConfig.RestartPolicy.Name, "unless-stopped");
    assert.equal(fake.state().containers["gp-maple.updater"].target, "gp-maple");
  });

  test("the updater command is a placeholder: any command words, with arguments of their own, before --target", async () => {
    for (const command of [["updater"], ["gp", "update-helper"], ["swap", "--interval", "5"]]) {
      const slug = `maple${command.length}`;
      await createAgent(fake, { slug });
      const result = await fake.run(startHelperArgs(slug, IMAGE, command));
      assert.equal(result.code, 0, `${command.join(" ")}: ${result.stderr}`);
    }
  });

  test("a second helper of the same name is docker's own conflict, exit 125", async () => {
    await fake.run(startHelperArgs());
    const again = await fake.run(startHelperArgs());
    assert.equal(again.code, 125);
    assert.match(again.stderr, /Conflict\. The container name "\/gp-maple.updater" is already in use/);
  });

  test("the helper does not hold the agent's data volume, so the volume can be removed once the agent's container is", async () => {
    await fake.run(startHelperArgs());
    await fake.run(["rm", "-f", "gp-maple"]);
    const result = await fake.run(["volume", "rm", "gp-maple-data"]);
    assert.equal(result.code, 0, result.stderr);
  });
});

describe("what is refused: exit 64, and the call log says refused", () => {
  const OWN = /runs the agent's own image and exact tag \(registry\.example\/ghost-protocol:0\.0\.0\)/;
  const refused = [
    ["a tag that is not the agent's", startHelperArgs("maple", "registry.example/ghost-protocol:0.0.1"), OWN],
    ["the agent's tag in another registry", startHelperArgs("maple", "other.example/ghost-protocol:0.0.0"), OWN],
    ["a separate updater image: there is none", startHelperArgs("maple", "registry.example/ghost-protocol-updater:0.0.0"), /is not <registry>\/ghost-protocol:<exact version>/],
    ["the tag latest", startHelperArgs("maple", "registry.example/ghost-protocol:latest"), /not latest/],
    ["no tag", startHelperArgs("maple", "registry.example/ghost-protocol"), /is not <registry>\/ghost-protocol:<exact version>/],
    ["no Docker socket mount", startHelperArgs().filter((arg, i, all) => arg !== "-v" && all[i - 1] !== "-v"), /-v \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/],
    ["the socket mounted somewhere else", startHelperArgs().map((arg) => (arg.startsWith("/var/run/docker.sock:") ? "/var/run/docker.sock:/docker.sock" : arg)), /-v \/var\/run\/docker\.sock/],
    ["the agent's data volume mounted as well", [...startHelperArgs().slice(0, 8), "-v", "gp-maple-data:/data", ...startHelperArgs().slice(8)], /nothing else mounted/],
    ["the socket mounted read-only", startHelperArgs().map((arg) => (arg.startsWith("/var/run/docker.sock:") ? `${arg}:ro` : arg)), /-v \/var\/run\/docker\.sock/],
    ["--rm", ["run", "--rm", ...startHelperArgs().slice(1)], /long-lived/],
    ["no restart policy", startHelperArgs().filter((arg, i, all) => arg !== "--restart" && all[i - 1] !== "--restart"), /--restart unless-stopped/],
    ["another restart policy", startHelperArgs().map((arg) => (arg === "unless-stopped" ? "always" : arg)), /--restart unless-stopped/],
    ["a target that is not the agent", startHelperArgs().map((arg) => (arg === "gp-maple" ? "gp-birch" : arg)), /arguments end with `--target gp-maple`/],
    ["no target", startHelperArgs().slice(0, -2), /arguments end with `--target gp-maple`/],
    ["more arguments after the target", [...startHelperArgs(), "--verbose"], /arguments end with `--target gp-maple`/],
    ["no command before the target", startHelperArgs("maple", IMAGE, []), /its command, then `--target gp-maple`/],
    ["a flag where the command should be", startHelperArgs("maple", IMAGE, ["--verbose"]), /its command, then `--target gp-maple`/],
    ["a name that is not gp-<slug>.updater", startHelperArgs().map((arg) => (arg === "gp-maple.updater" ? "gp-maple-updater" : arg)), /named gp-<slug>\.updater/],
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
      assert.equal(fake.state().containers["gp-maple.updater"], undefined, "nothing was started");
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
    assert.equal(fake.state().containers["gp-maple.updater"], undefined);
  });

  test("a gp command run in the helper: the interface runs none there", async () => {
    fake = withFake();
    await runningAgent(fake);
    const result = await fake.run(gp("maple.updater", "status", "--json"));
    assert.equal(result.code, 64);
    assert.match(result.stderr, /^fake-docker: gp-maple\.updater is the update helper/);
  });
});

describe("the helper's name can never be an agent's", () => {
  test("an agent called Maple Updater (slug maple-updater, container gp-maple-updater) and the helper of the agent maple (gp-maple.updater) live side by side", async () => {
    fake = withFake();
    await runningAgent(fake); // maple, with its helper
    await runningAgent(fake, { slug: "maple-updater", helper: false });
    assert.equal((await status(fake, "maple-updater")).state, "running");
    assert.ok(fake.state().containers["gp-maple-updater"] && fake.state().containers["gp-maple.updater"]);
    assert.equal(fake.state().containers["gp-maple-updater"].helper, undefined, "the agent is not taken for the helper");
    assertGpSuccess(await fake.run(gp("maple-updater", "claude", "status")));
    const refused = await fake.run(gp("maple.updater", "claude", "status"));
    assert.equal(refused.code, 64);
  });

  test("the helper of an agent called maple-updater is gp-maple-updater.updater", async () => {
    fake = withFake();
    await runningAgent(fake, { slug: "maple-updater" });
    assert.equal(fake.state().containers["gp-maple-updater.updater"].target, "gp-maple-updater");
  });

  test("it is told by its shape too: the socket mounted, or no data volume, is the helper's start whatever the name", async () => {
    fake = withFake();
    await createAgent(fake);
    for (const argv of [
      startHelperArgs().map((arg) => (arg === "gp-maple.updater" ? "gp-maple" : arg)), // the agent's own name, but a helper's mounts
      startHelperArgs().filter((arg, i, all) => arg !== "-v" && all[i - 1] !== "-v"), // no mounts at all
    ]) {
      const result = await fake.run(argv);
      assert.equal(result.code, 64, argv.join(" "));
      assert.match(result.stderr, /update helper/);
    }
  });
});

describe("Create pulls one image: the agent's", () => {
  beforeEach(() => {
    fake = withFake();
  });

  test("a pull of a second image, whatever it is called, is refused", async () => {
    await fake.run(pullArgs());
    for (const image of ["registry.example/ghost-protocol-updater:0.0.0", "registry.example/updater:0.0.0", "registry.example/ghost-protocol-helper:latest"]) {
      const result = await fake.run(pullArgs(image));
      assert.equal(result.code, 64, image);
      assert.match(result.stderr, /^fake-docker: /);
    }
  });

  test("the agent's image can still be pulled after a no", async () => {
    fake.use("no-self-update");
    assert.equal((await fake.run(pullArgs())).code, 0);
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
    await fake.run(["stop", "gp-maple.updater"]);
    assertGpFailure(await fake.run(gp("maple", "update", "request")), "no-updater");
    await fake.run(["restart", "gp-maple.updater"]);
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
    assert.equal(fake.state().containers["gp-maple.updater"], undefined);
  });
});
