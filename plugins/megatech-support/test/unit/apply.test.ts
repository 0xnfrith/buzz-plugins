import { afterEach, describe, expect, it, vi } from "vitest";
import * as plugin from "../../src/index";
import { SWITCH_KEY } from "../../src/support/switch";
import { world } from "./world";

/** The parts of Buzz's context `apply` touches, recording what it does. */
function setup(saved: string | null, { toolTaken = false, typeTaken = false, storageThrows = false } = {}) {
  const storage = new Map<string, string>(saved === null ? [] : [[SWITCH_KEY, saved]]);
  const getItem = vi.fn((key: string) => storage.get(key) ?? null);
  const head: unknown[] = [];
  const style = { dataset: {} as Record<string, string>, textContent: "", remove: vi.fn() };
  vi.stubGlobal(
    "window",
    storageThrows
      ? {
          get localStorage(): never {
            throw new Error("denied");
          },
        }
      : { localStorage: { getItem, setItem: (key: string, value: string) => void storage.set(key, value) } },
  );
  vi.stubGlobal("document", { createElement: () => style, head: { append: (node: unknown) => head.push(node) } });
  const w = world();
  const cleanups: (() => void)[] = [];
  const ctx = {
    react: {},
    host: { request: vi.fn(async () => ({ status: 500, headers: {}, body: "" })), prepareRemoteAgentAuthorization: vi.fn() },
    relay: w.relay,
    agents: {
      register: vi.fn(() => {
        if (typeTaken) throw new Error("taken");
      }),
      addTool: vi.fn((tool: { name: string }) => {
        if (toolTaken && tool.name === "megatech_support_ask_or_open") throw new Error("taken");
      }),
    },
    navigation: { open: vi.fn() },
    pages: { register: vi.fn() },
    settingsCards: { register: vi.fn() },
    effect: vi.fn((setup: () => () => void) => void cleanups.push(setup())),
  };
  const wired = plugin.wire(ctx as never);
  return { ctx, getItem, head, style, cleanups, storage, wired, w };
}

afterEach(() => vi.unstubAllGlobals());

describe("apply", () => {
  it("asks Buzz for what it uses, and no more", () => {
    expect([...plugin.inject].sort()).toEqual(["agents", "host", "pages", "react", "relay", "settingsCards"]);
  });

  it("registers its page and its Settings card", () => {
    const { ctx } = setup(null);
    expect(ctx.pages.register).toHaveBeenCalledTimes(1);
    expect(ctx.pages.register.mock.calls[0]?.[0]).toMatchObject({ id: "support", title: "Megatech support", primary: true, layout: "workspace" });
    expect(ctx.settingsCards.register).toHaveBeenCalledTimes(1);
    expect(ctx.settingsCards.register.mock.calls[0]?.[0]).toMatchObject({ id: "settings", title: "Megatech support", group: "Plugins" });
  });

  it("adds no agent type and no tool when nothing is saved, or the switch is off", () => {
    for (const saved of [null, "off", "", "ON", "true", "1"]) {
      const { ctx } = setup(saved);
      expect(ctx.agents.register).not.toHaveBeenCalled();
      expect(ctx.agents.addTool).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it("adds the agent type and both tools when the saved switch is on as it starts", () => {
    const { ctx } = setup("on");
    expect(ctx.agents.register).toHaveBeenCalledTimes(1);
    expect(ctx.agents.register.mock.calls[0]?.[0]).toMatchObject({ id: "support", title: "Megatech support" });
    expect(ctx.agents.addTool.mock.calls.map(([tool]) => tool.name)).toEqual(["megatech_support_ask_or_open", "megatech_support_ticket_status"]);
  });

  it("reads the switch once: turning it on or off later changes nothing until Buzz starts again", () => {
    const { ctx, getItem, storage } = setup("off");
    expect(getItem).toHaveBeenCalledTimes(1);
    storage.set(SWITCH_KEY, "on");
    expect(ctx.agents.register).not.toHaveBeenCalled();
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it("makes the tools ask the saved switch at each call: turning it off stops them at once", async () => {
    const { ctx, storage } = setup("on");
    const ask = ctx.agents.addTool.mock.calls[0]?.[0] as { call(client: object, context: object, args: object): Promise<string> };
    storage.set(SWITCH_KEY, "off");
    await expect(ask.call({ pubkey: "a".repeat(64) }, {}, { question: "hi" })).rejects.toThrow(/switched off/);
    expect(ctx.host.request).not.toHaveBeenCalled();
  });

  it("still loads when another plugin has a tool's name", () => {
    const { ctx } = setup("on", { toolTaken: true });
    expect(ctx.agents.addTool).toHaveBeenCalledTimes(2);
    expect(ctx.pages.register).toHaveBeenCalledTimes(1);
  });

  it("still loads when the type is refused", () => {
    const { ctx } = setup("on", { typeTaken: true });
    expect(ctx.pages.register).toHaveBeenCalledTimes(1);
    expect(ctx.settingsCards.register).toHaveBeenCalledTimes(1);
  });

  it("touches the service and the host's signing not at all while it applies", () => {
    const { ctx } = setup("on");
    expect(ctx.host.request).not.toHaveBeenCalled();
    expect(ctx.host.prepareRemoteAgentAuthorization).not.toHaveBeenCalled();
  });

  it("adds one style element, inside an effect, and removes it with the plugin", () => {
    const { ctx, head, style, cleanups } = setup(null);
    expect(ctx.effect).toHaveBeenCalledTimes(1);
    expect(head).toEqual([style]);
    expect(style.textContent).toContain(".mts-root");
    expect(style.dataset.megatechSupport).toBe("");
    cleanups.forEach((cleanup) => cleanup());
    expect(style.remove).toHaveBeenCalledTimes(1);
  });

  it("still loads, with the agent switch off, when the profile will not give its storage", () => {
    const { ctx, wired } = setup(null, { storageThrows: true });
    expect(ctx.pages.register).toHaveBeenCalledTimes(1);
    expect(ctx.agents.register).not.toHaveBeenCalled();
    expect(wired.flag.get()).toBe(false);
    wired.flag.set(true);
    expect(wired.flag.get()).toBe(false);
  });

  it("ends a session at the service when the plugin goes, and keeps nothing", async () => {
    const { ctx, cleanups, wired, w } = setup(null);
    const sent: { url: string; authorization?: string | undefined }[] = [];
    ctx.host.request.mockImplementation((async (request: { url: string; headers?: Record<string, string> }) => {
      sent.push({ url: request.url, authorization: request.headers?.authorization });
      if (request.url.endsWith("/challenge")) return { status: 200, headers: {}, body: JSON.stringify({ challenge: "C".repeat(24), expires_in: 300 }) };
      if (request.url.endsWith("/verify")) return { status: 200, headers: {}, body: JSON.stringify({ session: "S".repeat(24), expires_in: 3600 }) };
      return { status: 200, headers: {}, body: "{}" };
    }) as never);
    ctx.host.prepareRemoteAgentAuthorization.mockImplementation((async () => ["auth", w.user.pubkey, "", "0".repeat(128)]) as never);
    await wired.identity.verify();
    expect(wired.identity.verified()).toBe(true);
    cleanups.forEach((cleanup) => cleanup());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(wired.identity.verified()).toBe(false);
    expect(sent.at(-1)).toEqual({ url: "https://support.megatech.invalid/v1/identity/logout", authorization: `Bearer ${"S".repeat(24)}` });
  });
});
