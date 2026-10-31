import type * as ReactNamespace from "react";

// Buzz supplies React at run time (`ctx.react`); a plugin cannot import it. `apply` sets
// this once, before any component renders, and the classic JSX transform reads it as the
// live binding `React`.
export let React: typeof ReactNamespace;

export function provideReact(react: typeof ReactNamespace): void {
  React = react;
}
