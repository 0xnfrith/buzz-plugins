import { afterEach, describe, expect, it, vi } from "vitest";
import * as plugin from "../../src/index";
import { PAGE_ICON } from "../../src/ui/icons";
import manifest from "../../manifest.json" with { type: "json" };

/** The parts of Buzz's context `apply` touches, recording what it does. */
function setup() {
  const head: unknown[] = [];
  const style = { dataset: {} as Record<string, string>, textContent: "", remove: vi.fn() };
  vi.stubGlobal("document", { createElement: vi.fn(() => style), head: { append: (node: unknown) => head.push(node) } });
  const cleanups: (() => void)[] = [];
  const ctx = {
    react: {},
    host: { spawn: vi.fn() },
    pages: { register: vi.fn() },
    agents: { register: vi.fn(), registerTab: vi.fn() },
    relay: { snapshot: vi.fn(() => ({ status: "ready", session: { viewer: "a".repeat(64) } })) },
    effect: vi.fn((setup: () => void | (() => void)) => {
      const cleanup = setup();
      if (cleanup) cleanups.push(cleanup);
    }),
  };
  plugin.apply(ctx as never);
  return { ctx, head, style, cleanups };
}

afterEach(() => vi.unstubAllGlobals());

describe("apply", () => {
  it("registers one page in the page navigation, and one Remote agent type", () => {
    const { ctx } = setup();
    expect(ctx.pages.register).toHaveBeenCalledTimes(1);
    expect(ctx.agents.register).toHaveBeenCalledTimes(1);
    expect(ctx.agents.register.mock.calls[0]?.[0]).toMatchObject({ id: "ghost-protocol", title: "GHOST Protocol" });
    expect(Object.keys(ctx.agents.register.mock.calls[0]?.[0].remote).sort()).toEqual(["activate", "profile", "provision", "remove"]);
  });

  it("adds a tab for the agents of its own type, and for no other agent's", () => {
    const { ctx } = setup();
    expect(ctx.agents.registerTab).toHaveBeenCalledTimes(1);
    const tab = ctx.agents.registerTab.mock.calls[0]?.[0];
    expect(tab).toMatchObject({ id: "ghost-protocol", title: "GHOST Protocol" });
    // Buzz keys a type `<plugin id>/<type id>`, and the plugin id is the manifest's.
    expect(tab.when({ pubkey: "a".repeat(64), name: "Maple", type: `${manifest.id}/ghost-protocol` })).toBe(true);
    expect(tab.when({ pubkey: "a".repeat(64), name: "Maple", type: "buzz.claude-code/claude-code" })).toBe(false);
    expect(tab.when({ pubkey: "a".repeat(64), name: "Maple", type: "someone.else/ghost-protocol" })).toBe(false);
    expect(ctx.pages.register.mock.calls[0]?.[0]).toMatchObject({ id: "ghost-protocol", title: "GHOST Protocol", primary: true, layout: "workspace" });
  });

  it("gives the page its ghost icon, so it can be told from the other pages in navigation and search", () => {
    const { ctx } = setup();
    expect(ctx.pages.register.mock.calls[0]?.[0]).toMatchObject({ icon: PAGE_ICON });
  });

  it("starts no process until the page is shown", () => {
    const { ctx } = setup();
    expect(ctx.host.spawn).not.toHaveBeenCalled();
  });

  it("adds its styles as one <style> element and removes it when the plugin ends", () => {
    const { head, style, cleanups } = setup();
    expect(head).toEqual([style]);
    expect(style.textContent).toContain(".gp-root");
    expect(cleanups).toHaveLength(1);
    cleanups[0]?.();
    expect(style.remove).toHaveBeenCalledTimes(1);
  });

  it("styles itself with the host's theme tokens and no colour of its own", () => {
    const { style } = setup();
    // Every colour in the sheet is a var() of the host's, with a fallback; no hex colour stands outside one.
    const outside = style.textContent.replace(/var\([^)]*\)/g, "");
    expect(outside).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(outside).not.toMatch(/\brgba?\(/);
  });
});
