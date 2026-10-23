import type { Context } from "./buzz";
import { createClient } from "./linear/client";
import { createKeyStore } from "./linear/keys";
import { createBoardStore } from "./linear/store";
import { provideReact } from "./react";
import { createBoardPage } from "./ui/Board";
import { PAGE_ICON } from "./ui/icons";
import { createSettingsCard } from "./ui/Settings";
import { CSS } from "./ui/styles";

export const inject = ["react", "pages", "settingsCards", "navigation", "host"];

export function apply(ctx: Context) {
  provideReact(ctx.react);

  const keys = createKeyStore(window.localStorage);
  // `ctx.host.request` is the only way out of the plugin; its origin is the one the manifest declares.
  const client = createClient((request) => ctx.host.request(request), () => keys.read());
  const store = createBoardStore(client, window.localStorage);

  ctx.effect(() => {
    // [DOM] The page's styles are one <style> element: API v1 has no separate CSS, and the host has no style service.
    // [DOM] One rule in it reaches the host's <img> of this page's own icon (matched by that exact data URL), because an icon drawn
    // in an <img> cannot take the theme's colour. It goes with the element when this scope ends.
    const style = document.createElement("style");
    style.dataset.megatechLinear = "";
    style.textContent = CSS;
    document.head.append(style);
    // A saved, replaced or removed key means a different Linear: forget the old board.
    const unsubscribe = keys.subscribe(() => store.reset());
    return () => {
      unsubscribe();
      style.remove();
    };
  });

  const openSettings = () => {
    void ctx.navigation.open({ version: 1, kind: "settings", section: "megatech.linear/settings" }).catch(() => {});
  };

  ctx.pages.register({
    id: "board",
    title: "Linear",
    primary: true,
    layout: "workspace",
    icon: PAGE_ICON,
    component: createBoardPage({ store, keys, openSettings }),
  });
  ctx.settingsCards.register({
    id: "settings",
    title: "Linear",
    group: "Plugins",
    component: createSettingsCard({ keys, client }),
  });
}

