import { afterEach, describe, expect, it } from "vitest";
import { askDocker, askToUpdate, firstLine } from "../../src/actions";
import { runnerFor, type Ran, type Runner } from "../../src/docker";
import { WORDS } from "../../src/words";
import { argvOf, hostOver, makeFake, type FakeDocker } from "./support/fake-host";

const made: { fake: FakeDocker; stop: () => void }[] = [];
afterEach(() => made.splice(0).forEach(({ fake, stop }) => (stop(), fake.cleanup())));

/** An agent `maple` in the fake, with the update helper beside it unless the scenario says the user said no. */
function agent(scenario: unknown = {}, seed: Record<string, unknown> | false = { condition: "running" }, hostOptions?: { missing?: boolean }) {
  const fake = makeFake(scenario);
  if (seed) fake.seed({ slug: "maple", ...seed });
  const { host, calls, stopAll } = hostOver(fake, hostOptions);
  made.push({ fake, stop: stopAll });
  return { fake, calls, run: runnerFor(host, new AbortController().signal) };
}
const statusOf = async (fake: FakeDocker) => JSON.parse((await fake.run(["exec", "gp-maple", "gp", "status", "--json"])).stdout);

const exit = (code: number | null, stdout = "", stderr = ""): Ran => ({ kind: "exit", code, stdout, stderr });
const scripted = (answer: Ran | undefined): { run: Runner; asked: (readonly string[])[] } => {
  const asked: (readonly string[])[] = [];
  return { asked, run: async (call) => (asked.push(argvOf(call)), answer) };
};

describe("Update: `gp update request`", () => {
  it("asks for the update inside the container, without -i, and says the agent finishes its task first", async () => {
    const { run, calls } = agent("update-available");
    expect(await askToUpdate(run, "maple", "update")).toEqual({ tone: "ok", text: WORDS.updateRequested });
    expect(calls.map(({ argv }) => argv)).toEqual([["exec", "gp-maple", "gp", "update", "request"]]);
    expect(calls.map(({ id }) => id)).toEqual(["exec"]);
    expect(WORDS.updateRequested).toMatch(/finishes its task first/);
  });

  it("walks the agent to the new version: running, updating, and running again", async () => {
    const { fake, run } = agent("update-available");
    await askToUpdate(run, "maple", "update");
    const seen = [];
    for (let at = 0; at < 4; at++) {
      const status = await statusOf(fake);
      seen.push(`${status.state} ${status.version}`);
    }
    expect(seen).toEqual(["updating 0.0.0", "updating 0.0.0", "running 0.1.1", "running 0.1.1"]);
  });

  it("says there is no update to take, when GHOST Protocol answers no-update-available", async () => {
    const { run } = agent({});
    expect(await askToUpdate(run, "maple", "update")).toEqual({ tone: "info", text: WORDS.noUpdateAvailable });
  });

  it("says an update is under way, when GHOST Protocol answers update-in-progress to a second request", async () => {
    const { run } = agent("update-available");
    await askToUpdate(run, "maple", "update");
    expect(await askToUpdate(run, "maple", "update")).toEqual({ tone: "info", text: WORDS.updateInProgress });
  });

  it("says the agent has no update helper, and that the update goes by hand, when GHOST Protocol answers no-updater", async () => {
    const { run } = agent({ selfUpdate: "no", update: { available: true, version: "0.1.1" } });
    expect(await askToUpdate(run, "maple", "update")).toEqual({ tone: "info", text: WORDS.noUpdaterTitle, noUpdater: true });
    // Also when there is no update to take: the fake answers the missing helper first.
    const none = agent({ selfUpdate: "no" });
    expect(await askToUpdate(none.run, "maple", "update")).toMatchObject({ noUpdater: true });
  });

  it("shows GHOST Protocol's own message and code for an error it does not know", async () => {
    const { run } = agent({ fail: { updateRequest: true } });
    expect(await askToUpdate(run, "maple", "update")).toEqual({ tone: "problem", text: "The update could not be requested. (update-failed)" });
  });

  it("names the code when GHOST Protocol gives no message", async () => {
    for (const stdout of ["GP_ERROR=odd-code\n", "GP_ERROR=odd-code\nGP_ERROR_MESSAGE=\n"]) {
      expect(await askToUpdate(scripted(exit(1, stdout)).run, "maple", "update")).toEqual({ tone: "problem", text: "GHOST Protocol refused: odd-code." });
    }
  });

  it("says Docker could not run it, with the first line Docker gave, when the failure has no GP_ERROR", async () => {
    const { run } = agent("daemon-down", false);
    const done = await askToUpdate(run, "maple", "update");
    expect(done?.tone).toBe("problem");
    expect(done?.text).toMatch(/^Docker could not run it\. .+/);
    expect(done?.text).toMatch(/daemon/i);
    expect(await askToUpdate(scripted(exit(1)).run, "maple", "update")).toEqual({ tone: "problem", text: "Docker could not run it." });
  });

  it("says the answer is not understood when exit 0 does not say the update was requested", async () => {
    for (const stdout of ["", "GP_INTERFACE=1\n", "GP_UPDATE=rollback-requested\n", "GP_UPDATE=started\n", "GP_UPDATE=\n"]) {
      expect(await askToUpdate(scripted(exit(0, stdout)).run, "maple", "update"), stdout).toEqual({ tone: "problem", text: WORDS.gpNotUnderstood });
    }
  });

  it("says Docker is not available when there is no docker, and Buzz cannot start a process when it cannot", async () => {
    expect(await askToUpdate(agent({}, { condition: "running" }, { missing: true }).run, "maple", "update")).toEqual({ tone: "problem", text: WORDS.dockerUnavailable });
    expect(await askToUpdate(scripted({ kind: "unsupported" }).run, "maple", "update")).toEqual({ tone: "problem", text: WORDS.unsupported });
  });

  it("answers nothing when the caller leaves", async () => {
    expect(await askToUpdate(scripted(undefined).run, "maple", "update")).toBeUndefined();
  });

  it("gives a slow Docker thirty seconds", async () => {
    const waited: (number | undefined)[] = [];
    const run: Runner = async (_args, timeoutMs) => (waited.push(timeoutMs), exit(0, "GP_UPDATE=requested\n"));
    await askToUpdate(run, "maple", "update");
    await askToUpdate(run, "maple", "rollback").catch(() => undefined);
    expect(waited).toEqual([30_000, 30_000]);
  });
});

describe("Roll back: `gp update rollback`", () => {
  /** An agent that has been updated, so there is a version to go back to. */
  async function updated() {
    const one = agent("update-available");
    await askToUpdate(one.run, "maple", "update");
    for (let at = 0; at < 4; at++) await statusOf(one.fake);
    expect((await statusOf(one.fake)).previous_version).toBe("0.0.0");
    return one;
  }

  it("asks for the way back inside the container, and walks the agent to the old version", async () => {
    const { fake, run, calls } = await updated();
    expect(await askToUpdate(run, "maple", "rollback")).toEqual({ tone: "ok", text: WORDS.rollbackRequested });
    expect(calls.at(-1)?.argv).toEqual(["exec", "gp-maple", "gp", "update", "rollback"]);
    const seen = [];
    for (let at = 0; at < 4; at++) {
      const status = await statusOf(fake);
      seen.push(`${status.state} ${status.version}`);
    }
    expect(seen).toEqual(["updating 0.1.1", "updating 0.1.1", "running 0.0.0", "running 0.0.0"]);
  });

  it("says there is no earlier version, when GHOST Protocol answers no-previous-version", async () => {
    const { run } = agent({});
    expect(await askToUpdate(run, "maple", "rollback")).toEqual({ tone: "info", text: WORDS.noPreviousVersion });
  });

  it("says an update is under way, when GHOST Protocol answers update-in-progress", async () => {
    const { run } = await updated();
    await askToUpdate(run, "maple", "rollback");
    expect(await askToUpdate(run, "maple", "rollback")).toEqual({ tone: "info", text: WORDS.updateInProgress });
  });

  it("says it cannot roll back from here, and not that the update goes by hand, when there is no update helper", async () => {
    const { run } = agent({ selfUpdate: "no" });
    expect(await askToUpdate(run, "maple", "rollback")).toEqual({ tone: "info", text: WORDS.noUpdaterRollback, noUpdater: true });
  });

  it("shows GHOST Protocol's message and code when the roll back fails", async () => {
    const { run } = agent({ fail: { updateRollback: true } });
    expect(await askToUpdate(run, "maple", "rollback")).toEqual({ tone: "problem", text: "The roll back could not be requested. (rollback-failed)" });
  });

  it("does not take an update's answer for a roll back's", async () => {
    expect(await askToUpdate(scripted(exit(0, "GP_UPDATE=requested\n")).run, "maple", "rollback")).toEqual({ tone: "problem", text: WORDS.gpNotUnderstood });
    expect(await askToUpdate(scripted(exit(0, "GP_UPDATE=rollback-requested\n")).run, "maple", "rollback")).toEqual({ tone: "ok", text: WORDS.rollbackRequested });
  });
});

describe("Restart and Stop: `docker restart` and `docker stop`", () => {
  it("restarts the container, and the agent comes back", async () => {
    const { fake, run, calls } = agent({}, { condition: "stopped" });
    expect(await askDocker(run, "maple", "restart")).toEqual({ tone: "ok", text: "Restarted gp-maple." });
    expect(calls.map(({ argv }) => argv)).toEqual([["restart", "gp-maple"]]);
    expect(calls.map(({ id }) => id)).toEqual(["restart"]);
    expect(fake.state().containers["gp-maple"].running).toBe(true);
  });

  it("stops the container", async () => {
    const { fake, run, calls } = agent({});
    expect(await askDocker(run, "maple", "stop")).toEqual({ tone: "ok", text: "Stopped gp-maple." });
    expect(calls.map(({ argv }) => argv)).toEqual([["stop", "gp-maple"]]);
    expect(calls.map(({ id }) => id)).toEqual(["stop"]);
    expect(fake.state().containers["gp-maple"].running).toBe(false);
  });

  it("says Docker could not do it, with the first line Docker gave, when there is no such container", async () => {
    for (const which of ["restart", "stop"] as const) {
      const { run } = agent({}, false);
      const done = await askDocker(run, "maple", which);
      expect(done?.tone).toBe("problem");
      expect(done?.text).toMatch(new RegExp(`^Docker could not ${which} gp-maple\\. .*No such container`));
    }
  });

  it("says Docker is not available when there is no docker, and Buzz cannot start a process when it cannot", async () => {
    expect(await askDocker(agent({}, { condition: "running" }, { missing: true }).run, "maple", "stop")).toEqual({ tone: "problem", text: WORDS.dockerUnavailable });
    expect(await askDocker(scripted({ kind: "unsupported" }).run, "maple", "restart")).toEqual({ tone: "problem", text: WORDS.unsupported });
  });

  it("says Docker could not do it for any exit that is not 0, whatever it printed", async () => {
    for (const which of ["restart", "stop"] as const) {
      for (const code of [1, 2, 125, 127, null]) {
        const done = await askDocker(scripted(exit(code, "gp-maple\n", "Error response from daemon: boom\n")).run, "maple", which);
        expect(done, `${which} ${code}`).toEqual({ tone: "problem", text: `Docker could not ${which} gp-maple. Error response from daemon: boom` });
      }
    }
  });

  it("answers nothing when the caller leaves, and gives Docker a minute", async () => {
    expect(await askDocker(scripted(undefined).run, "maple", "stop")).toBeUndefined();
    const waited: (number | undefined)[] = [];
    const run: Runner = async (_args, timeoutMs) => (waited.push(timeoutMs), exit(0));
    await askDocker(run, "maple", "restart");
    await askDocker(run, "maple", "stop");
    expect(waited).toEqual([60_000, 60_000]);
  });
});

describe("firstLine", () => {
  it("is the first line with something on it, trimmed", () => {
    expect(firstLine("\n  \nError response from daemon: No such container: gp-x  \nsecond\n")).toBe("Error response from daemon: No such container: gp-x");
    expect(firstLine("")).toBe("");
    expect(firstLine("  \n ")).toBe("");
  });

  it("is cut at 200 characters, with an ellipsis", () => {
    expect(firstLine("x".repeat(200))).toBe("x".repeat(200));
    expect(firstLine("x".repeat(201))).toBe(`${"x".repeat(200)}…`);
  });
});
