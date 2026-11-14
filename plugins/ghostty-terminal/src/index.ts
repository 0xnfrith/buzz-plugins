// A Ghostty terminal in the channel drawer. A header button, or Cmd/Ctrl+Shift+J, shows a login shell for the channel, started with the
// channel's Buzz context in its environment (src/env.ts). The shell runs behind the PTY bridge the manifest declares (src/bridge.py).
//
// A prototype: see README.md. Types are kept loose because Buzz supplies React and its services at run time and a plugin cannot import them.
import type { ChannelContext } from "./env";
import { createSessions } from "./session";

export const inject = ["react", "panels", "shortcuts", "host"];

const TOGGLE = { key: "j", mod: true, shift: true } as const;
const BAR = { background: "#161b22", color: "#e6edf3", fontSize: 12, padding: "4px 8px", display: "flex", gap: 8, alignItems: "center" } as const;

export function apply(ctx: any) {
  const React = ctx.react;
  const h = React.createElement;
  const sessions = createSessions(ctx.host);
  ctx.effect(() => () => sessions.dispose());

  // The launcher and the shortcut share one toggle: the launcher is what knows the channel, so it hands the shortcut its own.
  let binding: { toggle(): void; available(): boolean } | undefined;
  ctx.effect(() => () => {
    binding = undefined;
  });
  ctx.shortcuts.register({
    id: "toggle",
    title: "Toggle Ghostty terminal",
    binding: TOGGLE,
    allowInEditable: true,
    when: () => !!binding?.available(),
    run: () => binding?.toggle(),
  });

  const glyph = h(
    "svg",
    { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
    h("rect", { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
    h("path", { d: "m7 9 3 3-3 3" }),
    h("path", { d: "M13 15h4" }),
  );

  function Launcher({ context, toggle, pressed, available }: { context: ChannelContext; toggle(target: string): void; pressed: boolean; available(): boolean }) {
    const target = JSON.stringify(context);
    React.useLayoutEffect(() => {
      const current = { toggle: () => toggle(target), available };
      binding = current;
      return () => {
        if (binding === current) binding = undefined;
      };
    }, [toggle, target, available]);
    return h(
      "button",
      { type: "button", "aria-label": "Toggle Ghostty terminal", "aria-expanded": pressed, title: "Ghostty terminal (Cmd/Ctrl+Shift+J)", onClick: () => toggle(target) },
      glyph,
    );
  }

  function Panel({ channelContext: context }: { channelContext?: ChannelContext }) {
    const box = React.useRef(null as HTMLElement | null);
    const view = React.useSyncExternalStore(sessions.subscribe, () => (context ? sessions.peek(context) : undefined));
    const key = context ? `${context.scope}\n${context.channelId}` : "";
    const screen = view?.screen;
    React.useEffect(() => {
      if (context) sessions.open(context);
    }, [key]);
    React.useEffect(() => {
      if (!screen || !box.current) return;
      screen.attach(box.current);
      return () => screen.detach();
    }, [screen]);

    if (!context) return h("div", { style: BAR }, "Open the terminal from a channel.");
    const note =
      view === undefined ? "Ended." : view.status === "starting" ? "Starting…" : view.status === "running" ? "" : view.detail || "Stopped.";
    return h(
      "div",
      { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 240, background: "#0d1117" } },
      h(
        "div",
        { style: BAR },
        h("span", { style: { flex: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, note || `#${context.channelName}`),
        view === undefined
          ? h("button", { type: "button", onClick: () => sessions.open(context) }, "Start a shell")
          : [
              h("button", { key: "restart", type: "button", onClick: () => sessions.restart(context) }, "Restart"),
              h("button", { key: "end", type: "button", onClick: () => sessions.end(context) }, "End"),
            ],
      ),
      h("div", { ref: box, style: { flex: 1, minHeight: 0, padding: 6, overflow: "hidden" } }),
    );
  }

  ctx.panels.register({
    id: "terminal",
    title: "Ghostty terminal",
    matches: () => false, // opened by its launcher and the shortcut, never by a link
    channelLauncher: Launcher,
    component: Panel,
  });
}
