// Section 10 of the interface note (restart, stop, remove, delete the data, as draft 0.1 of the interface has it), and `docker inspect`, which says
// whether a container that does not answer is stopped or gone (section 8).
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { assertGpSuccess } from "./contract.mjs";
import { gp, runningAgent, startArgs, status, statusArgs, withFake } from "./support.mjs";

let fake;
let agent;
beforeEach(async () => {
  fake = withFake();
  agent = await runningAgent(fake);
});
afterEach(() => fake.cleanup());

const inspect = async (name = "gp-maple") => JSON.parse((await fake.run(["inspect", name])).stdout)[0];

describe("inspect", () => {
  test("prints a JSON array with the container: its name, id, state and mounts", async () => {
    const [view] = JSON.parse((await fake.run(["inspect", "gp-maple"])).stdout);
    assert.equal(view.Name, "/gp-maple");
    assert.equal(view.Id, agent.id);
    assert.deepEqual([view.State.Status, view.State.Running], ["running", true]);
  });

  test("--format takes a field path, as docker does", async () => {
    assert.equal((await fake.run(["inspect", "--format", "{{.State.Status}}", "gp-maple"])).stdout, "running\n");
    assert.equal((await fake.run(["inspect", "-f", "{{.State.Running}}", "gp-maple"])).stdout, "true\n");
    assert.equal((await fake.run(["inspect", "-f", "{{json .State.Running}}", "gp-maple"])).stdout, "true\n");
  });

  test("a field that is not there is docker's template error, exit 1", async () => {
    const result = await fake.run(["inspect", "--format", "{{.Nope.Field}}", "gp-maple"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^template: :1:2: executing "" at <\.Nope\.Field>: can't evaluate field Field\n$/);
  });

  test("a container that is not there: [] on stdout, 'No such object' on stderr, exit 1", async () => {
    const result = await fake.run(["inspect", "gp-nobody"]);
    assert.deepEqual([result.code, result.stdout, result.stderr], [1, "[]\n", "Error: No such object: gp-nobody\n"]);
  });
});

describe("restart and stop", () => {
  test("`docker restart gp-<slug>` prints the name, and the agent connects again", async () => {
    const result = await fake.run(["restart", "gp-maple"]);
    assert.deepEqual([result.code, result.stdout], [0, "gp-maple\n"]);
    assert.deepEqual([(await status(fake)).state, (await status(fake)).state], ["connecting", "running"]);
  });

  test("`docker stop gp-<slug>` prints the name; the container is then exited, and exec says it is not running", async () => {
    const result = await fake.run(["stop", "gp-maple"]);
    assert.deepEqual([result.code, result.stdout], [0, "gp-maple\n"]);
    const view = await inspect();
    assert.deepEqual([view.State.Status, view.State.Running, view.State.ExitCode], ["exited", false, 0]);
    const exec = await fake.run(statusArgs());
    assert.equal(exec.code, 1);
    assert.equal(exec.stderr, `Error response from daemon: container ${agent.id} is not running\n`);
  });

  test("a stopped agent is started again by `docker restart`", async () => {
    await fake.run(["stop", "gp-maple"]);
    await fake.run(["restart", "gp-maple"]);
    assert.equal((await status(fake)).state, "connecting");
  });

  test("a container that is not there is docker's error, exit 1", async () => {
    for (const command of ["restart", "stop"]) {
      const result = await fake.run([command, "gp-nobody"]);
      assert.deepEqual([result.code, result.stdout, result.stderr], [1, "", "Error response from daemon: No such container: gp-nobody\n"]);
    }
  });
});

describe("remove", () => {
  test("`docker rm -f` of a container that is not there prints docker's error and exits 0, as docker 29 does; without -f it exits 1", async () => {
    const forced = await fake.run(["rm", "-f", "gp-nobody", "gp-nobody2"]);
    assert.deepEqual([forced.code, forced.stdout], [0, ""]);
    assert.equal(forced.stderr, "Error response from daemon: No such container: gp-nobody\nError response from daemon: No such container: gp-nobody2\n");
    const plain = await fake.run(["rm", "gp-nobody"]);
    assert.deepEqual([plain.code, plain.stderr], [1, "Error response from daemon: No such container: gp-nobody\n"]);
  });

  test("`docker rm -f gp-<slug>` prints the name; the container is gone and the data volume stays", async () => {
    const result = await fake.run(["rm", "-f", "gp-maple"]);
    assert.deepEqual([result.code, result.stdout], [0, "gp-maple\n"]);
    const exec = await fake.run(statusArgs());
    assert.deepEqual([exec.code, exec.stderr], [1, "Error response from daemon: No such container: gp-maple\n"]);
    assert.ok(fake.state().volumes["gp-maple-data"], "the data volume holds the key and the memory");
  });

  test("a running container is not removed without -f, as docker has it", async () => {
    const result = await fake.run(["rm", "gp-maple"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /cannot remove container "\/gp-maple": container is running: stop the container before removing or force remove/);
    await fake.run(["stop", "gp-maple"]);
    assert.equal((await fake.run(["rm", "gp-maple"])).code, 0);
  });

  test("the agent can be started again on its volume: same key, and it is still signed in and attested", async () => {
    await fake.run(["rm", "-f", "gp-maple"]);
    const again = await fake.run(startArgs());
    assert.equal(again.code, 0);
    assert.notEqual(again.stdout.trim(), agent.id, "a new container, a new id");
    const seen = [await status(fake), await status(fake)];
    assert.deepEqual(seen.map((s) => s.state), ["connecting", "running"]);
    assert.equal(seen[0].agent_pubkey, agent.pubkey);
  });
});

describe("delete the agent's data: `docker rm -f gp-<slug> gp-<slug>.updater`, then `docker volume rm gp-<slug>-data`", () => {
  const remove = ["rm", "-f", "gp-maple", "gp-maple.updater"];

  test("the user said yes to self-update and the plugin started the helper: both are removed, exit 0", async () => {
    const [view] = JSON.parse((await fake.run(["inspect", "gp-maple.updater"])).stdout);
    assert.deepEqual([view.Name, view.State.Running, view.Mounts], ["/gp-maple.updater", true, []]);
    const result = await fake.run(remove);
    assert.deepEqual([result.code, result.stdout, result.stderr], [0, "gp-maple\ngp-maple.updater\n", ""]);
  });

  test("the user said no: there is no helper, so the first is removed and the second is docker's 'No such container' on stderr, exit 0 with -f", async () => {
    const other = withFake("no-self-update");
    try {
      await runningAgent(other, { helper: false });
      assert.equal(other.state().containers["gp-maple.updater"], undefined);
      const result = await other.run(remove);
      assert.equal(result.code, 0, "docker 29: with -f, a container that is not there is an error line and not a failure");
      assert.equal(result.stdout, "gp-maple\n");
      assert.equal(result.stderr, "Error response from daemon: No such container: gp-maple.updater\n");
      assert.equal(other.state().containers["gp-maple"], undefined, "the agent's container is removed all the same");
    } finally {
      other.cleanup();
    }
  });

  test("the helper stays up through an update, and through the agent's container being removed and started again", async () => {
    fake.use({ update: { available: true, version: "0.1.1" } });
    await fake.run(gp("maple", "update", "request"));
    for (let i = 0; i < 4; i++) await status(fake);
    const running = async () => JSON.parse((await fake.run(["inspect", "-f", "{{.State.Running}}", "gp-maple.updater"])).stdout);
    assert.equal(await running(), true);
    const before = fake.state().containers["gp-maple.updater"].id;
    await fake.run(["rm", "-f", "gp-maple"]);
    await fake.run(startArgs());
    assert.equal(fake.state().containers["gp-maple.updater"].id, before, "one helper, not two");
    assert.equal(await running(), true);
  });

  test("the volume is removed after that: `docker volume rm` prints its name", async () => {
    await fake.run(remove);
    const result = await fake.run(["volume", "rm", "gp-maple-data"]);
    assert.deepEqual([result.code, result.stdout], [0, "gp-maple-data\n"]);
    assert.equal(fake.state().volumes["gp-maple-data"], undefined);
  });

  test("a volume that a container still uses is not removed: docker's 'volume is in use'", async () => {
    const result = await fake.run(["volume", "rm", "gp-maple-data"]);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, `Error response from daemon: remove gp-maple-data: volume is in use - [${agent.id}]\n`);
  });

  test("a volume that is not there is docker's 'no such volume'", async () => {
    const result = await fake.run(["volume", "rm", "gp-nobody-data"]);
    assert.deepEqual([result.code, result.stderr], [1, "Error response from daemon: get gp-nobody-data: no such volume\n"]);
  });

  test("a new agent of the same name gets a new key", async () => {
    await fake.run(remove);
    await fake.run(["volume", "rm", "gp-maple-data"]);
    const fresh = await runningAgent(fake);
    assert.notEqual(fresh.pubkey, agent.pubkey);
  });
});

describe("the helper container is not an agent", () => {
  test("the interface runs no gp command in it: the fake refuses, and the agent's own commands are unaffected", async () => {
    const result = await fake.run(gp("maple.updater", "status", "--json"));
    assert.equal(result.code, 64);
    assert.match(result.stderr, /^fake-docker: gp-maple\.updater is the update helper/);
    assertGpSuccess(await fake.run(gp("maple", "claude", "status")));
  });

  test("restart and stop work on it as on any container, and the agent is not touched", async () => {
    assert.equal((await fake.run(["stop", "gp-maple.updater"])).stdout, "gp-maple.updater\n");
    assert.equal(JSON.parse((await fake.run(["inspect", "gp-maple.updater"])).stdout)[0].State.Status, "exited");
    assert.equal(JSON.parse((await fake.run(["inspect", "gp-maple"])).stdout)[0].State.Status, "running");
    await fake.run(["restart", "gp-maple.updater"]);
    assert.equal(JSON.parse((await fake.run(["inspect", "gp-maple.updater"])).stdout)[0].State.Status, "running");
  });
});
