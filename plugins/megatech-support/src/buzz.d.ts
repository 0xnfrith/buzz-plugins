// The part of Buzz's plugin API this plugin uses, trimmed from block/buzz-app at the commit the browser tests run against
// (d92bfb2c: src/plugins/author.ts, src/features/{host,pages,settings,agents,relay}/service.ts, src/buzz-mcp/session-tools.ts). Block ships
// the full types as a preview package built from its own repository; this copy keeps the build reproducible from this repository alone.
// Update it with the host it was written against.
import type * as ReactNamespace from "react";

export type HostRequest = Readonly<{
  url: string;
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Readonly<Record<string, string>>;
  body?: string;
}>;

export type HostResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}>;

export type Host = HostSigner & {
  request(input: HostRequest): Promise<HostResponse>;
};

/**
 * The host's call for the signed-in user's owner attestation (NIP-OA): `["auth", owner, "", sig]`, a signature by the user's key over
 * `sha256("nostr:agent-auth:" + agentPubkey + ":")`. Optional in Buzz's own type, so a host without it is handled. It takes no
 * conditions: the host always signs with empty ones.
 */
export type HostSigner = {
  prepareRemoteAgentAuthorization?: (agentPubkey: string, signal?: AbortSignal) => Promise<unknown>;
};

export type RelaySnapshot = Readonly<{
  /** The signed-in user's public key (64 hex), once Buzz knows it. */
  viewer?: string;
}>;

export type RelayData = {
  snapshot(): RelaySnapshot;
  subscribe(listener: () => void): () => void;
};

export type PageProps = Readonly<Record<string, unknown>>;

export type Page = Readonly<{
  id: string;
  title: string;
  component: ReactNamespace.ComponentType<PageProps>;
  layout?: "document" | "workspace";
  primary?: boolean;
  placement?: "sidebar" | "topbar" | "toolbar";
}>;

export type SettingsCard = Readonly<{
  id: string;
  title: string;
  group?: string;
  component: ReactNamespace.ComponentType<{ active(): boolean }>;
}>;

/** What an agent type's `run` gets of one run. Only the parts this plugin reads. */
export type Delivery = Readonly<{
  trigger: Readonly<{ type: string; event?: Readonly<{ id: string; pubkey: string; content: string; tags: readonly (readonly string[])[] }> }>;
  channelId?: string;
  agent: Readonly<{
    pubkey: string;
    owner: string;
    publish(event: Readonly<{ kind: number; content: string; tags?: readonly (readonly string[])[] }>): Promise<unknown>;
  }>;
  /** The plugin declined this request. */
  ignored?(): void;
  signal: AbortSignal;
}>;

export type AgentType = Readonly<{
  id: string;
  title: string;
  description?: string;
  defaults(): Readonly<{ config: Readonly<Record<string, never>> }>;
  run?(delivery: Delivery): void | Promise<void>;
}>;

/** The agent a tool runs as. `pubkey` names it, and `owner` is the owner Buzz records for it (absent when it does not know). */
export type BuzzClient = Readonly<{ pubkey: string; owner?: string | undefined }>;

export type AddedTool = Readonly<{
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  /** Runs it as the agent working in a conversation: any agent of the user's. A throw is a tool error for the agent to correct. */
  call(client: BuzzClient, context: Readonly<Record<string, unknown>>, args: Record<string, unknown>): Promise<string>;
}>;

export type Agents = {
  register(type: AgentType): void;
  addTool(tool: AddedTool): void;
};

export type Context = {
  react: typeof ReactNamespace;
  host: Host;
  relay: RelayData;
  agents: Agents;
  navigation: { open(target: { version: 1; kind: "settings"; section?: string }): Promise<unknown> };
  pages: { register(page: Page): void };
  settingsCards: { register(card: SettingsCard): void };
  /** Runs `setup` now and its returned cleanup when the plugin's scope ends. */
  effect(setup: () => () => void): void;
};

// The classic JSX transform names the factory `React`, which here is a value, not the
// namespace TypeScript looks the JSX types up in. Point it at @types/react's.
declare global {
  namespace JSX {
    type Element = ReactNamespace.JSX.Element;
    type ElementClass = ReactNamespace.JSX.ElementClass;
    type LibraryManagedAttributes<C, P> = ReactNamespace.JSX.LibraryManagedAttributes<C, P>;
    interface ElementAttributesProperty extends ReactNamespace.JSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute extends ReactNamespace.JSX.ElementChildrenAttribute {}
    interface IntrinsicAttributes extends ReactNamespace.JSX.IntrinsicAttributes {}
    interface IntrinsicClassAttributes<T> extends ReactNamespace.JSX.IntrinsicClassAttributes<T> {}
    interface IntrinsicElements extends ReactNamespace.JSX.IntrinsicElements {}
  }
}
