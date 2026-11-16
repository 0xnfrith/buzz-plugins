// Registers the built plugin the way Buzz registers an installed one, with one change, because the web build lacks what the desktop app
// has: `ctx.host.spawn` throws there ("Processes require an installed desktop plugin"). This wrapper points `spawn` at a stub that
// the spec drives through `window.__gp`, in one of two ways, and records each call. Nothing in the plugin knows the difference. The
// wrapper keeps the host's own rule from src/features/host/service.ts: a plugin's processes end with the plugin.
//   scripted  each call takes the next scripted behaviour: what `docker` prints, how it exits, whether the program is missing, or
//             whether it waits to be released (the spec's `script` and `fallback`).
//   fake      with `window.__gp.fake` set, each call is handed to `window.__gpDocker(argv)`, which the spec exposes from Node and which
//             runs the fake `docker` (test/fake-docker) as a process there. What the plugin reads is what the fake printed.
import * as plugin from "./plugin.js";
import manifest from "./manifest.json";

type Behaviour = { stdout?: string; stderr?: string; code?: number | null; reject?: string; hold?: boolean };
/** `args` are the call's own; `argv` is the whole command line `docker` gets: the words the manifest fixes for the process, then `args`. */
type Call = { id: string; options: string[]; args: string[]; argv: string[]; onHost: boolean; declared: boolean };
type Ran = { stdout: string; stderr: string; code: number | null };

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
      /** "no-spawn": a host that has no `spawn` at all. "missing": a host whose `spawn` fails, as when there is no `docker` to start. */
      mode?: string;
      /** Hand each call to `window.__gpDocker` instead of the script. */
      fake?: boolean;
    };
    /** Exposed by the spec: runs the fake `docker` with these arguments, in Node. */
    __gpDocker?: (argv: string[]) => Promise<Ran>;
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
          const fixed: string[] = (manifest.host.processes.find((process) => process.id === id) as { args?: string[] } | undefined)?.args ?? [];
          const argv = [...fixed, ...(options.args ?? [])];
          gp.calls.push({ id, options: Object.keys(options).sort(), args: [...(options.args ?? [])], argv, onHost: this === host, declared });
          if (gp.mode === "missing") return Promise.reject(new Error("program not found"));
          const behaviour = gp.fake ? {} : (gp.script.shift() ?? gp.fallback);
          if (behaviour.reject) return Promise.reject(new Error(behaviour.reject));
          let exit!: (code: number | null) => void;
          const exited = new Promise<number | null>((resolve) => (exit = resolve));
          let ended = false;
          const finish = () => {
            if (ended) return;
            ended = true;
            if (behaviour.stderr) options.onStderr?.(behaviour.stderr);
            if (behaviour.stdout) options.onStdout?.(behaviour.stdout);
            exit(behaviour.code === undefined ? 0 : behaviour.code);
          };
          if (gp.fake) {
            // The fake runs in Node; its output is delivered when it ends, unless the plugin has stopped the process by then.
            void window.__gpDocker!(argv).then((ran) => {
              if (ended) return;
              ended = true;
              if (ran.stderr) options.onStderr?.(ran.stderr);
              if (ran.stdout) options.onStdout?.(ran.stdout);
              exit(ran.code);
            });
          } else if (behaviour.hold) gp.release = finish;
          else setTimeout(finish, 0);
          const kill = async () => {
            gp.kills += 1;
            ended = true;
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
