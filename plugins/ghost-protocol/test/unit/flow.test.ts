import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE, WORDS } from "../../src/gp/constants";
import { activate, CreateError, provision, remove, type ActivateInput } from "../../src/gp/flow";
import { commands } from "../../src/gp/commands";
import { lineOf } from "../../src/gp/processes";
import type { StepId } from "../../src/gp/progress";
import { authOf, OWNER, RELAY, rig, SIGNAL, TOKEN, type Rig } from "./support";

// The create flow against the fake docker (test/fake-docker): the real `bin/docker` runs once for each command the flow sends, so a
// command, a flag or a name the interface does not list is refused and the test fails.

const rigs: Rig[] = [];
const make = (scenario?: Parameters<typeof rig>[0]) => {
  const made = rig(scenario);
  rigs.push(made);
  return made;
};
afterEach(() => {
  for (const made of rigs.splice(0)) made.cleanup();
  vi.restoreAllMocks();
});

const NAME = "Maple";
const create = (r: Rig, over: Partial<ActivateInput> = {}) => ({
  provision: () => provision(r.deps, { name: NAME, community: RELAY, owner: OWNER, selfUpdate: over.selfUpdate ?? true, signal: SIGNAL }),
  activate: (pubkey: string) =>
    activate(r.deps, { name: NAME, pubkey, auth: authOf(), selfUpdate: true, claudeWay: "token", signal: SIGNAL, ...over }),
});

/** The commands the fake was run with, as the flow sends them: the first words, and a refused one is a failure. */
const words = (r: Rig, count = 4) => r.fake.calls().map((call) => call.argv.slice(0, count).join(" "));
const states = (r: Rig): Record<StepId, string> =>
  Object.fromEntries(r.progress.view().steps.map((step) => [step.id, step.state])) as Record<StepId, string>;

/** Everything the plugin and the fake wrote that a secret must stay out of. */
const everywhere = (r: Rig, thrown?: unknown) =>
  JSON.stringify([r.fake.calls(), r.progress.view(), thrown instanceof Error ? thrown.message : String(thrown ?? ""), r.fake.state()]);

describe("the whole flow", () => {
  it("makes a running agent, with Claude by token and a yes to self-update, in the order the interface gives", async () => {
    const r = make();
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    const { slug, pubkey } = await flow.provision();
    expect(slug).toBe("maple");
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
    const status = await flow.activate(pubkey);
    expect(status).toMatchObject({ state: "running", claude: "active", relay: "connected", agentPubkey: pubkey });
    expect(words(r, 3)).toEqual([
      "version --format {{.Server.Version}}",
      `pull ${IMAGE}`,
      "inspect --format {{.State.Status}}",
      "run --rm -v",
      "inspect --format {{.State.Status}}",
      "run -d --restart",
      "inspect --format {{.State.Status}}",
      "run -d --restart",
      "exec -i gp-maple",
      "exec gp-maple gp",
      "exec -i gp-maple",
      "exec gp-maple gp",
      "exec gp-maple gp",
    ]);
    expect(states(r)).toEqual({ docker: "done", pull: "done", init: "done", start: "done", updater: "done", tag: "done", claude: "done", wait: "done" });
    // The container, its helper and the data volume are there, and the attestation reached the agent as Buzz signed it.
    const docker = r.fake.state();
    expect(Object.keys(docker.containers).sort()).toEqual(["gp-maple", "gp-maple.updater"]);
    expect(r.fake.calls().find((call) => call.tag)?.tag).toBe(JSON.stringify(authOf()));
  });

  it("starts the update helper with the agent's own image and tag only after a yes", async () => {
    const yes = make();
    yes.secrets.setToken(TOKEN);
    const a = create(yes);
    await a.activate((await a.provision()).pubkey);
    const helper = yes.fake.calls().find((call) => call.argv.includes("gp-maple.updater") && call.argv.includes("run"));
    expect(helper?.argv).toEqual(["run", "-d", "--restart", "unless-stopped", "-v", "/var/run/docker.sock:/var/run/docker.sock", "--name", "gp-maple.updater", IMAGE, "<not logged>", "--target", "gp-maple"]);
    expect(states(yes).updater).toBe("done");

    const no = make("no-self-update");
    no.secrets.setToken(TOKEN);
    const b = create(no, { selfUpdate: false });
    await b.activate((await b.provision()).pubkey);
    expect(no.fake.calls().some((call) => call.argv.some((word) => word.includes("updater") || word.includes("docker.sock")))).toBe(false);
    expect(Object.keys(no.fake.state().containers)).toEqual(["gp-maple"]);
    expect(states(no).updater).toBe("skipped");
  });

  it("leaves the sign-in by address for the agent's panel, and stops where the agent waits for Claude", async () => {
    const r = make();
    r.secrets.setToken(TOKEN);
    const flow = create(r, { claudeWay: "login" });
    const status = await flow.activate((await flow.provision()).pubkey);
    // Buzz's Create dialog cannot ask the person for a code while it runs, so nothing here runs `gp claude login`.
    expect(status.state).toBe("needs-claude");
    expect(r.fake.calls().some((call) => call.argv.includes("login") || call.argv.includes("token"))).toBe(false);
    expect(states(r)).toMatchObject({ tag: "done", claude: "skipped", wait: "done" });
    expect(r.progress.view().steps.find((step) => step.id === "claude")?.note).toBe("Sign in from the agent's panel");
    // A token typed for the other way is not kept.
    expect(r.secrets.token()).toBe("");
  });

  it("skips the Claude step when the agent is already signed in, and forgets a token it was given", async () => {
    const r = make("claude-signed-in");
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    await flow.activate((await flow.provision()).pubkey);
    expect(r.fake.calls().some((call) => call.argv.includes("token"))).toBe(false);
    expect(r.secrets.token()).toBe("");
    expect(r.progress.view().steps.find((step) => step.id === "claude")?.note).toBe("Already signed in");
  });

  it("is hosted nowhere: it only ever runs `docker` and nothing else", async () => {
    const r = make();
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    await flow.activate((await flow.provision()).pubkey);
    expect(r.fake.calls().filter((call) => call.refused)).toEqual([]);
  });
});

describe("a secret stays where it was put", () => {
  it("never reaches an argument, the call log, the progress, a message or the docker state, whichever way leads", async () => {
    for (const way of ["token", "login"] as const) {
      const r = make();
      r.secrets.setToken(TOKEN);
      const flow = create(r, { claudeWay: way });
      await flow.activate((await flow.provision()).pubkey);
      expect(everywhere(r), way).not.toContain(TOKEN);
      expect(r.secrets.token(), way).toBe("");
    }
  });

  it("is forgotten when the agent refuses it, and the message does not repeat it", async () => {
    const r = make("token-rejected");
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    const { pubkey } = await flow.provision();
    const error = await flow.activate(pubkey).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(CreateError);
    expect((error as Error).message).toMatch(/Claude did not accept that token/);
    expect(r.secrets.token()).toBe("");
    expect(everywhere(r, error)).not.toContain(TOKEN);
    expect(states(r).claude).toBe("failed");
  });

  it("is forgotten when the command could not run at all", async () => {
    const r = make();
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    const { pubkey } = await flow.provision();
    const real = r.deps.start;
    const deps = { ...r.deps, start: ((command, handlers) => (command.args.includes("token") ? Promise.reject(new Error("spawn docker ENOENT")) : real(command, handlers))) as typeof real };
    const error = await activate(deps, { name: NAME, pubkey, auth: authOf(), selfUpdate: true, claudeWay: "token", signal: SIGNAL }).catch((reason: unknown) => reason);
    expect((error as Error).message).toBe(WORDS.docker);
    expect(r.secrets.token()).toBe("");
  });

  it("refuses a token with a space in it before it reaches the agent", async () => {
    for (const token of ["two words", "a\nb"]) {
      const r = make();
      r.secrets.setToken(token);
      const flow = create(r);
      const { pubkey } = await flow.provision();
      const error = await flow.activate(pubkey).catch((reason: unknown) => reason);
      expect((error as Error).message).toMatch(/not a Claude setup token/);
      expect(r.fake.calls().some((call) => call.argv.includes("token"))).toBe(false);
      expect(r.secrets.token()).toBe("");
    }
  });

  it("leaves the sign-in for the agent's tab when no token is held, as when Buzz's Finish setup runs the step again with no form", async () => {
    const r = make("bad-auth-tag");
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    const { pubkey } = await flow.provision();
    // The first try fails at the attestation, and the dialog is closed: the token held in memory is gone.
    await flow.activate(pubkey).catch(() => undefined);
    r.secrets.clear();
    r.fake.use("ok");
    // Finish setup: the same saved settings (the token's way), no token.
    const status = await flow.activate(pubkey);
    expect(status.state).toBe("needs-claude");
    expect(states(r)).toMatchObject({ tag: "done", claude: "skipped", wait: "done" });
    expect(r.progress.view().steps.find((step) => step.id === "claude")?.note).toBe("Sign in from the agent's panel");
    expect(r.fake.calls().some((call) => call.argv.includes("token") || call.argv.includes("login"))).toBe(false);
    expect(Object.keys(r.fake.state().containers).sort()).toEqual(["gp-maple", "gp-maple.updater"]);
  });
});

describe("every step can fail, and says so in one line", () => {
  const failing: Array<[string, Parameters<typeof rig>[0], StepId, RegExp]> = [
    ["docker is not installed", "docker-missing", "docker", /^Docker didn't answer\. Install or start Docker Desktop, then retry\.$/],
    ["the daemon is not running", "daemon-down", "docker", /^Docker didn't answer\. Install or start Docker Desktop, then retry\.$/],
    ["docker may not be used", "permission-denied", "docker", /^Docker didn't answer\. Install or start Docker Desktop, then retry\.$/],
    ["the image is not found", "pull-not-found", "pull", /^Docker could not download GHOST Protocol: /],
    ["the registry refuses the pull", "pull-unauthorized", "pull", /^Docker could not download GHOST Protocol: /],
    ["the pull has no network", "pull-offline", "pull", /^Docker could not download GHOST Protocol: /],
    ["init fails", "init-fails", "init", /^GHOST Protocol could not set up the agent/],
  ];
  for (const [title, scenario, step, message] of failing) {
    it(`${title}: the ${step} step ends it, and nothing after it runs`, async () => {
      const r = make(scenario);
      const error = await create(r).provision().catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(CreateError);
      expect((error as Error).message).toMatch(message);
      expect(states(r)[step]).toBe("failed");
      expect(r.progress.view().failure).toBe((error as Error).message);
      expect(r.fake.calls().some((call) => call.argv[0] === "run" && call.argv.includes("-d"))).toBe(false);
    });
  }

  it("a program that cannot start says Install or start Docker Desktop", async () => {
    const r = make();
    const deps = { ...r.deps, checkDocker: async () => ({ state: "unavailable" as const }) };
    const error = await provision(deps, { name: NAME, community: RELAY, owner: OWNER, selfUpdate: true, signal: SIGNAL }).catch((reason: unknown) => reason);
    expect((error as Error).message).toBe(WORDS.docker);
    expect(states(r).docker).toBe("failed");
  });

  it("a Buzz that cannot start a program says so, and runs nothing", async () => {
    const r = make();
    const deps = { ...r.deps, checkDocker: async () => ({ state: "unsupported" as const }) };
    const error = await provision(deps, { name: NAME, community: RELAY, owner: OWNER, selfUpdate: true, signal: SIGNAL }).catch((reason: unknown) => reason);
    expect((error as Error).message).toBe("This Buzz cannot start programs. Use the Buzz desktop app.");
    expect(r.fake.calls()).toEqual([]);
  });

  it("stops when the caller goes away during the check of Docker", async () => {
    const r = make();
    const deps = { ...r.deps, checkDocker: async () => undefined };
    const error = await provision(deps, { name: NAME, community: RELAY, owner: OWNER, selfUpdate: true, signal: SIGNAL }).catch((reason: unknown) => reason);
    expect((error as Error).message).toBe("Stopped.");
  });

  it("a Docker that answers with something that is not a version is not ready", async () => {
    const r = make({ dockerVersion: "<no value>" });
    const error = await create(r).provision().catch((reason: unknown) => reason);
    expect((error as Error).message).toBe(WORDS.docker);
  });

  it("a rejected attestation ends at the attestation, with the agent already started", async () => {
    const r = make("bad-auth-tag");
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    const { pubkey } = await flow.provision();
    const error = await flow.activate(pubkey).catch((reason: unknown) => reason);
    expect((error as Error).message).toMatch(/did not accept your attestation \(bad-auth-tag\)/);
    expect(states(r)).toMatchObject({ start: "done", updater: "done", tag: "failed", claude: "waiting" });
    expect(r.secrets.token()).toBe(TOKEN);
  });

  it("a malformed attestation from Buzz never reaches the agent", async () => {
    const r = make();
    const { pubkey } = await create(r).provision();
    const error = await create(r, { auth: ["auth", OWNER, ""] }).activate(pubkey).catch((reason: unknown) => reason);
    expect((error as Error).message).toMatch(/well-formed attestation/);
    expect(r.fake.calls().some((call) => call.argv.includes("auth-tag"))).toBe(false);
  });

  it("a relay that refuses the agent shows the note and the agent's public key", async () => {
    const r = make("relay-refuses");
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    const { pubkey } = await flow.provision();
    const error = await flow.activate(pubkey).catch((reason: unknown) => reason);
    expect((error as Error).message).toBe(`${WORDS.refused} The agent's public key is ${pubkey}.`);
    expect(r.progress.view().refused).toEqual({ pubkey });
    expect(states(r).wait).toBe("failed");
  });

  it("an agent that never reaches its relay ends when the time is up", async () => {
    const r = make("relay-unreachable");
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    const { pubkey } = await flow.provision();
    r.fake.tweak({ connectingPolls: 1000 });
    const error = await flow.activate(pubkey).catch((reason: unknown) => reason);
    expect((error as Error).message).toMatch(/could not reach your relay \(wss:\/\/relay\.example\.com\)\. Press Create to try again\.$/);
    expect(r.slept.length).toBeGreaterThan(10);
  });

  it("an agent that reports an error ends there with its message", async () => {
    const r = make("status-error");
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    const { pubkey } = await flow.provision();
    const error = await flow.activate(pubkey).catch((reason: unknown) => reason);
    expect((error as Error).message).toMatch(/^GHOST Protocol reports an error: /);
  });

  it("an interface number it does not know stops it at once, at init or later", async () => {
    const early = make("unknown-interface");
    expect(((await create(early).provision().catch((reason: unknown) => reason)) as Error).message).toBe(WORDS.unknownInterface);
    expect(early.fake.calls().some((call) => call.argv.includes("auth-tag"))).toBe(false);

    const late = make();
    late.secrets.setToken(TOKEN);
    const flow = create(late);
    const { pubkey } = await flow.provision();
    late.fake.use("unknown-interface");
    expect(((await flow.activate(pubkey).catch((reason: unknown) => reason)) as Error).message).toBe(WORDS.unknownInterface);
  });

  it("a status of another agent in the container is not accepted", async () => {
    const r = make({ statusOverride: { agent_pubkey: "a".repeat(64) } });
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    const { pubkey } = await flow.provision();
    const error = await flow.activate(pubkey).catch((reason: unknown) => reason);
    expect((error as Error).message).toMatch(/belongs to another agent/);
  });

  it("a name with no letter or digit docker accepts is refused before any command", async () => {
    const r = make();
    const error = await provision(r.deps, { name: "木 ✨", community: RELAY, owner: OWNER, selfUpdate: true, signal: SIGNAL }).catch((reason: unknown) => reason);
    expect((error as Error).message).toMatch(/at least one letter or number/);
    expect(r.fake.calls()).toEqual([]);
  });

  it("an owner that is not a public key is refused before any command", async () => {
    const r = make();
    const error = await provision(r.deps, { name: NAME, community: RELAY, owner: "npub1abc", selfUpdate: true, signal: SIGNAL }).catch((reason: unknown) => reason);
    expect((error as Error).message).toMatch(/Sign in to Buzz/);
    expect(r.fake.calls()).toEqual([]);
  });

  it("a container of the same name is left alone and named, not set up again", async () => {
    const r = make();
    r.fake.seed({ condition: "running", slug: "maple", name: "Maple" });
    const error = await create(r).provision().catch((reason: unknown) => reason);
    expect((error as Error).message).toMatch(/"gp-maple" is already on this computer.*docker rm -f gp-maple/);
    expect(r.fake.calls().some((call) => call.argv[0] === "run")).toBe(false);
  });
});

describe("a repeat is safe", () => {
  it("activating again after a failure starts nothing twice", async () => {
    const r = make("bad-auth-tag");
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    const { pubkey } = await flow.provision();
    await flow.activate(pubkey).catch(() => undefined);
    r.fake.use("ok");
    r.secrets.setToken(TOKEN);
    const status = await flow.activate(pubkey);
    expect(status.state).toBe("running");
    const starts = r.fake.calls().filter((call) => call.argv[0] === "run" && call.argv.includes("-d"));
    expect(starts).toHaveLength(2); // the agent and its helper, once each
    expect(states(r)).toMatchObject({ start: "done", tag: "done", claude: "done", wait: "done" });
  });

  it("starts a stopped container again instead of making a second one", async () => {
    const r = make();
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    const { pubkey } = await flow.provision();
    await flow.activate(pubkey);
    r.fake.patchState((state) => {
      for (const container of Object.values(state.containers) as Array<{ running: boolean }>) container.running = false;
    });
    r.secrets.setToken(TOKEN);
    await flow.activate(pubkey);
    const calls = r.fake.calls();
    expect(calls.filter((call) => call.argv[0] === "restart").map((call) => call.argv[1])).toEqual(["gp-maple", "gp-maple.updater"]);
    expect(calls.filter((call) => call.argv[0] === "run" && call.argv.includes("-d"))).toHaveLength(2);
  });

  it("provisioning again on the same data keeps the same key", async () => {
    const r = make();
    const first = await create(r).provision();
    const second = await create(r).provision();
    expect(second.pubkey).toBe(first.pubkey);
  });

  it("reads the missing container in either docker wording", async () => {
    for (const scenario of ["ok", "docker-29-wording"] as const) {
      const r = make(scenario);
      r.secrets.setToken(TOKEN);
      const flow = create(r);
      await flow.activate((await flow.provision()).pubkey);
      expect(r.fake.state().containers["gp-maple"], scenario).toBeTruthy();
    }
  });
});

describe("waiting", () => {
  it("looks again until the agent runs, at the pace it set", async () => {
    const r = make();
    r.secrets.setToken(TOKEN);
    r.fake.tweak({ connectingPolls: 3 });
    const flow = create(r);
    await flow.activate((await flow.provision()).pubkey);
    expect(r.slept).toEqual([1500, 1500, 1500]);
  });

  it("stops at once when the caller goes away", async () => {
    const r = make();
    r.secrets.setToken(TOKEN);
    const abort = new AbortController();
    r.fake.tweak({ connectingPolls: 1000 });
    const flow = create(r, { signal: abort.signal });
    const { pubkey } = await create(r).provision();
    const sleep = r.deps.sleep;
    const deps = { ...r.deps, sleep: async (ms: number, signal: AbortSignal) => (abort.abort(), sleep(ms, signal)) };
    const error = await activate(deps, { name: NAME, pubkey, auth: authOf(), selfUpdate: true, claudeWay: "token", signal: abort.signal }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(CreateError);
    expect((error as Error).message).toBe("Stopped.");
    void flow;
  });
});

describe("removing an agent", () => {
  it("removes the container, the helper and the data, and an agent already gone counts as removed", async () => {
    const r = make();
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    await flow.activate((await flow.provision()).pubkey);
    await remove(r.deps.start, "maple", SIGNAL);
    expect(r.fake.state().containers).toEqual({});
    expect(r.fake.state().volumes).toEqual({});
    await remove(r.deps.start, "maple", SIGNAL);
    const used = r.fake.calls().map((call) => call.argv.join(" "));
    expect(used).toContain(lineOf(commands.remove("maple")).join(" "));
    expect(used).toContain(lineOf(commands.removeData("maple")).join(" "));
  });

  it("deletes the data volume, the agent's key and memory, and that is the last thing it does", async () => {
    const r = make();
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    await flow.activate((await flow.provision()).pubkey);
    expect(Object.keys(r.fake.state().volumes)).toEqual(["gp-maple-data"]);
    await remove(r.deps.start, "maple", SIGNAL);
    expect(r.fake.state().volumes).toEqual({});
    const removal = r.fake.calls().map((call) => call.argv.join(" ")).filter((line) => line.startsWith("rm ") || line.startsWith("volume rm"));
    expect(removal).toEqual(["rm -f gp-maple gp-maple.updater", "volume rm gp-maple-data"]);
  });

  it("does not delete the data volume when the container could not be removed, and says so", async () => {
    const r = make();
    r.secrets.setToken(TOKEN);
    const flow = create(r);
    await flow.activate((await flow.provision()).pubkey);
    const real = r.deps.start;
    // `docker rm -f` fails (the daemon refuses, say): the volume must stay, or the agent's key goes while the agent still runs.
    const start: typeof real = async (command, handlers) => {
      if (command.process !== "rm") return real(command, handlers);
      queueMicrotask(() => handlers.onStderr("Error response from daemon: cannot remove container: permission denied\n"));
      return { write: async () => undefined, end: async () => undefined, kill: async () => undefined, exited: Promise.resolve(1) };
    };
    const error = await remove(start, "maple", SIGNAL).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(CreateError);
    expect((error as Error).message).toMatch(/could not remove the agent's container/);
    expect(r.fake.calls().some((call) => call.argv.includes("volume"))).toBe(false);
    expect(Object.keys(r.fake.state().volumes)).toEqual(["gp-maple-data"]);
    expect(Object.keys(r.fake.state().containers).sort()).toEqual(["gp-maple", "gp-maple.updater"]);
  });

  it("says what failed when docker cannot", async () => {
    const r = make("daemon-down");
    const error = await remove(r.deps.start, "maple", SIGNAL).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(CreateError);
  });
});
