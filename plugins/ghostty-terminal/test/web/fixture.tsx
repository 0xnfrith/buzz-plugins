// Registers the built plugin the way Buzz registers an installed one, with one change, because the web build lacks what the desktop app
// has: `ctx.host.spawn` throws there ("Processes require an installed desktop plugin"). The spec exposes a host simulator (test/host-sim.mjs,
// which starts the real process the manifest declares) as `window.__ghostty*`, and this wrapper points `spawn` at it. Nothing in the plugin
// knows the difference. The wrapper keeps the host's own rule from src/features/host/service.ts: a plugin's processes end with the plugin.
import * as plugin from "./plugin.js";
import manifest from "./manifest.json";

declare global {
  interface Window {
    __ghosttySpawn?: (handle: number, id: string, options: unknown) => Promise<void>;
    __ghosttyWrite?: (handle: number, data: string, close: boolean) => Promise<void>;
    __ghosttyKill?: (handle: number) => Promise<void>;
    __ghosttyEmit?: (handle: number, kind: "stdout" | "stderr" | "exit", payload: string | number | null) => void;
  }
}

type Listener = { onStdout?: (text: string) => void; onStderr?: (text: string) => void; exit: (code: number | null) => void };
const listeners = new Map<number, Listener>();
let serial = 0;

// The simulator pushes output here, in order.
window.__ghosttyEmit = (handle, kind, payload) => {
  const listener = listeners.get(handle);
  if (!listener) return;
  if (kind === "stdout") listener.onStdout?.(payload as string);
  else if (kind === "stderr") listener.onStderr?.(payload as string);
  else listener.exit(payload as number | null);
};

export const ghosttyFixture = {
  manifest: { id: manifest.id, name: manifest.name, apiVersion: 1 as const },
  module: {
    inject: plugin.inject,
    apply(ctx: any) {
      ctx.host.spawn = async (id: string, { onStdout, onStderr, ...options }: any = {}) => {
        if (!window.__ghosttySpawn || !window.__ghosttyWrite || !window.__ghosttyKill) throw new Error("fixture: the host simulator is not exposed");
        const handle = ++serial;
        let exit!: (code: number | null) => void;
        const exited = new Promise<number | null>((resolve) => (exit = resolve));
        listeners.set(handle, { onStdout, onStderr, exit });
        try {
          // Functions cannot cross to the simulator; a plain copy of the rest of the options does.
          await window.__ghosttySpawn(handle, id, JSON.parse(JSON.stringify(options)));
        } catch (error) {
          listeners.delete(handle);
          throw error;
        }
        const kill = () => window.__ghosttyKill!(handle).catch(() => undefined);
        // "The plugin's processes end with it, including one that started as it was unloading."
        let release: () => void;
        try {
          release = ctx.effect(() => () => void kill(), `process ${id}`);
        } catch (error) {
          void kill();
          throw error;
        }
        void exited.then(() => {
          release();
          listeners.delete(handle);
        });
        return Object.freeze({
          write: (data: string) => window.__ghosttyWrite!(handle, data, false),
          end: (data = "") => window.__ghosttyWrite!(handle, data, true),
          kill,
          exited,
        });
      };
      return plugin.apply(ctx);
    },
  },
};
