// A wired plugin without Buzz: the fake service, a made-up user whose "host" attests, and the plugin's own modules. One mutable clock
// is shared by all of them, so a test can let a code or a session age without waiting.
import { createClient } from "../../src/support/client";
import { createIdentity, hostProver } from "../../src/support/identity";
import { createSupport } from "../../src/support/service";
import { createFakeHost, createFakeSupport, createUser } from "../fake-support/server.mjs";

export type Options = {
  /** How the host answers (see createFakeHost): "" is a good answer. */
  mode?: string;
  /** The host has no `prepareRemoteAgentAuthorization` at all. */
  missing?: boolean;
  signWaitMs?: number;
  /** What the plugin sees of Buzz's relay: the signed-in key. */
  viewer?: string | undefined | null;
  seed?: string;
  /** What the saved switch says; the tools and the type ask it at each call. */
  enabled?: boolean;
};

export function world(options: Options = {}) {
  const clock = { t: Date.parse("2026-10-31T12:00:00Z") };
  const now = () => clock.t;
  const fake = createFakeSupport({ now });
  const user = createUser(options.seed);
  const host = createFakeHost({ user, mode: options.mode ?? "", missing: options.missing ?? false });
  const relayState = { viewer: options.viewer === undefined ? (user.pubkey as string | undefined) : (options.viewer ?? undefined) };
  const watchers = new Set<() => void>();
  const relay = {
    snapshot: () => ({ viewer: relayState.viewer }),
    subscribe: (listener: () => void) => {
      watchers.add(listener);
      return () => void watchers.delete(listener);
    },
  };
  /** How many are watching the relay: the identity does, until the plugin goes. */
  const watching = () => watchers.size;
  /** Buzz's signed-in key changes, and whoever watches the relay is told. */
  const setViewer = (viewer: string | undefined) => {
    relayState.viewer = viewer;
    for (const watcher of [...watchers]) watcher();
  };
  const client = createClient((request) => fake.handle(request), now);
  const identity = createIdentity({ client, relay: relay as never, prove: hostProver(host), now, signWaitMs: options.signWaitMs ?? 500 });
  const support = createSupport({ client, identity });
  const flag = { on: options.enabled ?? true };
  const enabled = () => flag.on;
  return { clock, fake, user, host, relay, relayState, setViewer, watching, client, identity, support, flag, enabled };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
