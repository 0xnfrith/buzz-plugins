// Registers the built plugin the way Buzz registers an installed one, with one change: the
// web build has no native command runner, so `ctx.host.runCommand` throws there. The spec
// exposes `window.__beeperRun`, which runs the real curl with the manifest's own arguments
// (test/host-sim.mjs), and this wrapper points the host's `runCommand` at it. Nothing in the
// plugin knows the difference.
import * as beeper from "./plugin.js";
import manifest from "./manifest.json";

declare global {
  interface Window {
    __beeperRun?: (command: string, input?: string) => Promise<string | null>;
  }
}

export const beeperFixture = {
  manifest: { id: manifest.id, name: manifest.name, apiVersion: 1 as const },
  module: {
    inject: beeper.inject,
    apply(ctx: any) {
      ctx.host.runCommand = (command: string, input?: string) => {
        if (!window.__beeperRun) throw new Error("fixture: __beeperRun is not exposed");
        return window.__beeperRun(command, input);
      };
      return beeper.apply(ctx);
    },
  },
};
