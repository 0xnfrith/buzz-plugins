// Registers the plugin the way Buzz registers an installed one, with one change: the web build has no native command runner, so the
// plugin's `ctx.host.runCommand` is pointed at a function the spec exposes (`window.__skillsRun`), which stands in for the one
// declared program. Nothing in the plugin knows the difference.
import * as skills from "./plugin.js";
import manifest from "./manifest.json";

declare global {
  interface Window {
    __skillsRun?: (command: string, input?: string) => Promise<string | null>;
  }
}

export const skillsFixture = {
  manifest: { id: manifest.id, name: manifest.name, apiVersion: 1 as const },
  module: {
    inject: skills.inject,
    apply(ctx: any) {
      ctx.host.runCommand = (command: string, input?: string) => {
        if (!window.__skillsRun) throw new Error("fixture: __skillsRun is not exposed");
        return window.__skillsRun(command, input);
      };
      return skills.apply(ctx);
    },
  },
};
