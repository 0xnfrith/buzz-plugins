// Registers the built plugin the way Buzz registers an installed one, with one change, because the web build lacks what the desktop app
// has: `ctx.host.spawn` throws there ("Processes require an installed desktop plugin"). This wrapper points `spawn` at a stub that
// the spec scripts through `window.__gp`: each call takes the next scripted behaviour (what `docker` prints, how it exits, whether the
// program is missing, or whether it waits to be released) and is recorded. Nothing in the plugin knows the difference. The wrapper keeps
// the host's own rule from src/features/host/service.ts: a plugin's processes end with the plugin.
import * as plugin from "./plugin.js";
import manifest from "./manifest.json";

type Behaviour = { stdout?: string; stderr?: string; code?: number | null; reject?: string; hold?: boolean };
type Call = { id: string; options: string[]; onHost: boolean; declared: boolean };

declare global {
  interface Window {
    __gp?: {
      /** What the next spawns do, in order; `fallback` after that. */
      script: Behaviour[];
      fallback: Behaviour;
      calls: Call[];
      kills: number;
      /** Lets a held process print and exit. */
      release(): void;
      /** "no-spawn": a host that has no `spawn` at all. */
      mode?: string;
    };
  }
}

export const ghostProtocolFixture = {
  manifest: { id: manifest.id, name: manifest.name, apiVersion: 1 as const },
  module: {
    inject: plugin.inject,
    apply(ctx: any) {
      const gp = window.__gp;
      if (!gp) throw new Error("fixture: window.__gp is not set");
      // The plugin is given one stable stand-in for `host`, with only what it uses of it, so that a call can be checked to be a method call
      // on the very object the plugin was given (Buzz hands out a new object for each `ctx.host`, so the real one cannot be compared).
      const host: { spawn?: (...args: any[]) => Promise<unknown> } = {};
      if (gp.mode !== "no-spawn") {
        host.spawn = function (this: unknown, id: string, options: Record<string, any> = {}) {
          const declared = manifest.host.processes.some((process) => process.id === id);
          gp.calls.push({ id, options: Object.keys(options).sort(), onHost: this === host, declared });
          const behaviour = gp.script.shift() ?? gp.fallback;
          if (behaviour.reject) return Promise.reject(new Error(behaviour.reject));
          let exit!: (code: number | null) => void;
          const exited = new Promise<number | null>((resolve) => (exit = resolve));
          const finish = () => {
            if (behaviour.stderr) options.onStderr?.(behaviour.stderr);
            if (behaviour.stdout) options.onStdout?.(behaviour.stdout);
            exit(behaviour.code === undefined ? 0 : behaviour.code);
          };
          if (behaviour.hold) gp.release = finish;
          else setTimeout(finish, 0);
          const kill = async () => {
            gp.kills += 1;
            exit(null);
          };
          // "The plugin's processes end with it, including one that started as it was unloading."
          ctx.effect(() => () => void kill());
          return Promise.resolve(Object.freeze({ kill, exited }));
        };
      }
      const seen = new Proxy(ctx, {
        get(target, property) {
          if (property === "host") return host;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return plugin.apply(seen);
    },
  },
};
