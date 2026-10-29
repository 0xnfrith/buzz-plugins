// Registers the built plugin the way Buzz registers an installed one, with one change: the
// web build has no native HTTP client, so `ctx.host.request` throws there ("Host requests
// require an installed desktop plugin"). The spec exposes the fake Linear as
// `window.__linearRequest`, and this wrapper points the host's `request` at it. Nothing in
// the plugin knows the difference.
import * as linear from "./plugin.js";
import manifest from "./manifest.json";

declare global {
  interface Window {
    __linearRequest?: (request: unknown) => Promise<unknown>;
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
      return linear.apply(ctx);
    },
  },
};
