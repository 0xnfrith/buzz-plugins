import type { Context } from "./buzz";
import { createClient } from "./beeper/client";
import { createConfigStore } from "./beeper/config";
import { createInbox } from "./beeper/store";
import { provideReact } from "./react";
import { PAGE_ICON } from "./ui/icons";
import { createInboxPage } from "./ui/Inbox";
import { createSettingsCard } from "./ui/Settings";
import { CSS } from "./ui/styles";

export const inject = ["react", "pages", "settingsCards", "navigation", "host"];

export function apply(ctx: Context) {
  provideReact(ctx.react);

  // The Keychain is macOS's. On other systems the token can only be kept in the profile, and the settings card says so.
  const mac = /^Mac/i.test(navigator.platform ?? "") || /Macintosh/.test(navigator.userAgent ?? "");
  const config = createConfigStore(window.localStorage, { keychain: mac, run: (command, input) => ctx.host.runCommand(command, input) });
  // `ctx.host.runCommand` is the only way out of the plugin, and it can run only the two curl commands the manifest declares.
  const client = createClient({
    run: (command, input) => ctx.host.runCommand(command, input),
    token: () => config.token(),
    baseUrl: () => config.baseUrl(),
  });
  const inbox = createInbox({ client, hasToken: () => config.hasToken(), ready: config.ready });

  ctx.effect(() => {
    // [DOM] The page's styles are one <style> element: API v1 has no separate CSS, and the host has no style service.
    // [DOM] One rule in it reaches the host's <img> of this page's own icon (matched by that exact data URL), because an icon drawn
    // in an <img> cannot take the theme's colour. It goes with the element when this scope ends.
    const style = document.createElement("style");
    style.dataset.megatechBeeper = "";
    style.textContent = CSS;
    document.head.append(style);
    // A saved, replaced or removed token, or a new address, means a different Beeper: forget what was read.
    const unsubscribe = config.subscribe(() => inbox.reset());
    return () => {
      unsubscribe();
      style.remove();
    };
  });

  const openSettings = () => {
    void ctx.navigation.open({ version: 1, kind: "settings", section: "megatech.beeper/settings" }).catch(() => {});
  };

  ctx.pages.register({
    id: "inbox",
    title: "Beeper",
    primary: true,
    layout: "workspace",
    icon: PAGE_ICON,
    component: createInboxPage({ inbox, openSettings, reloadToken: config.reload }),
  });
  ctx.settingsCards.register({
    id: "settings",
    title: "Beeper",
    group: "Plugins",
    component: createSettingsCard({ config, client }),
  });
}
