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

  // The Keychain is macOS's. On other systems the key can only be kept in the profile, and the settings card says so.
  const mac = /^Mac/i.test(navigator.platform ?? "") || /Macintosh/.test(navigator.userAgent ?? "");
  const keys = createKeyStore(window.localStorage, { keychain: mac, run: (command, input) => ctx.host.runCommand(command, input) });
  // `ctx.host.request` is the only way to Linear; its origin is the one the manifest declares. `ctx.host.runCommand` runs only the
  // three `security` commands the manifest declares, for the Keychain. A request waits for the first look at where the key is kept.
  const client = createClient(
    (request) => ctx.host.request(request),
    async () => {
      await keys.ready;
      return keys.read();
    },
  );
  const store = createBoardStore(client, window.localStorage);

  ctx.effect(() => {
    // [DOM] The page's styles are one <style> element: API v1 has no separate CSS, and the host has no style service.
    // [DOM] One rule in it reaches the host's <img> of this page's own icon (matched by that exact data URL), because an icon drawn
    // in an <img> cannot take the theme's colour. It goes with the element when this scope ends.
    const style = document.createElement("style");
    style.dataset.megatechLinear = "";
    style.textContent = CSS;
    document.head.append(style);
    // A saved, replaced or removed key means a different Linear: forget the old board. (The first look at the Keychain, and moving the
    // same key between places, do not.)
    let seen = keys.version();
    const unsubscribe = keys.subscribe(() => {
      if (keys.version() === seen) return;
      seen = keys.version();
      store.reset();
    });
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

