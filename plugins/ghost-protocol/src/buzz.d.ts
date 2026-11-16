// The part of Buzz's plugin API this plugin uses, trimmed from block/buzz-app at 51d63954 (v1.0.2: src/features/host/service.ts for
// `runCommand` and `spawn`, src/features/pages/service.ts for `pages`), the commit the browser tests run on. Block ships the full types as a preview
// package built from its own repository; this copy keeps the build reproducible from this repository alone.
import type * as ReactNamespace from "react";

/** What `spawn` takes of its options. `args` follow the arguments the manifest fixes for the process. */
export type SpawnOptions = Readonly<{
  args?: readonly string[];
  onStdout?(data: string): void;
  onStderr?(data: string): void;
}>;

export type HostProcess = Readonly<{
  /** Writes to its stdin. */
  write(data: string): Promise<void>;
  /** Writes any final `data`, then closes its stdin. */
  end(data?: string): Promise<void>;
  /** Asks it to stop, then kills it and its descendants. */
  kill(): Promise<void>;
  /** The exit code once it exits; null when a signal ended it. */
  exited: Promise<number | null>;
}>;

export type Host = {
  /**
   * Runs a command the manifest declares in `host.commands`, whose arguments are all fixed there, and resolves with its stdout. It
   * resolves with null when anything went wrong (no such program, a non-zero exit, no answer in 5 seconds, more output than it declares,
   * or a Buzz that is not the desktop app), and never says which. A method: call it on `host`.
   */
  runCommand?: (id: string, input?: string) => Promise<string | null>;
  /** Starts a process the manifest declares in `host.processes`. Desktop only. A method: call it on `host`. */
  spawn?: (id: string, options?: SpawnOptions) => Promise<HostProcess>;
};

export type PageProps = Readonly<Record<string, unknown>>;

export type Page = Readonly<{
  id: string;
  title: string;
  /** A `data:image/<subtype>[;params],<payload>` URL shown beside the page in search and navigation. */
  icon?: string;
  component: ReactNamespace.ComponentType<PageProps>;
  layout?: "document" | "workspace";
  primary?: boolean;
}>;

export type Context = {
  react: typeof ReactNamespace;
  host: Host;
  pages: { register(page: Page): void };
  /** Runs `setup` now and its returned cleanup when the plugin's scope ends (disabled, updated, or Buzz closing). */
  effect(setup: () => void | (() => void)): void;
};
