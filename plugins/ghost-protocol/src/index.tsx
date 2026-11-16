import type { Context } from "./buzz";
import { provideReact } from "./react";
import { CSS } from "./ui/styles";
import { createPage } from "./ui/Page";

export const inject = ["react", "pages", "host"];

export function apply(ctx: Context): void {
  provideReact(ctx.react);

  ctx.effect(() => {
    // [DOM] The page's styles are one <style> element: API v1 has no separate CSS, and the host has no style service.
    const style = document.createElement("style");
    style.dataset.ghostProtocol = "";
    style.textContent = CSS;
    document.head.append(style);
    return () => style.remove();
  });

  ctx.pages.register({
    id: "ghost-protocol",
    title: "GHOST Protocol",
    primary: true,
    layout: "workspace",
    component: createPage(ctx.host),
  });
}
