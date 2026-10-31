// Registers the built plugin the way Buzz registers an installed one, with two changes: the
// web build has no native HTTP client, so `ctx.host.request` throws there ("Host requests
// require an installed desktop plugin"), and no native command runner either. The spec
// exposes the fake Linear as `window.__linearRequest` and a runner of the manifest's own
// commands (the stand-in `security`, test/host-sim.mjs) as `window.__linearRun`, and this
// wrapper points the host's `request` and `runCommand` at them. Nothing in the plugin knows
// the difference.
import * as linear from "./plugin.js";
import manifest from "./manifest.json";

declare global {
  interface Window {
    __linearRequest?: (request: unknown) => Promise<unknown>;
    __linearRun?: (command: string, input?: string) => Promise<string | null>;
  }
}

export const linearFixture = {
  manifest: { id: manifest.id, name: manifest.name, apiVersion: 1 as const },
  module: {
    inject: linear.inject,
    apply(ctx: any) {
      ctx.host.request = (request: unknown) => {
        if (!window.__linearRequest) throw new Error("fixture: __linearRequest is not exposed");
        return window.__linearRequest(request);
      };
      ctx.host.runCommand = (command: string, input?: string) => {
        if (!window.__linearRun) throw new Error("fixture: __linearRun is not exposed");
        return window.__linearRun(command, input);
      };
      return linear.apply(ctx);
    },
  },
};
