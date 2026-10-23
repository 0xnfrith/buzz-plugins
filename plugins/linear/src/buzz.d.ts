// The part of Buzz's plugin API this plugin uses, trimmed from block/buzz-app
// (src/plugins/author.ts, src/features/{host,pages,settings}/service.ts at c2210b45).
// Block ships the full types as a preview package built from its own repository; this
// copy keeps the build reproducible from this repository alone. Update it with the
// host it was written against.
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

export type Host = { request(input: HostRequest): Promise<HostResponse> };

export type PageProps = Readonly<Record<string, unknown>>;

export type Page = Readonly<{
  id: string;
  title: string;
  component: ReactNamespace.ComponentType<PageProps>;
  layout?: "document" | "workspace";
  primary?: boolean;
  placement?: "sidebar" | "topbar" | "toolbar";
  /** A `data:image/<subtype>;...,<payload>` URL. */
  icon?: string;
}>;

export type SettingsCard = Readonly<{
  id: string;
  title: string;
  group?: string;
  component: ReactNamespace.ComponentType<{ active(): boolean }>;
}>;

export type Context = {
  react: typeof ReactNamespace;
  host: Host;
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
