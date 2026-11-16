// How a test chooses a scenario without editing the fake, what the fake records, that it keeps a Claude token (and a login code) out of
// every file and every line it prints, that commands that run side by side do not corrupt its state, and that it needs nothing but node.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertStatusShape, parseGp } from "./contract.mjs";
import { BIN_DIR, PRESET_NAMES, attestationTag, createFakeDocker } from "./index.mjs";
import { OWNER, attest, createAgent, gp, gpInput, initArgs, runningAgent, status, statusArgs, versionArgs, withFake } from "./support.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let fake;
afterEach(() => fake?.cleanup());

describe("choosing a scenario", () => {
  test("a preset name in FAKE_DOCKER_SCENARIO, with nothing else", async () => {
    fake = withFake();
    const result = await fake.run(versionArgs, { env: { ...fake.env(), FAKE_DOCKER_SCENARIO: "daemon-down" } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Cannot connect to the Docker daemon/);
  });

  test("several presets joined with commas, and JSON, in the same variable", async () => {
    fake = withFake();
    const twoPresets = await fake.run(statusArgs(), { env: { ...fake.env(), FAKE_DOCKER_SCENARIO: "status-compact-with-preamble,relay-refuses" } });
    assert.match(twoPresets.stderr, /No such container/); // there is no agent yet: the variable was read all the same, and it was valid
    const json = await fake.run(versionArgs, { env: { ...fake.env(), FAKE_DOCKER_SCENARIO: '{"dockerVersion":"25.0.0"}' } });
    assert.equal(json.stdout, "25.0.0\n");
  });

  test("scenario.json in the state folder wins over the variable, and is read again at every command", async () => {
    fake = withFake();
    const env = { ...fake.env(), FAKE_DOCKER_SCENARIO: "daemon-down" };
    assert.equal((await fake.run(versionArgs, { env })).code, 1);
    fake.use({ docker: "ok" });
    assert.equal((await fake.run(versionArgs, { env })).code, 0);
  });

  test("`use` replaces the scenario and `tweak` changes some keys of it", async () => {
    fake = withFake({ dockerVersion: "1.0.0", connectingPolls: 5 });
    fake.tweak({ dockerVersion: "2.0.0" });
    assert.equal((await fake.run(versionArgs)).stdout, "2.0.0\n");
    assert.equal(JSON.parse(readFileSync(join(fake.stateDir, "scenario.json"), "utf8")).connectingPolls, 5);
    fake.use({});
    assert.equal((await fake.run(versionArgs)).stdout, "27.3.1\n");
  });

  test("a preset or a key the fake does not know is an error in the test, at once, and the old scenario stays", () => {
    fake = withFake({ dockerVersion: "3.0.0" });
    assert.throws(() => fake.use("no-such-preset"), /no scenario preset called "no-such-preset"/);
    assert.throws(() => fake.use({ dockerVersoin: "x" }), /a key the fake does not know: "dockerVersoin"/);
  });

  test("the same mistake made straight in the environment is a refusal: exit 64, and the message names it", async () => {
    fake = withFake();
    const result = await fake.run(versionArgs, { env: { ...fake.env(), FAKE_DOCKER_SCENARIO: "typo" } });
    assert.equal(result.code, 64);
    assert.match(result.stderr, /^fake-docker: no scenario preset called "typo"/);
  });

  test("without FAKE_DOCKER_STATE the fake does not guess a folder", async () => {
    fake = withFake();
    const { FAKE_DOCKER_STATE: _, ...env } = fake.env();
    const result = await fake.run(versionArgs, { env });
    assert.equal(result.code, 64);
    assert.match(result.stderr, /FAKE_DOCKER_STATE is not set/);
  });

  test("every preset is valid and answers", async () => {
    for (const preset of PRESET_NAMES) {
      const one = createFakeDocker({ scenario: preset });
      try {
        const result = await one.run(versionArgs);
        assert.ok([0, 1, 127].includes(result.code), `${preset}: exit ${result.code}`);
      } finally {
        one.cleanup();
      }
    }
  });

  test("logLines: false leaves the lines for people out, and the GP_ lines stay", async () => {
    fake = withFake({ logLines: false });
    const out = parseGp((await fake.run(initArgs())).stdout);
    assert.deepEqual(out.order, ["INTERFACE", "VERSION", "AGENT_PUBKEY"]);
    assert.deepEqual(out.log, []);
  });
});

describe("the call log", () => {
  test("every command, in order, with its exit code and a digest of what it read on stdin", async () => {
    fake = withFake();
    await createAgent(fake);
    const tag = `${attestationTag(OWNER)}\n`;
    await fake.run(gpInput("maple", "auth-tag", "set"), { input: tag });
    const calls = fake.calls();
    assert.deepEqual(calls.map((call) => call.n), calls.map((_, i) => i + 1));
    assert.deepEqual(calls.map((call) => call.argv[0]), ["pull", "run", "run", "exec"]);
    assert.ok(calls.every((call) => call.exit === 0));
    const attestation = calls.at(-1);
    assert.equal(attestation.stdin.sha256, createHash("sha256").update(tag.trimEnd()).digest("hex"));
    assert.equal(attestation.stdin.bytes, Buffer.byteLength(tag.trimEnd()));
  });

  test("the plugin's commands as the note gives them are never refused", async () => {
    fake = withFake("claude-signed-in");
    await runningAgent(fake);
    await fake.run(["stop", "gp-maple"]);
    await fake.run(["restart", "gp-maple"]);
    await fake.run(["inspect", "gp-maple"]);
    await fake.run(["rm", "-f", "gp-maple", "gp-maple-updater"]);
    await fake.run(["volume", "rm", "gp-maple-data"]);
    assert.deepEqual(fake.calls().filter((call) => call.refused), []);
  });
});

describe("a Claude token and a login code never leave the fake", () => {
  const TOKEN = "sk-made-up-token-4b1f7c2e9a0d-ZZZ";
  const CODE = "made-up-login-code-7d3e-QQQ";

  const filesUnder = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]));

  test("not on stdout or stderr, not in state.json, calls.jsonl or scenario.json, on success or on failure", async () => {
    fake = withFake();
    await createAgent(fake);
    await attest(fake);
    const seen = [];
    const keep = (result) => seen.push(result.stdout, result.stderr);
    keep(await fake.run(gpInput("maple", "claude", "token"), { input: `${TOKEN}\n` }));
    keep(await fake.run(gpInput("maple", "claude", "login"), { input: `${CODE}\n` }));
    fake.use({ fail: { claudeToken: true, claudeLogin: true } });
    keep(await fake.run(gpInput("maple", "claude", "token"), { input: `${TOKEN}\n` }));
    keep(await fake.run(gpInput("maple", "claude", "login"), { input: `${CODE}\n` }));
    fake.use({});
    keep(await fake.run(gpInput("maple", "claude", "token"), { input: `${TOKEN} extra words\n` })); // invalid: the message must not repeat it
    for (const text of seen) {
      assert.ok(!text.includes(TOKEN) && !text.includes(CODE), "a secret was printed");
    }
    for (const file of filesUnder(fake.stateDir)) {
      const text = readFileSync(file, "utf8");
      assert.ok(!text.includes(TOKEN) && !text.includes(CODE), `a secret was written to ${file}`);
    }
    const reads = fake.calls().filter((call) => call.argv.includes("token") || call.argv.includes("login"));
    assert.equal(reads.length, 5);
    assert.ok(reads.every((call) => !("tag" in call) && /^[0-9a-f]{64}$/.test(call.stdin.sha256)), "only a digest is kept");
    assert.equal(reads[0].stdin.sha256, createHash("sha256").update(TOKEN).digest("hex"), "and a test can still tell what was sent");
  });
});

describe("seeding an agent in a condition, without running its commands", () => {
  for (const [condition, expected] of [["needs-auth-tag", "needs-auth-tag"], ["needs-claude", "needs-claude"], ["running", "running"]]) {
    test(condition, async () => {
      fake = withFake();
      const seeded = fake.seed({ condition });
      const current = await status(fake);
      assert.equal(current.state, expected);
      assert.equal(current.agent_pubkey, seeded.pubkey);
      assertStatusShape(current);
    });
  }

  test("the update helper is seeded with the agent when the scenario's selfUpdate is yes, or `updater: true`; not with `updater: false` or no container", async () => {
    fake = withFake();
    assert.ok(fake.seed({ slug: "maple" }) && fake.state().containers["gp-maple-updater"].running);
    fake.seed({ slug: "birch", updater: false });
    assert.equal(fake.state().containers["gp-birch-updater"], undefined);
    fake.seed({ slug: "oak", container: false });
    assert.equal(fake.state().containers["gp-oak-updater"], undefined);
    fake.use("no-self-update");
    fake.seed({ slug: "elm" });
    assert.equal(fake.state().containers["gp-elm-updater"], undefined);
    fake.seed({ slug: "ash", updater: true });
    assert.equal(fake.state().containers["gp-ash-updater"].target, "gp-ash");
  });

  test("stopped: exec fails, inspect says exited; a version, a previous version and a name can be given", async () => {
    fake = withFake();
    fake.seed({ condition: "stopped", slug: "birch", version: "1.2.3", name: "Birch" });
    assert.equal((await fake.run(gp("birch", "status", "--json"))).code, 1);
    const [view] = JSON.parse((await fake.run(["inspect", "gp-birch"])).stdout);
    assert.equal(view.State.Status, "exited");
    const running = fake.seed({ slug: "oak", version: "2.0.0", previousVersion: "1.9.0" });
    assert.equal(running.container, "gp-oak");
    const current = await status(fake, "oak");
    assert.deepEqual([current.version, current.previous_version], ["2.0.0", "1.9.0"]);
  });
});

describe("commands that run side by side", () => {
  test("many status polls and a restart at once: every one answers, the state file is whole, and the call numbers are unique", async () => {
    fake = withFake();
    await runningAgent(fake);
    const before = fake.calls().length;
    const runs = [];
    for (let i = 0; i < 16; i++) runs.push(fake.run(statusArgs()), fake.run(["inspect", "gp-maple"]));
    runs.push(fake.run(["restart", "gp-maple"]));
    const results = await Promise.all(runs);
    assert.ok(results.every((result) => result.code === 0), results.map((result) => result.stderr).join(""));
    for (const result of results.slice(0, 32).filter((_, i) => i % 2 === 0)) assertStatusShape(JSON.parse(result.stdout));
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(fake.stateDir, "state.json"), "utf8")));
    const numbers = fake.calls().map((call) => call.n);
    assert.equal(new Set(numbers).size, numbers.length);
    assert.equal(numbers.length, before + 33);
    assert.ok(fake.calls().every((call) => "exit" in call));
  });
});

describe("what the fake needs", () => {
  test("bin/docker is executable and starts with an env-node shebang", () => {
    const file = join(BIN_DIR, "docker");
    assert.ok(statSync(file).mode & 0o111, "bin/docker is not executable (git must keep mode 100755)");
    assert.equal(readFileSync(file, "utf8").split("\n")[0], "#!/usr/bin/env node");
  });

  test("it imports nothing but node: modules and its own files", () => {
    for (const name of ["fake-docker.mjs", "scenario.mjs", "store.mjs", "index.mjs", "contract.mjs"]) {
      for (const [, specifier] of readFileSync(join(HERE, name), "utf8").matchAll(/^import .* from "([^"]+)";$/gm)) {
        assert.ok(specifier.startsWith("node:") || specifier.startsWith("./"), `${name} imports ${specifier}`);
      }
    }
  });

  test("it runs with the bare environment a plugin's process gets, from any folder, and whatever the nearest package.json says", async () => {
    for (const type of ["commonjs", "module", null]) {
      const root = mkdtempSync(join(tmpdir(), "fake-docker-copy-"));
      try {
        cpSync(HERE, join(root, "pkg", "fake-docker"), { recursive: true, filter: (source) => !source.endsWith(".test.mjs") });
        if (type) writeFileSync(join(root, "pkg", "package.json"), JSON.stringify({ type }));
        const state = join(root, "state");
        mkdirSync(state);
        const { spawnSync } = await import("node:child_process");
        const ran = spawnSync(join(root, "pkg", "fake-docker", "bin", "docker"), versionArgs, {
          cwd: root,
          env: { PATH: process.env.PATH, FAKE_DOCKER_STATE: state },
          encoding: "utf8",
        });
        assert.deepEqual([ran.status, ran.stdout, ran.stderr], [0, "27.3.1\n", ""], `type ${type}: ${ran.stderr}`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("two fakes in two state folders do not see each other", async () => {
    fake = withFake();
    const other = withFake();
    try {
      fake.seed({ condition: "running" });
      assert.equal((await status(fake)).state, "running");
      assert.equal((await other.run(statusArgs())).code, 1);
    } finally {
      other.cleanup();
    }
  });
});
