// The part of the host's plugin API (API v1) this plugin uses, typed by hand. The real types ship in Block's
// `@buzz/author` preview package, which has to be built from their repository; this keeps the plugin buildable on
// its own. A type-only import of React is fine: the build refuses a runtime one (the host supplies React).
import type * as ReactNS from "react";

export type ReactApi = typeof ReactNS;

export interface Binding {
  key: string;
  shift?: boolean;
  mod?: boolean;
  ctrl?: boolean;
}

export interface ShortcutDefinition {
  id: string;
  title: string;
  binding: Binding;
  run: () => unknown;
  when?: () => boolean;
  order?: number;
  repeat?: boolean;
  allowInEditable?: boolean;
}

export interface PageDefinition {
  id: string;
  title: string;
  primary?: boolean;
  badge?: ReactNS.ComponentType;
  component: ReactNS.ComponentType;
}

export interface PageInfo {
  key: string;
  pluginId: string;
  id: string;
  title: string;
  primary?: boolean;
  placement?: string;
}

export interface Scope {
  viewer: string;
  communityOrigin: string;
}

export type NavigationTarget =
  | { version: 1; kind: "conversation"; scope: Scope; channelId: string; messageId?: string; threadRootId?: string }
  | { version: 1; kind: "page"; pluginId: string; pageId: string }
  | { version: 1; kind: "settings"; section?: string; scope: Scope | null };

export interface RelaySnapshot {
  status: string;
  viewer?: string;
  origin?: string;
  session: { channels: { window(channelId: string): { rows: { id: string; threadRootId?: string }[] } } };
}

export interface ConversationToolProps {
  focus: () => void;
  channelId?: string;
  threadRootId?: string;
}

export interface Context {
  react: ReactApi;
  effect(setup: () => void | (() => void)): void;
  shortcuts: { register(definition: ShortcutDefinition): unknown };
  pages: { register(definition: PageDefinition): unknown; snapshot(): PageInfo[] };
  navigation: {
    open(target: NavigationTarget, options?: { focus?: "preserve" }): Promise<{ status: string }>;
    snapshot(): { entry?: { target?: { kind: string; channelId?: string; pluginId?: string; pageId?: string } } };
    subscribe(listener: () => void): () => void;
  };
  relay: { snapshot(): RelaySnapshot };
  conversation: {
    registerTool(definition: {
      id: string;
      title: string;
      order: number;
      component: ReactNS.ComponentType<ConversationToolProps>;
    }): unknown;
  };
}
