// Registers a plugin's committed plugin.js the way Buzz registers an installed one (the way the plugins' own test/web/fixture.tsx files
// do), for the load check (load-check.spec.mjs), which is the same for every plugin. The wrapper keeps the plugin's context as
// `window.__loadCheck.ctx`, and whether `apply` finished or why it threw, so the spec can ask the host which pages the plugin registered
// and whether the host calls it active. It changes nothing else: no stand-in for any host service, `inject` as the plugin gives it, and
// what `apply` throws is thrown on, so the host marks the plugin failed. (The web build has no native side. Its `runCommand` answers
// `null`, as the desktop app does when a command fails, and its `request` throws; no plugin here calls `request` before a person
// uses it, so none needs a stand-in. One that did would fail this check, and get one then.)
import * as plugin from "./plugin.js";
import manifest from "./manifest.json";

declare global {
  interface Window {
    __loadCheck?: { ctx?: any; applied: boolean; error?: string };
  }
}

export const loadCheckFixture = {
  manifest: { id: manifest.id, name: manifest.name, apiVersion: 1 as const },
  module: {
    inject: (plugin as any).inject,
    async apply(ctx: any) {
      const state = (window.__loadCheck = { ctx, applied: false } as NonNullable<Window["__loadCheck"]>);
      try {
        await plugin.apply(ctx);
        state.applied = true;
      } catch (error) {
        state.error = String(error);
        throw error;
      }
    },
  },
};
