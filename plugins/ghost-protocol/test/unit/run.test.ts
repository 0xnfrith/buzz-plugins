import { describe, expect, it, vi } from "vitest";
import { lastLine, run, startRun, type Handlers, type Proc, type StartDocker } from "../../src/gp/run";
import type { Call } from "../../src/docker";

const command: Call = { process: "exec", args: ["gp-maple", "gp", "status"] };

/** A process the test drives by hand. */
function manual() {
  let handlers!: Handlers;
  let exit!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => (exit = resolve));
  const proc = { write: vi.fn(async () => undefined), end: vi.fn(async () => undefined), kill: vi.fn(async () => exit(null)), exited };
  const start: StartDocker = async (_command, given) => {
    handlers = given;
    return proc as Proc;
  };
  return { start, proc, out: (text: string) => handlers.onStdout(text), err: (text: string) => handlers.onStderr(text), exit };
}

describe("run", () => {
  it("collects stdout and stderr and says how it ended", async () => {
    const m = manual();
    const done = run(m.start, command, { timeoutMs: 1000 });
    await vi.waitFor(() => expect(m.proc.end).toHaveBeenCalled());
    m.out("GP_INTERFACE=1\nGP_CLAUDE=active\n");
    m.err("a warning\n");
    m.exit(0);
    const outcome = await done;
    expect(outcome).toMatchObject({ kind: "exit", code: 0, stdout: "GP_INTERFACE=1\nGP_CLAUDE=active\n", stderr: "a warning\n" });
    if (outcome.kind === "exit") expect(outcome.gp.values.get("CLAUDE")).toBe("active");
  });

  it("closes stdin at once without input, and after writing it with input", async () => {
    const none = manual();
    const a = run(none.start, command, { timeoutMs: 1000 });
    await vi.waitFor(() => expect(none.proc.end).toHaveBeenCalledWith(undefined));
    none.exit(0);
    await a;

    const some = manual();
    const b = run(some.start, command, { timeoutMs: 1000, stdin: "line\n" });
    await vi.waitFor(() => expect(some.proc.end).toHaveBeenCalledWith("line\n"));
    some.exit(0);
    await b;
  });

  it("is cannot-start when the program cannot start", async () => {
    const outcome = await run(() => Promise.reject(new Error("ENOENT")), command, { timeoutMs: 1000 });
    expect(outcome).toEqual({ kind: "cannot-start" });
  });

  it("is aborted when it cannot start and the caller has gone", async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await run(() => Promise.reject(new Error("ENOENT")), command, { timeoutMs: 1000, signal: abort.signal })).toEqual({ kind: "aborted" });
  });

  it("stops a process that outlasts its time", async () => {
    vi.useFakeTimers();
    try {
      const m = manual();
      const done = run(m.start, command, { timeoutMs: 500 });
      await vi.advanceTimersByTimeAsync(499);
      expect(m.proc.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(await done).toEqual({ kind: "timeout" });
      expect(m.proc.kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a process when the caller goes away", async () => {
    const m = manual();
    const abort = new AbortController();
    const done = run(m.start, command, { timeoutMs: 60_000, signal: abort.signal });
    await vi.waitFor(() => expect(m.proc.end).toHaveBeenCalled());
    abort.abort();
    expect(await done).toEqual({ kind: "aborted" });
    expect(m.proc.kill).toHaveBeenCalledTimes(1);
  });

  it("reads a signal's end as a null code", async () => {
    const m = manual();
    const done = run(m.start, command, { timeoutMs: 1000 });
    await vi.waitFor(() => expect(m.proc.end).toHaveBeenCalled());
    m.exit(null);
    expect(await done).toMatchObject({ kind: "exit", code: null });
  });

  it("keeps a bounded amount of output", async () => {
    const m = manual();
    const done = run(m.start, command, { timeoutMs: 1000 });
    await vi.waitFor(() => expect(m.proc.end).toHaveBeenCalled());
    for (let i = 0; i < 100; i++) m.out("x".repeat(10_000));
    m.exit(0);
    const outcome = await done;
    expect(outcome.kind === "exit" && outcome.stdout.length).toBeLessThan(300_000);
  });
});

describe("lines", () => {
  it("are whole, whichever way the output is cut, and the last one counts without a newline", async () => {
    const m = manual();
    const lines: string[] = [];
    const done = run(m.start, command, { timeoutMs: 1000, onLine: (line) => lines.push(line) });
    await vi.waitFor(() => expect(m.proc.end).toHaveBeenCalled());
    m.out("GP_CLAUDE_LO");
    m.out("GIN_URL=https://x.example\nsecond\r\nthi");
    m.out("rd\r\n\nlast");
    m.exit(0);
    await done;
    expect(lines).toEqual(["GP_CLAUDE_LOGIN_URL=https://x.example", "second", "third", "last"]);
  });
});

describe("startRun", () => {
  it("lets the caller write while it runs", async () => {
    const m = manual();
    const running = await startRun(m.start, command, { timeoutMs: 1000 });
    await running.write("code\n");
    expect(m.proc.write).toHaveBeenCalledWith("code\n");
    await running.end("more\n");
    expect(m.proc.end).toHaveBeenCalledWith("more\n");
    m.exit(0);
    expect((await running.done).kind).toBe("exit");
  });

  it("gives a finished outcome and harmless handles when the program cannot start", async () => {
    const running = await startRun(() => Promise.reject(new Error("ENOENT")), command, { timeoutMs: 1000 });
    await expect(running.write("x")).resolves.toBeUndefined();
    await expect(running.kill()).resolves.toBeUndefined();
    expect(await running.done).toEqual({ kind: "cannot-start" });
  });
});

describe("lastLine", () => {
  it("is the last non-empty line, trimmed and cut to one short line", () => {
    expect(lastLine("first\n  second  \n\n")).toBe("second");
    expect(lastLine("")).toBe("");
    expect(lastLine("x".repeat(500), 20)).toBe(`${"x".repeat(19)}…`);
  });
});
