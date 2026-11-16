// Shared by the unit tests of the create flow: the host's `spawn` made out of the fake `docker`, and the flow's other inputs.
import type { Deps } from "../../src/gp/flow";
import type { ProcessId } from "../../src/docker";
import { versionOf } from "../../src/docker";
import manifest from "../../manifest.json" with { type: "json" };
import { DECLARED, lineOf } from "../../src/gp/processes";
import { createProgress, createSecrets, type Progress, type Secrets } from "../../src/gp/progress";
import type { Proc, StartDocker } from "../../src/gp/run";
import { attestationTag, createFakeDocker, ownerKey, type FakeDocker, type ScenarioInput } from "../fake-docker/index.mjs";

/** The made-up secrets of a test. The tests search every place the plugin writes to for them. */
export const TOKEN = "sk-ant-oat01-MADE-UP-TOKEN-1234567890";
export const CODE = "MADE-UP-LOGIN-CODE-9876";

export const OWNER = ownerKey("owner");
export const RELAY = "wss://relay.example.com";
export const SIGNAL = new AbortController().signal;

/** `start` for the flow: runs the fake once for each command, as the host runs `docker`, streaming its output. */
export function startFrom(fake: FakeDocker): StartDocker {
  return async (command, { onStdout, onStderr }) => {
    // The host starts `docker` with the declared words and then the call's own: the fake gets the whole line.
    const running = fake.start(lineOf(command));
    running.child.stdout.on("data", (chunk: string) => onStdout(chunk));
    running.child.stderr.on("data", (chunk: string) => onStderr(chunk));
    const proc: Proc = {
      write: async (data) => void running.write(data),
      end: async (data) => {
        if (data !== undefined) running.write(data);
        running.end();
      },
      kill: async () => void running.kill(),
      exited: running.exited.then((result: { code: number | null }) => result.code),
    };
    return proc;
  };
}

export type Rig = {
  fake: FakeDocker;
  deps: Deps;
  progress: Progress;
  secrets: Secrets;
  /** The fake's clock: `sleep` only moves it. */
  clock: { now: number };
  slept: number[];
  cleanup(): void;
};

export function rig(scenario: ScenarioInput = "ok", options: { dockerMissing?: boolean } = {}): Rig {
  const fake = createFakeDocker({ scenario });
  const progress = createProgress();
  const secrets = createSecrets();
  const clock = { now: 1_000_000 };
  const slept: number[] = [];
  const deps: Deps = {
    start: startFrom(fake),
    // The plugin's check of Docker, as the host would run it: `docker version --format {{.Server.Version}}`.
    checkDocker: async () => {
      if (options.dockerMissing) return { state: "unavailable" };
      const ran = await fake.run(["version", "--format", "{{.Server.Version}}"]);
      const version = ran.code === 0 ? versionOf(ran.stdout) : undefined;
      return version === undefined ? { state: "unavailable" } : { state: "ready", version };
    },
    progress,
    token: () => secrets.token(),
    clearToken: () => secrets.clear(),
    sleep: async (ms) => {
      slept.push(ms);
      clock.now += ms;
    },
    now: () => clock.now,
  };
  return { fake, deps, progress, secrets, clock, slept, cleanup: () => fake.cleanup() };
}

export const authOf = (owner = OWNER): string[] => JSON.parse(attestationTag(owner)) as string[];

export { attestationTag, ownerKey };

/**
 * The host's `spawn` made out of the fake: it takes a declared process id and the caller's arguments, which follow the declared ones, as
 * the real host builds the command line. A process the manifest does not declare is refused, as the host refuses it.
 */
export function hostFrom(fake: FakeDocker) {
  const start = startFrom(fake);
  const calls: Array<{ id: string; args: readonly string[]; onHost: boolean }> = [];
  const host = {
    /** What the real host does for a declared command: run it with its fixed arguments, and answer its stdout when it ended with 0, else null. */
    async runCommand(this: unknown, id: string): Promise<string | null> {
      const declared = manifest.host.commands.find((command) => command.id === id);
      if (this !== host || declared === undefined) throw new Error(`command ${id} is not available`);
      calls.push({ id, args: [], onHost: true });
      const ran = await fake.run([...declared.args]);
      return ran.code === 0 ? ran.stdout : null;
    },
    // A method: the real host's `spawn` reads the calling plugin from its receiver, so a call that leaves `host` would not work there.
    spawn(this: unknown, id: string, options: { args?: readonly string[]; onStdout(data: string): void; onStderr(data: string): void }) {
      calls.push({ id, args: options.args ?? [], onHost: this === host });
      if (!(id in DECLARED)) return Promise.reject(new Error(`process ${id} is not declared`));
      return start({ process: id as ProcessId, args: options.args ?? [] }, options);
    },
  };
  return { calls, host };
}
