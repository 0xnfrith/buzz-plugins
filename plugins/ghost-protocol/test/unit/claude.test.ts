import { afterEach, describe, expect, it, vi } from "vitest";
import { isSignedIn, signInByAddress, signInWithToken } from "../../src/gp/claude";
import { WORDS } from "../../src/gp/constants";
import { createProgress } from "../../src/gp/progress";
import { CODE, OWNER, RELAY, rig, SIGNAL, TOKEN, type Rig } from "./support";
import { provision } from "../../src/gp/flow";
import { authOf } from "./support";
import { activate } from "../../src/gp/flow";

// `gp claude status|token|login` against the fake docker, for an agent that is made and attested but not signed in to Claude.

const rigs: Rig[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const made of rigs.splice(0)) made.cleanup();
});

/** An agent that waits at `needs-claude`: made, started and attested, with the sign-in by address left for later. */
async function waitingAgent(scenario?: Parameters<typeof rig>[0]) {
  const r = rig(scenario);
  rigs.push(r);
  const { pubkey } = await provision(r.deps, { name: "Maple", community: RELAY, owner: OWNER, selfUpdate: false, signal: SIGNAL });
  await activate(r.deps, { name: "Maple", pubkey, auth: authOf(), selfUpdate: false, claudeWay: "login", signal: SIGNAL });
  return { r, claude: { start: r.deps.start } };
}

const everywhere = (r: Rig, extra: unknown = "") => JSON.stringify([r.fake.calls(), r.fake.state(), extra]);

describe("isSignedIn", () => {
  it("says whether the agent has a sign-in", async () => {
    const { r, claude } = await waitingAgent();
    expect(await isSignedIn(claude, "maple", SIGNAL)).toEqual({ ok: true, active: false });
    r.fake.use("claude-signed-in");
    const signedIn = await waitingAgent("claude-signed-in");
    expect(await isSignedIn(signedIn.claude, "maple", SIGNAL)).toEqual({ ok: true, active: true });
  });

  it("says why it cannot", async () => {
    const { r, claude } = await waitingAgent();
    r.fake.use("unknown-interface");
    expect(await isSignedIn(claude, "maple", SIGNAL)).toEqual({ ok: false, message: WORDS.unknownInterface });
    r.fake.use("daemon-down");
    const down = await isSignedIn(claude, "maple", SIGNAL);
    expect(down.ok).toBe(true); // docker's failure leaves no GP_CLAUDE=active, which reads as not signed in
    expect(down).toEqual({ ok: true, active: false });
    expect(await isSignedIn({ start: () => Promise.reject(new Error("ENOENT")) }, "maple", SIGNAL)).toEqual({ ok: false, message: WORDS.docker });
  });
});

describe("signInWithToken", () => {
  it("sends the token on stdin, and only there", async () => {
    const { r, claude } = await waitingAgent();
    expect(await signInWithToken(claude, "maple", `  ${TOKEN}\n`, SIGNAL)).toEqual({ ok: true });
    const call = r.fake.calls().find((entry) => entry.argv.includes("token"));
    expect(call?.argv).toEqual(["exec", "-i", "gp-maple", "gp", "claude", "token"]);
    expect(call?.stdin?.attached).toBe(true);
    expect(everywhere(r)).not.toContain(TOKEN);
    expect(await isSignedIn(claude, "maple", SIGNAL)).toEqual({ ok: true, active: true });
  });

  it("refuses an empty token or one with a space before it reaches the agent", async () => {
    const { r, claude } = await waitingAgent();
    for (const token of ["", "   ", "two words", "a\nb"]) {
      const result = await signInWithToken(claude, "maple", token, SIGNAL);
      expect(result.ok).toBe(false);
    }
    expect(r.fake.calls().some((call) => call.argv.includes("token"))).toBe(false);
  });

  it("says a refused token was refused, without repeating it", async () => {
    const { r, claude } = await waitingAgent("token-rejected");
    const result = await signInWithToken(claude, "maple", TOKEN, SIGNAL);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(result.ok === false && result.message).toMatch(/Claude did not accept that token/);
    expect(everywhere(r, result)).not.toContain(TOKEN);
  });

  it("says when docker cannot be started, or the caller has gone", async () => {
    const { claude } = await waitingAgent();
    expect(await signInWithToken({ start: () => Promise.reject(new Error("ENOENT")) }, "maple", TOKEN, SIGNAL)).toEqual({ ok: false, message: WORDS.docker });
    const abort = new AbortController();
    abort.abort();
    expect(await signInWithToken(claude, "maple", TOKEN, abort.signal)).toMatchObject({ ok: false, stopped: true });
  });
});

describe("signInByAddress", () => {
  it("shows the address, sends the code on stdin, and finishes", async () => {
    const { r, claude } = await waitingAgent();
    const progress = createProgress();
    const seen: string[] = [];
    const result = signInByAddress(claude, "maple", async (url, signal) => {
      seen.push(url);
      const code = progress.askCode(url, signal);
      queueMicrotask(() => progress.submitCode(CODE));
      return code;
    }, SIGNAL);
    expect(await result).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^https:\/\/claude\.example\/login\?state=[0-9a-f]{16}$/);
    const login = r.fake.calls().find((call) => call.argv.includes("login"));
    expect(login?.argv).toEqual(["exec", "-i", "gp-maple", "gp", "claude", "login"]);
    expect(login?.stdin?.attached).toBe(true);
    expect(everywhere(r, progress.view())).not.toContain(CODE);
    expect(await isSignedIn(claude, "maple", SIGNAL)).toEqual({ ok: true, active: true });
  });

  it("ends at Claude when the sign-in fails", async () => {
    const { claude } = await waitingAgent("login-fails");
    const result = await signInByAddress(claude, "maple", async () => CODE, SIGNAL);
    expect(result).toEqual({ ok: false, message: "Claude did not accept the sign-in. Try again." });
  });

  it("ends the sign-in and stops the command when the person gives up", async () => {
    const { r, claude } = await waitingAgent();
    const result = await signInByAddress(claude, "maple", () => Promise.reject(new Error("cancelled")), SIGNAL);
    expect(result).toEqual({ ok: false, message: "Signing in to Claude was cancelled." });
    expect(await isSignedIn(claude, "maple", SIGNAL)).toEqual({ ok: true, active: false });
    void r;
  });

  it("never shows an address that is not a web address, and does not wait for a code", async () => {
    const { r, claude } = await waitingAgent();
    const asked = vi.fn(async () => CODE);
    const start: typeof claude.start = async (command, handlers) => {
      if (!command.args.includes("login")) return claude.start(command, handlers);
      let release!: (code: number | null) => void;
      const exited = new Promise<number | null>((resolve) => (release = resolve));
      queueMicrotask(() => handlers.onStdout("GP_CLAUDE_LOGIN_URL=javascript:alert(1)\n"));
      return { write: async () => undefined, end: async () => release(1), kill: async () => release(null), exited };
    };
    const result = await signInByAddress({ start }, "maple", asked, SIGNAL);
    expect(asked).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, message: "GHOST Protocol did not give an address to sign in at. Try again." });
    void r;
  });

  it("gives up on a command that prints no address", async () => {
    vi.useFakeTimers();
    const { claude } = await waitingAgent("ok");
    const silent: typeof claude.start = async (command, handlers) => {
      if (!command.args.includes("login")) return claude.start(command, handlers);
      let release!: (code: number | null) => void;
      const exited = new Promise<number | null>((resolve) => (release = resolve));
      return { write: async () => undefined, end: async () => undefined, kill: async () => release(null), exited };
    };
    const asked = vi.fn(async () => CODE);
    const result = signInByAddress({ start: silent }, "maple", asked, SIGNAL);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await result).toEqual({ ok: false, message: "GHOST Protocol did not give an address to sign in at. Try again." });
    expect(asked).not.toHaveBeenCalled();
  });

  it("stops when the caller goes away, and when docker cannot start", async () => {
    const { claude } = await waitingAgent();
    const abort = new AbortController();
    const waiting = signInByAddress(claude, "maple", () => new Promise<string>(() => undefined), abort.signal);
    await vi.waitFor(() => undefined, { timeout: 200 }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 600));
    abort.abort();
    expect(await waiting).toMatchObject({ ok: false, stopped: true });
    expect(await signInByAddress({ start: () => Promise.reject(new Error("ENOENT")) }, "maple", async () => CODE, SIGNAL)).toEqual({ ok: false, message: WORDS.docker });
  });
});
