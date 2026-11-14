// One shell per community and channel, owned by the plugin and not by the drawer: hiding the drawer keeps the shell and its scrollback,
// and showing it attaches the same terminal again. A shell that has exited stays on screen until it is restarted or ended.
import { shellEnv, type ChannelContext } from "./env";
import { LineAssembler, encodeInput, encodeResize, fromBase64 } from "./protocol";
import { createScreen, type Handlers, type Screen } from "./term";

export type Status = "starting" | "running" | "exited" | "error";
/** What the panel draws. A new object on every change, so it can be a `useSyncExternalStore` snapshot. */
export type View = Readonly<{ status: Status; detail: string; screen: Screen | undefined }>;

/** The parts of Buzz's `ctx.host.spawn` this plugin uses (src/features/host/service.ts in block/buzz-app). */
export type HostProcess = { write(data: string): Promise<void>; kill(): Promise<void>; exited: Promise<number | null> };
export type Host = {
  spawn?: (
    id: string,
    options: { cwd: string; env: Record<string, string>; onStdout(text: string): void; onStderr(text: string): void },
  ) => Promise<HostProcess>;
};

const STDERR_KEPT = 4096;
const keyOf = (context: ChannelContext) => JSON.stringify([context.scope, context.channelId]);

type Entry = {
  context: ChannelContext;
  view: View;
  proc?: HostProcess;
  screen?: Screen;
  /** Input that came before the process was ready. */
  early: string[];
  stderr: string;
  stopped: boolean;
};

export function createSessions(host: Host, makeScreen: (handlers: Handlers) => Promise<Screen> = createScreen) {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  let disposed = false;

  const update = (entry: Entry, status: Status, detail = "") => {
    entry.view = { status, detail, screen: entry.screen };
    notify();
  };

  const send = (entry: Entry, frames: string[]) => {
    if (entry.stopped) return;
    if (!entry.proc) return void entry.early.push(...frames);
    for (const frame of frames) entry.proc.write(frame).catch(() => {});
  };

  function stop(entry: Entry) {
    entry.stopped = true;
    entry.proc?.kill().catch(() => {});
    entry.screen?.dispose();
  }

  function fail(entry: Entry, error: unknown) {
    if (entry.stopped) return;
    entry.proc?.kill().catch(() => {});
    update(entry, "error", error instanceof Error ? error.message : String(error));
  }

  async function start(entry: Entry) {
    try {
      if (!host.spawn) throw new Error("This Buzz cannot start a process. Use the desktop app.");
      const screen = await makeScreen({
        onInput: (text) => send(entry, encodeInput(text)),
        onResize: (cols, rows) => send(entry, [encodeResize(cols, rows)]),
      });
      if (entry.stopped) return screen.dispose();
      entry.screen = screen;
      const lines = new LineAssembler();
      const proc = await host.spawn("pty", {
        cwd: "~",
        env: shellEnv(entry.context),
        onStdout(text) {
          try {
            for (const line of lines.push(text)) screen.write(fromBase64(line));
          } catch (error) {
            fail(entry, error);
          }
        },
        onStderr(text) {
          entry.stderr = (entry.stderr + text).slice(-STDERR_KEPT);
          notify();
        },
      });
      if (entry.stopped) return void proc.kill().catch(() => {});
      entry.proc = proc;
      const { cols, rows } = screen.size();
      send(entry, [encodeResize(cols, rows), ...entry.early.splice(0)]);
      update(entry, "running");
      void proc.exited.then((code) => {
        if (entry.stopped || entry.view.status === "error") return;
        const detail = code === null ? "The shell was ended by a signal." : code === 0 ? "The shell exited." : `The shell exited with status ${code}.`;
        screen.write(new TextEncoder().encode(`\r\n\x1b[2m[${detail.replace(/\.$/, "")}]\x1b[0m\r\n`));
        update(entry, "exited", entry.stderr ? `${detail}\n${entry.stderr.trim()}` : detail);
      });
    } catch (error) {
      fail(entry, error);
    }
  }

  function open(context: ChannelContext): Entry {
    const key = keyOf(context);
    const existing = entries.get(key);
    if (existing) return existing;
    const entry: Entry = { context, view: { status: "starting", detail: "", screen: undefined }, early: [], stderr: "", stopped: false };
    entries.set(key, entry);
    if (disposed) entry.stopped = true;
    else void start(entry);
    return entry;
  }

  function end(context: ChannelContext) {
    const entry = entries.get(keyOf(context));
    if (!entry) return;
    entries.delete(keyOf(context));
    stop(entry);
    notify();
  }

  return {
    /** Starts this channel's shell if it has none. Call it from an effect, not while rendering. */
    open: (context: ChannelContext) => void open(context),
    /** What is there now, or nothing. The same object until something changes, so it can be a `useSyncExternalStore` snapshot. */
    peek: (context: ChannelContext): View | undefined => entries.get(keyOf(context))?.view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    end,
    restart(context: ChannelContext) {
      end(context);
      open(context);
    },
    /** Plugin disabled or replaced, or the app closing: every shell is hung up. */
    dispose() {
      disposed = true;
      for (const entry of entries.values()) stop(entry);
      entries.clear();
      listeners.clear();
    },
    /** For tests: how many shells there are. */
    count: () => entries.size,
  };
}
