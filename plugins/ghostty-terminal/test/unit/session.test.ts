// src/session.ts with a fake host and a fake screen: the lifecycle, without a browser or a process.
import { describe, expect, it, vi } from "vitest";
import type { ChannelContext } from "../../src/env";
import { encodeInput, encodeResize } from "../../src/protocol";
import { createSessions, type Host, type HostProcess } from "../../src/session";
import type { Handlers, Screen } from "../../src/term";

const context: ChannelContext = {
  scope: "community-a",
  channelId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
  channelName: "General",
  viewer: "ab".repeat(32),
  relayUrl: "wss://relay.example.com",
};
const other: ChannelContext = { ...context, channelId: "11111111-2222-3333-4444-555555555555" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const line = (text: string) => `${Buffer.from(text).toString("base64")}\n`;

type FakeProcess = HostProcess & {
  written: string[];
  killed: number;
  options: Parameters<NonNullable<Host["spawn"]>>[1];
  exit(code: number | null): void;
};

function fakes({ spawnFails, screenFails }: { spawnFails?: string; screenFails?: string } = {}) {
  const processes: FakeProcess[] = [];
  const screens: (Screen & { handlers: Handlers; wrote: string[]; disposed: boolean })[] = [];
  const host: Host = {
    spawn: async (id, options) => {
      expect(id).toBe("pty");
      if (spawnFails) throw new Error(spawnFails);
      let exit!: (code: number | null) => void;
      const exited = new Promise<number | null>((resolve) => (exit = resolve));
      const proc: FakeProcess = {
        written: [],
        killed: 0,
        options,
        exit,
        exited,
        write: async (data) => void proc.written.push(data),
        kill: async () => void proc.killed++,
      };
      processes.push(proc);
      return proc;
    },
  };
  const makeScreen = async (handlers: Handlers) => {
    if (screenFails) throw new Error(screenFails);
    const screen = {
      handlers,
      wrote: [] as string[],
      disposed: false,
      attach: vi.fn(),
      detach: vi.fn(),
      write(bytes: Uint8Array) {
        screen.wrote.push(new TextDecoder().decode(bytes));
      },
      size: () => ({ cols: 100, rows: 30 }),
      text: () => screen.wrote.join(""),
      dispose() {
        screen.disposed = true;
      },
    };
    screens.push(screen);
    return screen;
  };
  return { host, makeScreen, processes, screens };
}

describe("a session", () => {
  it("starts when opened: the bridge gets the shell env and the home directory, no arguments, and the screen's size first", async () => {
    const { host, makeScreen, processes } = fakes();
    const sessions = createSessions(host, { makeScreen });
    sessions.open(context);
    expect(sessions.peek(context)?.status).toBe("starting");
    await tick();
    expect(sessions.peek(context)?.status).toBe("running");
    expect(processes).toHaveLength(1);
    expect(processes[0].options.cwd).toBe("~");
    expect(processes[0].options.env).toMatchObject({ TERM: "xterm-256color", BUZZ_CHANNEL: "General", BUZZ_CHANNEL_ID: context.channelId });
    expect(Object.keys(processes[0].options)).toEqual(["cwd", "env", "onStdout", "onStderr"]);
    expect(processes[0].written).toEqual([encodeResize(100, 30)]);
  });

  it("opens once per community and channel, and keeps them apart", async () => {
    const { host, makeScreen, processes } = fakes();
    const sessions = createSessions(host, { makeScreen });
    sessions.open(context);
    sessions.open(context);
    sessions.open({ ...context, channelName: "Renamed" });
    sessions.open(other);
    sessions.open({ ...context, scope: "community-b" });
    await tick();
    expect(processes).toHaveLength(3);
    expect(sessions.count()).toBe(3);
  });

  it("sends what is typed as input frames, and a resize as a resize line", async () => {
    const { host, makeScreen, processes, screens } = fakes();
    const sessions = createSessions(host, { makeScreen });
    sessions.open(context);
    await tick();
    screens[0].handlers.onInput("ls\r");
    screens[0].handlers.onResize(120, 40);
    expect(processes[0].written.slice(1)).toEqual([...encodeInput("ls\r"), encodeResize(120, 40)]);
  });

  it("holds input typed before the shell is ready, and sends it after the size, in order", async () => {
    const { host, makeScreen, processes, screens } = fakes();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: Host = { spawn: async (id, options) => (await gate, host.spawn!(id, options)) };
    const sessions = createSessions(slow, { makeScreen });
    sessions.open(context);
    await tick();
    screens[0].handlers.onInput("early\r");
    screens[0].handlers.onResize(90, 20);
    release();
    await tick();
    expect(processes[0].written).toEqual([encodeResize(100, 30), ...encodeInput("early\r"), encodeResize(90, 20)]);
  });

  it("writes the shell's output to the screen, whole lines of base64 however the reads are cut", async () => {
    const { host, makeScreen, processes, screens } = fakes();
    const sessions = createSessions(host, { makeScreen });
    sessions.open(context);
    await tick();
    const wire = line("hello ") + line("é日本😀\r\n");
    for (const piece of wire.match(/.{1,3}/gs) ?? []) processes[0].options.onStdout(piece);
    expect(screens[0].wrote.join("")).toBe("hello é日本😀\r\n");
  });

  it("fails, and hangs up the shell, when the bridge sends something that is not base64 or a line far too long", async () => {
    for (const bad of ["not base64 !!!\n", "x".repeat(1024 * 1024 + 1)]) {
      const { host, makeScreen, processes } = fakes();
      const sessions = createSessions(host, { makeScreen });
      sessions.open(context);
      await tick();
      processes[0].options.onStdout(bad);
      expect(sessions.peek(context)?.status).toBe("error");
      expect(processes[0].killed).toBe(1);
    }
  });

  it("reports how the shell ended, with what the bridge wrote to stderr", async () => {
    const { host, makeScreen, processes, screens } = fakes();
    const sessions = createSessions(host, { makeScreen });
    sessions.open(context);
    await tick();
    processes[0].options.onStderr("Traceback (most recent call last):\nValueError\n");
    processes[0].exit(3);
    await tick();
    const view = sessions.peek(context);
    expect(view?.status).toBe("exited");
    expect(view?.detail).toBe("The shell exited with status 3.\nTraceback (most recent call last):\nValueError");
    expect(screens[0].wrote.join("")).toContain("[The shell exited with status 3]");
  });

  it("says so when a signal ended the shell, and when it just exited", async () => {
    for (const [code, said] of [[null, "The shell was ended by a signal."], [0, "The shell exited."]] as const) {
      const { host, makeScreen, processes } = fakes();
      const sessions = createSessions(host, { makeScreen });
      sessions.open(context);
      await tick();
      processes[0].exit(code);
      await tick();
      expect(sessions.peek(context)?.detail).toBe(said);
    }
  });

  it("keeps only the end of a bridge's stderr", async () => {
    const { host, makeScreen, processes } = fakes();
    const sessions = createSessions(host, { makeScreen });
    sessions.open(context);
    await tick();
    processes[0].options.onStderr("a".repeat(10_000));
    processes[0].options.onStderr("END");
    processes[0].exit(1);
    await tick();
    const detail = sessions.peek(context)!.detail;
    expect(detail.length).toBeLessThan(4200);
    expect(detail.endsWith("END")).toBe(true);
  });

  it("fails with the host's own words when the process cannot start, and when the screen cannot be made", async () => {
    const started = fakes({ spawnFails: "Processes require an installed desktop plugin" });
    const one = createSessions(started.host, { makeScreen: started.makeScreen });
    one.open(context);
    await tick();
    expect(one.peek(context)).toMatchObject({ status: "error", detail: "Processes require an installed desktop plugin" });

    const drawn = fakes({ screenFails: "no WASM here" });
    const two = createSessions(drawn.host, { makeScreen: drawn.makeScreen });
    two.open(context);
    await tick();
    expect(two.peek(context)).toMatchObject({ status: "error", detail: "no WASM here" });
    expect(drawn.processes).toHaveLength(0);
  });

  it("says a host without spawn cannot run a shell", async () => {
    const { makeScreen } = fakes();
    const sessions = createSessions({}, { makeScreen });
    sessions.open(context);
    await tick();
    expect(sessions.peek(context)).toMatchObject({ status: "error", detail: expect.stringContaining("desktop app") });
  });
});

describe("restart, end and dispose", () => {
  it("restart hangs up the shell, drops its screen and starts a fresh one", async () => {
    const { host, makeScreen, processes, screens } = fakes();
    const sessions = createSessions(host, { makeScreen });
    sessions.open(context);
    await tick();
    sessions.restart(context);
    await tick();
    expect(processes).toHaveLength(2);
    expect(processes[0].killed).toBe(1);
    expect(screens[0].disposed).toBe(true);
    expect(sessions.peek(context)?.screen).toBe(screens[1]);
  });

  it("end hangs up the shell and leaves nothing: no session, until it is opened again", async () => {
    const { host, makeScreen, processes } = fakes();
    const sessions = createSessions(host, { makeScreen });
    sessions.open(context);
    await tick();
    sessions.end(context);
    expect(processes[0].killed).toBe(1);
    expect(sessions.peek(context)).toBeUndefined();
    expect(sessions.count()).toBe(0);
    sessions.end(context); // a second end is harmless
  });

  it("does not leave a shell behind when it is ended before the process has started, or before the screen is made", async () => {
    const { host, makeScreen, processes } = fakes();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sessions = createSessions({ spawn: async (id, options) => (await gate, host.spawn!(id, options)) }, { makeScreen });
    sessions.open(context);
    await tick();
    sessions.end(context);
    release();
    await tick();
    expect(processes).toHaveLength(1);
    expect(processes[0].killed).toBe(1);

    const screens = fakes();
    let make!: () => void;
    const door = new Promise<void>((resolve) => (make = resolve));
    const early = createSessions(screens.host, { makeScreen: async (handlers) => (await door, screens.makeScreen(handlers)) });
    early.open(other);
    early.end(other);
    make();
    await tick();
    expect(screens.screens[0].disposed).toBe(true);
    expect(screens.processes).toHaveLength(0);
  });

  it("dispose hangs up every shell and its screen, and refuses to start another", async () => {
    const { host, makeScreen, processes, screens } = fakes();
    const sessions = createSessions(host, { makeScreen });
    sessions.open(context);
    sessions.open(other);
    await tick();
    sessions.dispose();
    expect(processes.map((proc) => proc.killed)).toEqual([1, 1]);
    expect(screens.every((screen) => screen.disposed)).toBe(true);
    sessions.open({ ...context, channelId: "99999999-9999-4999-8999-999999999999" });
    await tick();
    expect(processes).toHaveLength(2);
  });

  it("tells subscribers about every change, and stops when they unsubscribe", async () => {
    const { host, makeScreen } = fakes();
    const sessions = createSessions(host, { makeScreen });
    const seen = vi.fn();
    const stop = sessions.subscribe(seen);
    sessions.open(context);
    await tick();
    expect(seen).toHaveBeenCalled();
    const calls = seen.mock.calls.length;
    stop();
    sessions.end(context);
    expect(seen).toHaveBeenCalledTimes(calls);
  });

  it("hands the panel a new view object on each change and the same one in between, so it can be a snapshot", async () => {
    const { host, makeScreen, processes } = fakes();
    const sessions = createSessions(host, { makeScreen });
    sessions.open(context);
    const starting = sessions.peek(context);
    expect(sessions.peek(context)).toBe(starting);
    await tick();
    const running = sessions.peek(context);
    expect(running).not.toBe(starting);
    expect(sessions.peek(context)).toBe(running);
    processes[0].exit(0);
    await tick();
    expect(sessions.peek(context)).not.toBe(running);
  });
});

describe("the key handler", () => {
  it("is handed to every screen it makes", async () => {
    const { host, makeScreen, screens } = fakes();
    const intercept = vi.fn(() => true);
    const sessions = createSessions(host, { makeScreen, intercept });
    sessions.open(context);
    await tick();
    expect(screens[0].handlers.intercept).toBe(intercept);
    const without = fakes();
    createSessions(without.host, { makeScreen: without.makeScreen }).open(context);
    await tick();
    expect(without.screens[0].handlers).not.toHaveProperty("intercept");
  });
});
