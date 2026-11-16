// The part of Buzz's agent-type API this plugin uses, trimmed from block/buzz-app at 51d63954 (v1.0.2: src/features/agents/service.ts,
// `AgentType`, `RemoteAgentType` and `AgentCreateProps`; src/features/relay/session.ts for the session's `viewer`), the commit the browser
// tests run on. Block ships the full types as a preview package built from its own repository; this copy keeps the build reproducible
// from this repository alone.
import type * as ReactNamespace from "react";

/** The owner's attestation (NIP-OA): `["auth", <owner public key, 64 hex>, <conditions>, <signature, 128 hex>]`. */
export type NipOaAuthorization = readonly [string, string, string, string];

/**
 * A hosted type's provider: it holds each agent's key and runs it. Buzz calls `provision`, then `activate`, to create one, and asks
 * again after a failure, so each must be safe to repeat. `community` is the agent's `wss://` community.
 */
export type RemoteAgentType = Readonly<{
  /** Makes the agent and resolves with its public key. Not yet its owner's. */
  provision(input: Readonly<{ name: string; picture?: string; community: string; config?: unknown; signal: AbortSignal }>): Promise<Readonly<{ pubkey: string; picture?: string }>>;
  /** Hands over the owner's attestation and starts the agent. */
  activate(input: Readonly<{ pubkey: string; name: string; community: string; auth: NipOaAuthorization; config?: unknown; signal: AbortSignal }>): Promise<void>;
  /** Publishes the agent's profile with this name and picture. */
  profile(input: Readonly<{ pubkey: string; community: string; name: string; picture?: string; signal: AbortSignal }>): Promise<void>;
  /** Stops it and deletes its key. An agent already gone counts as removed. */
  remove(input: Readonly<{ pubkey: string; community: string; signal: AbortSignal }>): Promise<void>;
}>;

/** What a type's part of the New agent dialog receives. The app owns the key, name and picture around it. */
export type AgentCreateProps<Config> = {
  config: Config;
  onChange(config: Config, options?: { suggested?: boolean }): void;
  /** True while Create is working. */
  disabled: boolean;
};

export type AgentType<Config> = {
  id: string;
  title: string;
  description?: string;
  /** A new agent's starting config. */
  defaults(): Readonly<{ config: Config }>;
  /** One short line under the agent's name. */
  summary?(agent: { config?: Config }): string;
  /** The type's choices in the New agent dialog. */
  Create?: ReactNamespace.ComponentType<AgentCreateProps<Config>>;
  /**
   * The type places the host's Harness row (`harnessControl`) beside its own controls. Report readiness of the displayed choices through
   * `onReadyChange`: the dialog holds Create back until it is true.
   */
  CreateConfiguration?: ReactNamespace.ComponentType<AgentCreateProps<Config> & { harnessControl: ReactNamespace.ReactNode; onReadyChange?: (ready: boolean) => void }>;
  /** Makes the type hosted: its provider runs each agent. */
  remote: RemoteAgentType;
};

/** What a tab is given of an agent: its public key, its name and its type's key (`<plugin id>/<type id>`). */
export type TabAgent = Readonly<{ pubkey: string; name: string; type: string }>;

/** A tab added to the settings of agents, after Activity and before History and Settings. */
export type AgentTab = Readonly<{
  id: string;
  title: string;
  component: ReactNamespace.ComponentType<{ agent: TabAgent }>;
  /** Whether the tab shows for this agent. */
  when?: (agent: TabAgent) => boolean;
}>;

export type Agents = {
  register<Config>(type: AgentType<Config>): void;
  registerTab(tab: AgentTab): void;
};

/** `ctx.relay.snapshot()`: the session for the community the person is in, once it is ready. */
export type RelaySnapshot = Readonly<{ status: string; session?: Readonly<{ viewer?: string }> }>;

export type Relay = {
  snapshot(): RelaySnapshot;
};
