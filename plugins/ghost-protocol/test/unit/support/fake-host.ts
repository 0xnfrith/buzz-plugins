// A stand-in for Buzz's `host.spawn` that runs the fake `docker` (test/fake-docker) as a real process, the way the desktop app runs the
// declared one: only the process the manifest declares, with the caller's arguments after the declared ones (none). Every call is
// recorded, so a test can see exactly which arguments the plugin asked for.
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Host, HostProcess, SpawnOptions } from "../../../src/buzz";
import manifest from "../../../manifest.json" with { type: "json" };
// @ts-expect-error the fake is plain JavaScript with its own types, which the plugin's type check does not include
import { createFakeDocker } from "../../fake-docker/index.mjs";

export type FakeDocker = ReturnType<typeof import("../../fake-docker/index.mjs").createFakeDocker>;
export const makeFake = (scenario: unknown = {}): FakeDocker => (createFakeDocker as (options: unknown) => FakeDocker)({ scenario });

export type Call = { id: string; args: readonly string[]; optionKeys: string[] };

/**
 * `missing`: there is no `docker` to start (the host's `spawn` rejects, as when a program is not on the PATH).
 * `calls` is filled as the plugin makes calls.
 */
export function hostOver(fake: FakeDocker, { missing = false }: { missing?: boolean } = {}) {
  const calls: Call[] = [];
  const running = new Set<ReturnType<typeof spawn>>();
  const host: Host = {
    async spawn(this: unknown, id: string, options: SpawnOptions = {}): Promise<HostProcess> {
      if (this !== host) throw new Error("spawn must be called on the host");
      if (!manifest.host.processes.some((process) => process.id === id)) throw new Error(`process ${id} is not declared`);
      const declared = manifest.host.processes.find((process) => process.id === id) as { args?: string[] };
      calls.push({ id, args: [...(options.args ?? [])], optionKeys: Object.keys(options).sort() });
      if (missing) throw new Error("program not found: docker");
      const child = spawn(join(fake.binDir, "docker"), [...(declared.args ?? []), ...(options.args ?? [])], { env: fake.env(), stdio: ["ignore", "pipe", "pipe"] });
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
