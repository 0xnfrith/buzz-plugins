import { afterEach, describe, expect, it } from "vitest";
import type { Ran, Runner } from "../../src/docker";
import { runnerFor } from "../../src/docker";
import { NOTHING_YET, POLL_MS, SWAP_MS, afterButton, askedFor, imageOf, observe, type Memory, type View } from "../../src/observe";
import { argvOf, hostOver, makeFake, type FakeDocker } from "./support/fake-host";

const made: { fake: FakeDocker; stop: () => void }[] = [];
afterEach(() => made.splice(0).forEach(({ fake, stop }) => (stop(), fake.cleanup())));

/** An agent `maple` in the fake, and a runner that runs `docker` against it. `seed` is how the agent starts. */
function agent(scenario: unknown = {}, seed: Record<string, unknown> | false = { condition: "running" }, hostOptions?: { missing?: boolean }) {
  const fake = makeFake(scenario);
  if (seed) fake.seed({ slug: "maple", ...seed });
  const { host, calls, stopAll } = hostOver(fake, hostOptions);
  made.push({ fake, stop: stopAll });
  return { fake, calls, run: runnerFor(host, new AbortController().signal) };
}

const lookAt = async (run: Runner, memory: Memory, now: number) => {
  const seen = await observe(run, "maple", memory, now);
  if (seen === undefined) throw new Error("the look was abandoned");
  return seen;
};

/** Looks every ten seconds, as the screen does, `count` times: the views, in order. */
async function watch(run: Runner, count: number, start = 0) {
  let memory = NOTHING_YET;
  const views: View[] = [];
  for (let at = 0; at < count; at++) {
    const seen = await lookAt(run, memory, start + at * POLL_MS);
    memory = seen.memory;
    views.push(seen.view);
  }
  return views;
}

const exit = (code: number | null, stdout = "", stderr = ""): Ran => ({ kind: "exit", code, stdout, stderr });
const GOOD = JSON.stringify({
  interface: 1, version: "0.0.0", state: "running", agent_pubkey: "a".repeat(64), relay_url: "wss://relay.example.com", relay: "connected",
  claude: "active", update: { available: false, version: null }, previous_version: null, error: null,
});
const UPDATING = GOOD.replace('"running"', '"updating"');

/** A runner that answers each call from `answers` in order, and records what it was asked. */
function scripted(...answers: (Ran | undefined)[]) {
  const asked: (readonly string[])[] = [];
  const run: Runner = async (call) => {
    asked.push(argvOf(call));
    if (answers.length === 0) throw new Error(`unexpected call: ${argvOf(call).join(" ")}`);
    return answers.shift();
  };
  return { run, asked };
}
const STATUS = ["exec", "gp-maple", "gp", "status", "--json"];
const INSPECT = ["inspect", "--format", "{{.State.Status}}", "gp-maple"];

describe("a look at a running agent (against the fake docker)", () => {
  it("asks `docker exec gp-maple gp status --json` and nothing else, and shows what it says", async () => {
    const { run, calls } = agent();
    const seen = await lookAt(run, NOTHING_YET, 0);
    expect(seen.view).toMatchObject({ kind: "status", status: { state: "running", version: "0.0.0", relay: "connected", claude: "active" } });
    expect(calls.map(({ argv }) => argv)).toEqual([STATUS]);
    expect(calls.map(({ id }) => id)).toEqual(["exec"]);
  });

  it("shows needs-auth-tag, needs-claude, connecting and running, in the order a new agent goes through them", async () => {
    const { fake, run } = agent({}, { condition: "needs-auth-tag" });
    const states = async () => (await watch(run, 1)).map((view) => (view.kind === "status" ? view.status.state : view.kind));
    expect(await states()).toEqual(["needs-auth-tag"]);
    // The owner's attestation, then the Claude token.
    const { attestationTag } = await import("../fake-docker/index.mjs");
    await fake.run(["exec", "-i", "gp-maple", "gp", "auth-tag", "set"], { input: `${attestationTag(fake.state().volumes["gp-maple-data"].owner)}\n` });
    expect(await states()).toEqual(["needs-claude"]);
    await fake.run(["exec", "-i", "gp-maple", "gp", "claude", "token"], { input: "made-up-token\n" });
    expect(await states()).toEqual(["connecting"]);
    expect(await states()).toEqual(["running"]);
  });

  it("shows the error state with its code and message", async () => {
    const { run } = agent("status-error");
    expect((await lookAt(run, NOTHING_YET, 0)).view).toMatchObject({
      kind: "status",
      status: { state: "error", error: { code: "crashed", message: "The agent stopped unexpectedly." } },
    });
  });

  it("shows each relay value", async () => {
    for (const relay of ["connected", "refused-not-member", "unreachable"]) {
      const { run } = agent({ relay });
      expect((await lookAt(run, NOTHING_YET, 0)).view, relay).toMatchObject({ kind: "status", status: { relay } });
    }
  });

  it("shows an update on offer and the version to go back to", async () => {
    const { run } = agent("update-available", { condition: "running", previousVersion: "0.0.0", version: "0.0.5" });
    expect((await lookAt(run, NOTHING_YET, 0)).view).toMatchObject({
      kind: "status",
      status: { version: "0.0.5", update: { available: true, version: "0.1.1" }, previousVersion: "0.0.0" },
    });
  });

  it("shows only the unknown-interface line when GHOST Protocol speaks another interface", async () => {
    const { run } = agent("unknown-interface");
    expect((await lookAt(run, NOTHING_YET, 0)).view).toEqual({ kind: "other-interface" });
  });

  it("reads the status however it is printed", async () => {
    for (const scenario of [{}, { statusFormat: "compact" }, "status-compact-with-preamble"]) {
      const { run } = agent(scenario);
      expect((await lookAt(run, NOTHING_YET, 0)).view.kind, JSON.stringify(scenario)).toBe("status");
    }
  });
});

describe("a look when `docker exec` fails (against the fake docker)", () => {
  it("says the container is stopped, with Docker's word for it, when `docker inspect` finds it not running", async () => {
    const { run, calls } = agent({}, { condition: "stopped" });
    expect((await lookAt(run, NOTHING_YET, 0)).view).toEqual({ kind: "stopped", dockerState: "exited" });
    expect(calls.map(({ argv }) => argv)).toEqual([STATUS, INSPECT]);
    expect(calls.map(({ id }) => id)).toEqual(["exec", "inspect-state"]);
  });

  it("says the container is gone when `docker inspect` finds no such object", async () => {
    const { run } = agent({}, false);
    expect((await lookAt(run, NOTHING_YET, 0)).view).toEqual({ kind: "gone" });
  });

  it("says Docker is not available when the daemon is down, docker is missing or its permission is refused", async () => {
    for (const scenario of ["daemon-down", "docker-missing", "permission-denied"]) {
      const { run } = agent(scenario, false);
      expect((await lookAt(run, NOTHING_YET, 0)).view, scenario).toEqual({ kind: "docker-unavailable" });
    }
  });

  it("says Docker is not available when there is no docker to start", async () => {
    const { run, calls } = agent({}, { condition: "running" }, { missing: true });
    expect((await lookAt(run, NOTHING_YET, 0)).view).toEqual({ kind: "docker-unavailable" });
    // It asked once and stopped: with no docker, inspect has nothing to add.
    expect(calls).toHaveLength(1);
  });
});

describe("the two-minute gap while an update swaps the container (against the fake docker)", () => {
  const SCENARIO = { update: { available: true, version: "0.1.1" }, updateStartPolls: 0, updatingPolls: 2 };

  it("keeps showing the update through a gap where the container is missing, then shows the new version", async () => {
    const { fake, run } = agent({ ...SCENARIO, updateGapPolls: 2 });
    expect((await fake.run(["exec", "gp-maple", "gp", "update", "request"])).code).toBe(0);
    const views = await watch(run, 6);
    expect(views.map((view) => (view.kind === "status" ? `${view.status.state} ${view.status.version}` : view.kind))).toEqual([
      "updating 0.0.0",
      "updating 0.0.0",
      "swapping",
      "swapping",
      "running 0.1.1",
      "running 0.1.1",
    ]);
  });

  it("keeps showing the update through a gap where the container is stopped", async () => {
    const { fake, run } = agent({ ...SCENARIO, updateGapPolls: 2, updateGapKind: "stopped" });
    await fake.run(["exec", "gp-maple", "gp", "update", "request"]);
    const views = await watch(run, 5);
    expect(views.map((view) => view.kind)).toEqual(["status", "status", "swapping", "swapping", "status"]);
  });

  it("shows that the container is gone once a gap has lasted two minutes, and recovers when the container returns", async () => {
    const { fake, run } = agent({ ...SCENARIO, updateGapPolls: "forever" });
    await fake.run(["exec", "gp-maple", "gp", "update", "request"]);
    // Two looks see `updating`; the third finds the container missing, and the two minutes count from there.
    const views = await watch(run, 2 + SWAP_MS / POLL_MS + 2);
    const kinds = views.map((view) => view.kind);
    expect(kinds.slice(0, 2)).toEqual(["status", "status"]);
    expect(kinds.slice(2, 2 + SWAP_MS / POLL_MS)).toEqual(Array(SWAP_MS / POLL_MS).fill("swapping"));
    expect(kinds.slice(2 + SWAP_MS / POLL_MS)).toEqual(["gone", "gone"]);
  });

  it("shows that the container is stopped, and not gone, once a gap of a stopped container has lasted two minutes", async () => {
    const { fake, run } = agent({ ...SCENARIO, updateGapPolls: "forever", updateGapKind: "stopped" });
    await fake.run(["exec", "gp-maple", "gp", "update", "request"]);
    const views = await watch(run, 2 + SWAP_MS / POLL_MS + 1);
    expect(views.at(-1)).toEqual({ kind: "stopped", dockerState: "exited" });
  });

  it("does not take a container that is missing without an update for one that is swapping", async () => {
    const { run } = agent({}, { condition: "running" });
    const memory = (await lookAt(run, NOTHING_YET, 0)).memory;
    expect(memory.lastState).toBe("running");
    const gone = agent({}, false);
    expect((await lookAt(gone.run, memory, POLL_MS)).view).toEqual({ kind: "gone" });
  });
});

describe("a look, with scripted answers", () => {
  it("counts two minutes from the first look that finds the container missing, and not from the last `updating`", async () => {
    const NOT_THERE = exit(1, "", "Error: No such object: gp-maple\n");
    const GONE = exit(1, "", "Error response from daemon: No such container: gp-maple\n");
    const { run } = scripted(exit(0, UPDATING), GONE, NOT_THERE, GONE, NOT_THERE, GONE, NOT_THERE, GONE, NOT_THERE);
    let seen = await lookAt(run, NOTHING_YET, 0);
    expect(seen.memory).toEqual({ lastState: "updating", gapSince: undefined });
    // A long time after the last `updating`, the first look that finds it missing starts the two minutes.
    seen = await lookAt(run, seen.memory, 500_000);
    expect(seen.view).toEqual({ kind: "swapping" });
    expect(seen.memory).toEqual({ lastState: "updating", gapSince: 500_000 });
    seen = await lookAt(run, seen.memory, 500_000 + SWAP_MS - 1);
    expect(seen.view).toEqual({ kind: "swapping" });
    // Exactly two minutes: the update has taken too long.
    seen = await lookAt(run, seen.memory, 500_000 + SWAP_MS);
    expect(seen.view).toEqual({ kind: "gone" });
    // And the start of the gap does not move.
    expect(seen.memory.gapSince).toBe(500_000);
  });

  it("starts the gap over after a look that read a status", async () => {
    const GONE = [exit(1, "", "Error response from daemon: No such container: gp-maple\n"), exit(1, "", "Error: No such object: gp-maple\n")];
    const { run } = scripted(exit(0, UPDATING), ...GONE, exit(0, UPDATING), ...GONE);
    let seen = await lookAt(run, NOTHING_YET, 0);
    seen = await lookAt(run, seen.memory, 10_000);
    expect(seen.memory.gapSince).toBe(10_000);
    seen = await lookAt(run, seen.memory, 20_000);
    expect(seen.memory).toEqual({ lastState: "updating", gapSince: undefined });
    seen = await lookAt(run, seen.memory, 200_000);
    expect(seen.view).toEqual({ kind: "swapping" });
    expect(seen.memory.gapSince).toBe(200_000);
  });

  it("shows a container that runs but does not answer as still updating, within the two minutes, after an update", async () => {
    const NOT_ANSWERING = [exit(1, "GP_ERROR=starting\nGP_ERROR_MESSAGE=Still starting.\n"), exit(0, "running\n")];
    const { run } = scripted(exit(0, UPDATING), ...NOT_ANSWERING, ...NOT_ANSWERING);
    let seen = await lookAt(run, NOTHING_YET, 0);
    seen = await lookAt(run, seen.memory, 10_000);
    expect(seen.view).toEqual({ kind: "swapping" });
    seen = await lookAt(run, seen.memory, 10_000 + SWAP_MS);
    expect(seen.view).toEqual({ kind: "not-answering", code: "starting", message: "Still starting." });
  });

  it("does not count Docker being down as the container being swapped", async () => {
    const { run } = scripted(exit(0, UPDATING), { kind: "unavailable" }, exit(1, "", "x"), exit(1, "", "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n"));
    let seen = await lookAt(run, NOTHING_YET, 0);
    seen = await lookAt(run, seen.memory, 10_000);
    expect(seen.view).toEqual({ kind: "docker-unavailable" });
    expect(seen.memory).toEqual({ lastState: "updating", gapSince: undefined });
    seen = await lookAt(run, seen.memory, 20_000);
    expect(seen.view).toEqual({ kind: "docker-unavailable" });
    expect(seen.memory.gapSince).toBeUndefined();
  });

  it("shows a container that runs and prints a GP_ERROR as not answering, with the code and message", async () => {
    const { run, asked } = scripted(exit(1, "GP_INTERFACE=1\nGP_ERROR=db-locked\nGP_ERROR_MESSAGE=The database is locked.\n"), exit(0, "running\n"));
    expect((await lookAt(run, NOTHING_YET, 0)).view).toEqual({ kind: "not-answering", code: "db-locked", message: "The database is locked." });
    expect(asked).toEqual([STATUS, INSPECT]);
  });

  it("shows a container that runs and says nothing as not answering, with no code", async () => {
    const { run } = scripted(exit(1, "", "OCI runtime exec failed\n"), exit(0, "running\n"));
    expect((await lookAt(run, NOTHING_YET, 0)).view).toEqual({ kind: "not-answering", code: undefined, message: undefined });
  });

  it("treats a status that a signal cut short like any other failure, and asks inspect", async () => {
    const { run, asked } = scripted(exit(null, GOOD), exit(0, "exited\n"));
    expect((await lookAt(run, NOTHING_YET, 0)).view).toEqual({ kind: "stopped", dockerState: "exited" });
    expect(asked).toHaveLength(2);
  });

  it("says the container is stopped for any state Docker has besides running", async () => {
    for (const dockerState of ["exited", "created", "paused", "restarting", "removing", "dead"]) {
      const { run } = scripted(exit(1, "", "container is not running\n"), exit(0, `${dockerState}\n`));
      expect((await lookAt(run, NOTHING_YET, 0)).view, dockerState).toEqual({ kind: "stopped", dockerState });
    }
  });

  it("says Docker is not available when inspect fails for any reason but a missing object", async () => {
    for (const stderr of ["Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n", "permission denied while trying to connect\n", ""]) {
      const { run } = scripted(exit(1, "", stderr), exit(1, "", stderr));
      expect((await lookAt(run, NOTHING_YET, 0)).view, stderr).toEqual({ kind: "docker-unavailable" });
    }
  });

  it("says the container is gone for any wording of Docker's `no such object`, in any case, and from either command's older or newer docker", async () => {
    for (const stderr of [
      "Error: No such object: gp-maple\n",
      "error: no such object: gp-maple\n",
      "ERROR: NO SUCH OBJECT: gp-maple\n",
      "Error response from daemon: No such container: gp-maple\n",
      "Error response from daemon: no such container: gp-maple\n",
      "Error: No such container: gp-maple\n",
    ]) {
      const { run } = scripted(exit(1, "", "Error response from daemon: No such container: gp-maple\n"), exit(1, "", stderr));
      expect((await lookAt(run, NOTHING_YET, 0)).view, stderr).toEqual({ kind: "gone" });
    }
  });

  it("says Docker is not available for both of the daemon-down texts, and not that the container is gone", async () => {
    for (const stderr of [
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n",
      "error during connect: Get \"http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.47/containers/gp-maple/json\": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.\n",
      "failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running\n",
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock: dial unix /var/run/docker.sock: connect: no such file or directory\n",
    ]) {
      const { run } = scripted(exit(1, "", stderr), exit(1, "", stderr));
      expect((await lookAt(run, NOTHING_YET, 0)).view, stderr).toEqual({ kind: "docker-unavailable" });
    }
  });

  it("says Docker is not available when inspect cannot be made at all, after a status that failed", async () => {
    expect((await lookAt(scripted(exit(1), { kind: "unavailable" }).run, NOTHING_YET, 0)).view).toEqual({ kind: "docker-unavailable" });
  });

  it("looks about every ten seconds, and counts an update's gap for two minutes", () => {
    expect(POLL_MS).toBe(10_000);
    expect(SWAP_MS).toBe(120_000);
  });

  it("says unreadable for an exit 0 that is not a status, and keeps what it knew", async () => {
    for (const stdout of ["", "ok", "{}{}", "[]"]) {
      const { run } = scripted(exit(0, stdout));
      const before: Memory = { lastState: "running", gapSince: undefined, asked: undefined };
      const seen = await lookAt(run, before, 0);
      expect(seen.view, JSON.stringify(stdout)).toEqual({ kind: "unreadable" });
      expect(seen.memory).toBe(before);
    }
  });

  it("says another interface for an exit 0 with an interface it does not know, and nothing else", async () => {
    const { run } = scripted(exit(0, JSON.stringify({ interface: 7 })));
    expect((await lookAt(run, NOTHING_YET, 0)).view).toEqual({ kind: "other-interface" });
  });

  it("says this Buzz cannot start a process when the host has no spawn, before and after the status", async () => {
    expect((await lookAt(scripted({ kind: "unsupported" }).run, NOTHING_YET, 0)).view).toEqual({ kind: "unsupported" });
    expect((await lookAt(scripted(exit(1), { kind: "unsupported" }).run, NOTHING_YET, 0)).view).toEqual({ kind: "unsupported" });
  });

  it("says Docker is not available when the status call could not be made, and asks nothing more", async () => {
    const { run, asked } = scripted({ kind: "unavailable" });
    expect((await lookAt(run, NOTHING_YET, 0)).view).toEqual({ kind: "docker-unavailable" });
    expect(asked).toHaveLength(1);
  });

  it("gives up, and shows nothing, when the caller leaves during either call", async () => {
    expect(await observe(scripted(undefined).run, "maple", NOTHING_YET, 0)).toBeUndefined();
    expect(await observe(scripted(exit(1), undefined).run, "maple", NOTHING_YET, 0)).toBeUndefined();
  });

  it("looks at the agent it was given, and only builds an argument from a slug", async () => {
    const { run, asked } = scripted(exit(0, GOOD));
    await observe(run, "other-agent-2", NOTHING_YET, 0);
    expect(asked).toEqual([["exec", "gp-other-agent-2", "gp", "status", "--json"]]);
    await expect(observe(scripted().run, "Bad Name; rm", NOTHING_YET, 0)).rejects.toThrow("not a slug");
  });
});

describe("an update or a roll back that this screen asked for", () => {
  const GONE = () => exit(1, "", "Error response from daemon: No such container: gp-maple\n");
  const NOT_THERE = () => exit(1, "", "Error: No such object: gp-maple\n");
  const statusAt = (version: string, state: string) => exit(0, GOOD.replace('"version":"0.0.0"', `"version":"${version}"`).replace('"state":"running"', `"state":"${state}"`));
  const RUNNING: Memory = { lastState: "running", gapSince: undefined, asked: undefined };

  it("is remembered with the version the agent was on, and keeps the rest of what was known", () => {
    expect(askedFor({ lastState: "running", gapSince: 5, asked: undefined }, "0.0.0")).toEqual({ lastState: "running", gapSince: 5, asked: { from: "0.0.0", sawUpdating: false } });
    expect(askedFor(NOTHING_YET, "1.2.3").asked).toEqual({ from: "1.2.3", sawUpdating: false });
  });

  it("counts as an update under way, though no status said `updating`: a container missing then is swapping, for two minutes", async () => {
    const { run } = scripted(GONE(), NOT_THERE(), GONE(), NOT_THERE(), GONE(), NOT_THERE());
    let seen = await lookAt(run, askedFor(RUNNING, "0.0.0"), 1_000);
    expect(seen.view).toEqual({ kind: "swapping" });
    expect(seen.memory).toMatchObject({ lastState: "running", gapSince: 1_000, asked: { from: "0.0.0" } });
    seen = await lookAt(run, seen.memory, 1_000 + SWAP_MS - 1);
    expect(seen.view).toEqual({ kind: "swapping" });
    seen = await lookAt(run, seen.memory, 1_000 + SWAP_MS);
    expect(seen.view).toEqual({ kind: "gone" });
    expect(seen.memory.gapSince).toBe(1_000);
  });

  it("does the same for a container that is stopped, and for one that runs and does not answer", async () => {
    const stopped = scripted(exit(1, "", "container is not running\n"), exit(0, "exited\n"), exit(1, "", "container is not running\n"), exit(0, "exited\n"));
    let seen = await lookAt(stopped.run, askedFor(RUNNING, "0.0.0"), 0);
    expect(seen.view).toEqual({ kind: "swapping" });
    seen = await lookAt(stopped.run, seen.memory, SWAP_MS);
    expect(seen.view).toEqual({ kind: "stopped", dockerState: "exited" });
    const silent = scripted(exit(1, "", "OCI runtime exec failed\n"), exit(0, "running\n"));
    expect((await lookAt(silent.run, askedFor(RUNNING, "0.0.0"), 0)).view).toEqual({ kind: "swapping" });
  });

  it("does not count when nothing was asked: the same container, missing, is gone at once", async () => {
    expect((await lookAt(scripted(GONE(), NOT_THERE()).run, RUNNING, 0)).view).toEqual({ kind: "gone" });
  });

  it("is over when a status with another version arrives, and a container missing after that is gone", async () => {
    const { run } = scripted(statusAt("0.1.1", "running"), GONE(), NOT_THERE());
    let seen = await lookAt(run, askedFor(RUNNING, "0.0.0"), 0);
    expect(seen.view).toMatchObject({ kind: "status", status: { version: "0.1.1" } });
    expect(seen.memory.asked).toBeUndefined();
    seen = await lookAt(run, seen.memory, 10_000);
    expect(seen.view).toEqual({ kind: "gone" });
  });

  it("is over when a roll back has gone back: another version again", async () => {
    const { run } = scripted(statusAt("0.0.0", "running"));
    const seen = await lookAt(run, askedFor({ ...RUNNING }, "0.1.1"), 0);
    expect(seen.memory.asked).toBeUndefined();
  });

  it("goes on while the agent still has the old version and is not updating yet: it is finishing its task", async () => {
    const { run } = scripted(statusAt("0.0.0", "running"), statusAt("0.0.0", "running"), GONE(), NOT_THERE());
    let seen = await lookAt(run, askedFor(RUNNING, "0.0.0"), 0);
    expect(seen.memory.asked).toEqual({ from: "0.0.0", sawUpdating: false });
    seen = await lookAt(run, seen.memory, 10_000);
    expect(seen.memory.asked).toEqual({ from: "0.0.0", sawUpdating: false });
    expect((await lookAt(run, seen.memory, 20_000)).view).toEqual({ kind: "swapping" });
  });

  it("is over when an update that was seen ended on the old version: it did not happen", async () => {
    const { run } = scripted(statusAt("0.0.0", "updating"), statusAt("0.0.0", "running"), GONE(), NOT_THERE());
    let seen = await lookAt(run, askedFor(RUNNING, "0.0.0"), 0);
    expect(seen.memory).toMatchObject({ lastState: "updating", asked: { from: "0.0.0", sawUpdating: true } });
    seen = await lookAt(run, seen.memory, 10_000);
    expect(seen.memory.asked).toBeUndefined();
    expect((await lookAt(run, seen.memory, 20_000)).view).toEqual({ kind: "gone" });
  });

  it("is kept through a look that could not read the status, and a look when Docker was away", async () => {
    const { run } = scripted(exit(0, "not json"), { kind: "unavailable" }, GONE(), NOT_THERE());
    let seen = await lookAt(run, askedFor(RUNNING, "0.0.0"), 0);
    expect(seen.view).toEqual({ kind: "unreadable" });
    expect(seen.memory.asked).toEqual({ from: "0.0.0", sawUpdating: false });
    seen = await lookAt(run, seen.memory, 10_000);
    expect(seen.view).toEqual({ kind: "docker-unavailable" });
    expect(seen.memory.asked).toEqual({ from: "0.0.0", sawUpdating: false });
    expect((await lookAt(run, seen.memory, 20_000)).view).toEqual({ kind: "swapping" });
  });

  it("carries an update that is quicker than a look (against the fake docker): the gap is swapping, then the new version, then gone means gone", async () => {
    const { fake, run } = agent({ update: { available: true, version: "0.1.1" }, updatingPolls: 0, updateGapPolls: 2 });
    let seen = await lookAt(run, NOTHING_YET, 0);
    expect(seen.view).toMatchObject({ kind: "status", status: { state: "running", version: "0.0.0" } });
    expect((await fake.run(["exec", "gp-maple", "gp", "update", "request"])).code).toBe(0);
    let memory = askedFor(seen.memory, "0.0.0");
    const views: string[] = [];
    for (let at = 1; at <= 3; at++) {
      seen = await lookAt(run, memory, at * POLL_MS);
      memory = seen.memory;
      views.push(seen.view.kind === "status" ? `${seen.view.status.state} ${seen.view.status.version}` : seen.view.kind);
    }
    expect(views).toEqual(["swapping", "swapping", "running 0.1.1"]);
    expect(memory.asked).toBeUndefined();
    fake.patchState((state: { containers: Record<string, unknown> }) => {
      delete state.containers["gp-maple"];
    });
    expect((await lookAt(run, memory, 5 * POLL_MS)).view).toEqual({ kind: "gone" });
  });

  it("without being asked, the same update is shown as gone for the look that fell in the gap", async () => {
    const { fake, run } = agent({ update: { available: true, version: "0.1.1" }, updatingPolls: 0, updateGapPolls: 2 });
    let seen = await lookAt(run, NOTHING_YET, 0);
    await fake.run(["exec", "gp-maple", "gp", "update", "request"]);
    seen = await lookAt(run, seen.memory, POLL_MS);
    expect(seen.view).toEqual({ kind: "gone" });
  });
});

describe("what a button that was accepted does to what the screen knows", () => {
  const STOPPED = () => [exit(1, "", "Error response from daemon: container abc is not running\n"), exit(0, "exited\n")];
  const NOT_THERE = () => [exit(1, "", "Error response from daemon: No such container: gp-maple\n"), exit(1, "", "Error: No such object: gp-maple\n")];

  it("starts an update under way for an Update or a Roll back, with the version the agent was on", () => {
    for (const job of ["update", "rollback"] as const) {
      expect(afterButton(NOTHING_YET, job, true, "0.0.0")).toEqual(askedFor(NOTHING_YET, "0.0.0"));
    }
  });

  it("changes nothing for an Update or a Roll back that was not accepted, or when the version is not known", () => {
    const before: Memory = { lastState: "running", gapSince: 5, asked: undefined };
    for (const job of ["update", "rollback", "restart", "stop"] as const) expect(afterButton(before, job, false, "0.0.0"), job).toBe(before);
    expect(afterButton(before, "update", true, undefined)).toBe(before);
  });

  it("ends any update under way for a Stop or a Restart that was accepted: the screen then says what it finds", () => {
    const under: Memory = { lastState: "updating", gapSince: 30_000, asked: { from: "0.0.0", sawUpdating: true } };
    for (const job of ["stop", "restart"] as const) expect(afterButton(under, job, true, "0.0.0"), job).toEqual(NOTHING_YET);
  });

  it("shows a container the user stopped as stopped at once, though an Update was asked for and has not started", async () => {
    // The agent is finishing its task on the old version: no status said `updating`.
    let memory = askedFor({ lastState: "running", gapSince: undefined, asked: undefined }, "0.0.0");
    // Without the Stop, a container found stopped is swapping.
    expect((await lookAt(scripted(...STOPPED()).run, memory, 10_000)).view).toEqual({ kind: "swapping" });
    memory = afterButton(memory, "stop", true, "0.0.0");
    const seen = await lookAt(scripted(...STOPPED()).run, memory, 10_000);
    expect(seen.view).toEqual({ kind: "stopped", dockerState: "exited" });
    expect(seen.memory.gapSince).toBeUndefined();
  });

  it("shows a container the user stopped as stopped at once, when the last status said `updating`", async () => {
    let memory: Memory = { lastState: "updating", gapSince: undefined, asked: undefined };
    expect((await lookAt(scripted(...STOPPED()).run, memory, 10_000)).view).toEqual({ kind: "swapping" });
    memory = afterButton(memory, "stop", true, "0.0.0");
    expect((await lookAt(scripted(...STOPPED()).run, memory, 10_000)).view).toEqual({ kind: "stopped", dockerState: "exited" });
  });

  it("shows a container the user restarted, and that is then missing, as gone at once, and not as being swapped", async () => {
    const memory = afterButton({ lastState: "updating", gapSince: undefined, asked: undefined }, "restart", true, undefined);
    expect((await lookAt(scripted(...NOT_THERE()).run, memory, 10_000)).view).toEqual({ kind: "gone" });
  });

  it("keeps an update under way when a Stop was not accepted: the container is still swapping", async () => {
    const memory = afterButton(askedFor({ lastState: "running", gapSince: undefined, asked: undefined }, "0.0.0"), "stop", false, "0.0.0");
    expect((await lookAt(scripted(...STOPPED()).run, memory, 10_000)).view).toEqual({ kind: "swapping" });
  });
});

describe("imageOf", () => {
  it("is the image the container was made from", async () => {
    const { run } = agent({}, { condition: "running", version: "0.0.5" });
    const { imageOfVersion } = await import("../fake-docker/index.mjs");
    expect(await imageOf(run, "maple")).toBe(imageOfVersion("0.0.5"));
    expect(imageOfVersion("0.0.5")).toMatch(/^registry\.example\/ghost-protocol:0\.0\.5@sha256:[0-9a-f]{64}$/);
  });

  it("is nothing when the container is not there, or Docker is not", async () => {
    expect(await imageOf(agent({}, false).run, "maple")).toBeUndefined();
    expect(await imageOf(scripted({ kind: "unavailable" }).run, "maple")).toBeUndefined();
    expect(await imageOf(scripted(exit(0, "\n")).run, "maple")).toBeUndefined();
    expect(await imageOf(scripted(undefined).run, "maple")).toBeUndefined();
  });

  it("is nothing when the call failed, whatever it printed", async () => {
    for (const code of [1, 2, 125, null]) expect(await imageOf(scripted(exit(code, `registry.example/ghost-protocol:0.0.0@sha256:${"a".repeat(64)}\n`)).run, "maple"), String(code)).toBeUndefined();
  });
});
