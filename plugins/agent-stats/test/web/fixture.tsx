// Registers the plugin the way Buzz registers an installed one. Nothing is changed: the plugin runs against the web build's real
// relay service, agents service and pages. The wrapper only keeps the context as `window.__statsCtx`, so the spec can ask the host
// which agent tabs are registered.
import * as stats from "./plugin.js";
import manifest from "./manifest.json";

declare global {
  interface Window {
    __statsCtx?: any;
  }
}

export const statsFixture = {
  manifest: { id: manifest.id, name: manifest.name, apiVersion: 1 as const },
  module: {
    inject: stats.inject,
    apply(ctx: any) {
      window.__statsCtx = ctx;
      return stats.apply(ctx);
    },
  },
};
