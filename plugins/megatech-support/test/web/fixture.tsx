// Registers the built plugin the way Buzz registers an installed one, with these changes, each because the web build lacks what the
// desktop app has:
//  - `ctx.host.request` throws there ("Host requests require an installed desktop plugin"): the spec exposes the fake service as
//    `window.__supportRequest`, and this wrapper points the host's `request` at it;
//  - the host's attestation call reaches the harness's broker, which does not serve it, and the spec cannot sign as the harness's user:
//    the spec exposes a fake host as `window.__supportAuthorize` (a made-up user, signing for real), and the plugin is given that
//    user's key as the signed-in one (`window.__supportViewer`), so the owner in the attestation is the viewer the plugin sees;
//  - the wrapper keeps the context as `window.__supportCtx` so the spec can read the agent tools and types.
// Nothing in the plugin knows the difference.
import * as support from "./plugin.js";
import manifest from "./manifest.json";

declare global {
  interface Window {
    __supportRequest?: (request: unknown) => Promise<unknown>;
    __supportAuthorize?: (agent: string) => Promise<unknown>;
    __supportViewer?: string;
    __supportHostMissing?: boolean;
    __supportCtx?: unknown;
  }
}

export const supportFixture = {
  manifest: { id: manifest.id, name: manifest.name, apiVersion: 1 as const },
  module: {
    inject: support.inject,
    apply(ctx: any) {
      ctx.host.request = (request: unknown) => {
        if (!window.__supportRequest) throw new Error("fixture: __supportRequest is not exposed");
        return window.__supportRequest(request);
      };
      ctx.host.prepareRemoteAgentAuthorization = window.__supportHostMissing
        ? undefined
        : (agent: string) => {
            if (!window.__supportAuthorize) throw new Error("fixture: __supportAuthorize is not exposed");
            return window.__supportAuthorize(agent);
          };
      window.__supportCtx = ctx;
      // The plugin sees the made-up user as signed in; everything else of Buzz's context is the real one.
      const relay = {
        snapshot: () => ({ ...ctx.relay.snapshot(), viewer: window.__supportViewer }),
        subscribe: (listener: () => void) => ctx.relay.subscribe(listener),
      };
      const seen = new Proxy(ctx, {
        get(target, property) {
          if (property === "relay") return relay;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return support.apply(seen);
    },
  },
};
