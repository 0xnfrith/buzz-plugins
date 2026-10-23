import type { Context } from "./host-api";

// The host's context for the revision that is applied now (set by apply, before anything runs).
export let ctx: Context;
export const setContext = (next: Context) => {
  ctx = next;
};
