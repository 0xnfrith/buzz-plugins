import { afterEach, describe, expect, it, vi } from "vitest";
import * as plugin from "../../src/index";

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
  it("registers one page in the page navigation, and nothing else", () => {
    const { ctx } = setup();
    expect(ctx.pages.register).toHaveBeenCalledTimes(1);
    expect(ctx.pages.register.mock.calls[0]?.[0]).toMatchObject({ id: "ghost-protocol", title: "GHOST Protocol", primary: true, layout: "workspace" });
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
