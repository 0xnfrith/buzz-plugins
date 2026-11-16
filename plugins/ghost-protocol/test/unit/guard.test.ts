import { afterEach, describe, expect, it } from "vitest";
import { verifyContainer } from "../../src/gp/guard";
import { hostOver, makeFake, type FakeDocker } from "./support/fake-host";

// Whether `gp-<slug>` is this agent's, from what its own status says, against the fake docker.

const used: Array<{ fake: FakeDocker; stopAll(): void }> = [];
afterEach(() => {
  for (const { fake, stopAll } of used.splice(0)) {
    stopAll();
    fake.cleanup();
  }
});

function arrange(scenario: unknown = {}, seed: Parameters<FakeDocker["seed"]>[0] | false = { condition: "running", slug: "maple", name: "Maple" }, options: { missing?: boolean } = {}) {
  const fake = makeFake(scenario);
  const made = hostOver(fake, options);
  used.push({ fake, stopAll: made.stopAll });
  const agent = seed === false ? undefined : fake.seed(seed);
  return { host: made.host, calls: made.calls, agent };
}
const signal = () => new AbortController().signal;

describe("verifyContainer", () => {
  it("is ok when the container's status names the agent's key, whether or not the pair was written down", async () => {
    const { host, agent } = arrange();
    expect(await verifyContainer(host, "maple", agent!.pubkey, true, signal())).toBe("ok");
    expect(await verifyContainer(host, "maple", agent!.pubkey, false, signal())).toBe("ok");
  });

  it("is other when the status names another agent's key, even when the pair was written down", async () => {
    const { host } = arrange();
    expect(await verifyContainer(host, "maple", "b".repeat(64), true, signal())).toBe("other");
    expect(await verifyContainer(host, "maple", "b".repeat(64), false, signal())).toBe("other");
  });

  it("cannot say for a container that is stopped, missing or silent: ok for a pair that was written down, unknown for a guess", async () => {
    const cases: Array<[string, ReturnType<typeof arrange>]> = [
      ["stopped", arrange({}, { condition: "stopped", slug: "maple", name: "Maple" })],
      ["missing", arrange({}, false)],
      ["docker down", arrange("daemon-down")],
      ["unknown interface", arrange("unknown-interface")],
      ["no docker", arrange({}, { condition: "running", slug: "maple", name: "Maple" }, { missing: true })],
    ];
    for (const [name, { host, agent }] of cases) {
      const key = agent?.pubkey ?? "a".repeat(64);
      expect(await verifyContainer(host, "maple", key, true, signal()), `${name}, written`).toBe("ok");
      expect(await verifyContainer(host, "maple", key, false, signal()), `${name}, guessed`).toBe("unknown");
    }
  });

  it("asks one thing of one container: its status, through the declared `exec` process", async () => {
    const { host, calls, agent } = arrange();
    await verifyContainer(host, "maple", agent!.pubkey, true, signal());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: "process", id: "exec", argv: ["exec", "gp-maple", "gp", "status", "--json"] });
  });

  it("resolves with nothing when the caller has gone", async () => {
    const { host, agent } = arrange();
    const abort = new AbortController();
    abort.abort();
    expect(await verifyContainer(host, "maple", agent!.pubkey, true, abort.signal)).toBeUndefined();
  });
});
