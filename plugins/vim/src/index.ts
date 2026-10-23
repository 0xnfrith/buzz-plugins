// Vim mode for Buzz (a concept, built to learn what the plugin API reaches). Source of the API v1 module `plugin.js` next to the manifest:
// `pnpm build` (or `npm run build`) bundles src/ into that one file, the only thing the app loads.
//
// Every behaviour is tagged by how it reaches the app:
//   [API] the documented plugin surface (ctx.shortcuts, ctx.pages, ctx.navigation, ctx.relay, ctx.conversation).
//   [DOM] reaches into the host's markup (querySelector, focus(), a capture listener).
//         Plugins run unsandboxed in the app's own page, so this works, but it is
//         unsupported and breaks when the host's markup changes.
// NOTES.md explains what each tag means and where the API stops.
import { setContext } from "./ctx";
import { registerFocusBridge } from "./box";
import { resetCommunities } from "./communities";
import { resetCursors } from "./cursor";
import type { Context } from "./host-api";
import { mount } from "./lifecycle";
import { resetLeader } from "./leader";
import { resetMotions } from "./motions";
import { registerPage } from "./page";
import * as perf from "./perf";
import { registerShortcuts } from "./shortcuts";
import { resetState } from "./state";
import { resetVisual } from "./visual";

export const inject = ["react", "pages", "shortcuts", "navigation", "relay", "conversation"];

export function apply(ctx: Context) {
  setContext(ctx);
  // The host reuses an evaluated module when a revision is enabled again: nothing may carry over from the last run.
  resetState();
  resetCursors();
  resetMotions();
  resetVisual();
  resetLeader();
  perf.reset();
  resetCommunities();
  registerFocusBridge();
  ctx.effect(mount);
  registerShortcuts();
  registerPage();
}
