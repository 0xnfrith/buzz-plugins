// A stand-in for Buzz's `host.spawn` that runs the fake `docker` (test/fake-docker) as a real process, the way the desktop app runs the
// declared one: only a process the manifest declares, started as `docker`, the arguments the manifest fixes for it, and then the
// caller's. Every call is recorded, so a test can see exactly which process and arguments the plugin asked for.
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Host, HostProcess, SpawnOptions } from "../../../src/buzz";
import type { Call as PluginCall } from "../../../src/docker";
import manifest from "../../../manifest.json" with { type: "json" };
// @ts-expect-error the fake is plain JavaScript with its own types, which the plugin's type check does not include
import { createFakeDocker } from "../../fake-docker/index.mjs";

export type FakeDocker = ReturnType<typeof import("../../fake-docker/index.mjs").createFakeDocker>;
export const makeFake = (scenario: unknown = {}): FakeDocker => (createFakeDocker as (options: unknown) => FakeDocker)({ scenario });

type Declared = { id: string; program: string; args?: string[] };
const declaration = (id: string) => (manifest.host.processes as Declared[]).find((process) => process.id === id);

/** The whole command line `docker` gets for a call: the arguments the manifest fixes for its process, then the call's own. */
export const argvOf = (call: PluginCall): string[] => [...(declaration(call.process)?.args ?? []), ...call.args];

/** `kind` says whether the plugin started a declared process or ran a declared command. */
export type Call = { kind: "process" | "command"; id: string; args: readonly string[]; argv: string[]; optionKeys: string[] };

/**
 * `missing`: there is no `docker` to start (the host's `spawn` rejects, as when a program is not on the PATH).
 * `calls` is filled as the plugin makes calls: its process id, the arguments it gave, and the whole command line (`argv`).
 */
export function hostOver(fake: FakeDocker, { missing = false }: { missing?: boolean } = {}) {
  const calls: Call[] = [];
  const running = new Set<ReturnType<typeof spawn>>();
  const host: Host = {
    /** What the real host does: the declared command, run with its fixed arguments, and its stdout if it ended with 0, and null otherwise. */
    async runCommand(this: unknown, id: string, input?: string): Promise<string | null> {
      if (this !== host) throw new Error("runCommand must be called on the host");
      const declared = (manifest.host.commands as Declared[]).find((command) => command.id === id);
      if (declared === undefined) throw new Error(`command ${id} is not declared`);
      calls.push({ kind: "command", id, args: [], argv: [...(declared.args ?? [])], optionKeys: input === undefined ? [] : ["input"] });
      if (missing) return null;
      const child = spawn(join(fake.binDir, declared.program), declared.args ?? [], { env: fake.env(), stdio: ["ignore", "pipe", "pipe"] });
      running.add(child);
      let stdout = "";
      child.stdout.setEncoding("utf8").on("data", (text: string) => (stdout += text));
      const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
      running.delete(child);
      return code === 0 ? stdout : null;
    },
    async spawn(this: unknown, id: string, options: SpawnOptions = {}): Promise<HostProcess> {
      if (this !== host) throw new Error("spawn must be called on the host");
      const declared = declaration(id);
      if (declared === undefined) throw new Error(`process ${id} is not declared`);
      const argv = [...(declared.args ?? []), ...(options.args ?? [])];
      calls.push({ kind: "process", id, args: [...(options.args ?? [])], argv, optionKeys: Object.keys(options).sort() });
      if (missing) throw new Error("program not found: docker");
      const child = spawn(join(fake.binDir, declared.program), argv, { env: fake.env(), stdio: ["ignore", "pipe", "pipe"] });
      running.add(child);
      child.stdout.setEncoding("utf8").on("data", (text: string) => options.onStdout?.(text));
      child.stderr.setEncoding("utf8").on("data", (text: string) => options.onStderr?.(text));
      const exited = new Promise<number | null>((resolve) =>
        child.on("close", (code) => {
          running.delete(child);
          resolve(code);
        }),
      );
      return { exited, kill: async () => void child.kill("SIGTERM") };
    },
  };
  return { host, calls, stopAll: () => running.forEach((child) => child.kill("SIGKILL")) };
}
