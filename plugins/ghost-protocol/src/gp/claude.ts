// The agent's Claude sign-in, by the two ways the interface gives (section 7), as `gp` commands run in the agent's container:
//   a setup token the person pasted, on stdin of `gp claude token`; and an address from `gp claude login`, where the person signs in and
//   gets a code that goes on stdin. The token and the code never become a command argument, a message or a log line.
// The token's way runs inside Create, since the form has the token before Create starts. The address's way needs the person to act
// while it runs, which Buzz's Create dialog does not allow (it shows its own "Meet your remote agent" step with a spinner and hides the
// type's form), so it runs from the agent's panel after the agent is made.
import { commands } from "./commands";
import { LIMITS, WORDS } from "./constants";
import { unknownInterface, type Gp } from "./protocol";
import { run, startRun, type StartDocker } from "./run";

/** What GHOST Protocol said when it refused: its code and its one line. */
export type Said = Readonly<{ code: string; message: string }>;

/** `said` is there when GHOST Protocol itself refused, so the person can read its own words and code beside ours. */
export type Result = Readonly<{ ok: true }> | Readonly<{ ok: false; message: string; stopped?: true; said?: Said }>;

export type Claude = Readonly<{ start: StartDocker }>;

const stopped = { ok: false, message: "Stopped.", stopped: true } as const;
const fail = (message: string, said?: Said): Result => (said === undefined ? { ok: false, message } : { ok: false, message, said });

/** The most of GHOST Protocol's own line that is shown: a long one is cut, so it cannot fill the panel. */
const SAID_MAX = 200;

/**
 * GHOST Protocol's refusal as the person sees it. It never prints a secret, but this is the one place its words reach the screen
 * from a command that was given one, so any piece of `secrets` that turns up in them is taken out before anything is shown.
 */
function saidBy(gp: Gp, secrets: readonly string[]): Said | undefined {
  if (gp.error === undefined) return undefined;
  const clean = (text: string) => secrets.filter((secret) => secret !== "").reduce((rest, secret) => rest.split(secret).join("…"), text);
  const line = clean(gp.error.message).trim();
  return { code: clean(gp.error.code).trim(), message: line.length > SAID_MAX ? `${line.slice(0, SAID_MAX)}…` : line };
}

/** Whether the agent has a Claude sign-in: `gp claude status`. */
export async function isSignedIn(claude: Claude, slug: string, signal: AbortSignal): Promise<Readonly<{ ok: true; active: boolean }> | Extract<Result, { ok: false }>> {
  const outcome = await run(claude.start, commands.claudeStatus(slug), { timeoutMs: LIMITS.quick, signal });
  if (outcome.kind === "aborted") return stopped;
  if (outcome.kind === "cannot-start") return { ok: false, message: WORDS.docker };
  if (outcome.kind === "timeout") return { ok: false, message: "GHOST Protocol did not answer in time." };
  if (unknownInterface(outcome.gp)) return { ok: false, message: WORDS.unknownInterface };
  return { ok: true, active: outcome.gp.values.get("CLAUDE") === "active" };
}

/** Way B: the setup token goes to `gp claude token` on stdin. The caller forgets the token afterwards, whatever this says. */
export async function signInWithToken(claude: Claude, slug: string, token: string, signal: AbortSignal): Promise<Result> {
  const text = token.trim();
  if (text === "" || /\s/.test(text)) return fail("Paste a Claude setup token first (run claude setup-token in a terminal).");
  const outcome = await run(claude.start, commands.claudeToken(slug), { stdin: `${text}\n`, timeoutMs: LIMITS.quick, signal });
  if (outcome.kind === "aborted") return stopped;
  if (outcome.kind === "cannot-start") return fail(WORDS.docker);
  if (outcome.kind === "timeout") return fail("GHOST Protocol did not answer in time.");
  if (unknownInterface(outcome.gp)) return fail(WORDS.unknownInterface);
  if (outcome.code !== 0 || outcome.gp.error || outcome.gp.values.get("CLAUDE") !== "active") {
    return fail("Claude did not accept that token. Make a new one and paste it.", saidBy(outcome.gp, [text]));
  }
  return { ok: true };
}

const LOGIN_LINE = /^GP_CLAUDE_LOGIN_URL=(.*)$/;
/** The only kind of address shown to the person: a web address, never another scheme. */
const WEB_ADDRESS = /^https:\/\/[^\s<>"']+$/;

/**
 * Way A: `gp claude login` prints an address and waits for a code on stdin. `askCode` shows the address and resolves with the code the
 * person copies back, or rejects when they give up.
 */
export async function signInByAddress(claude: Claude, slug: string, askCode: (url: string, signal: AbortSignal) => Promise<string>, signal: AbortSignal): Promise<Result> {
  let cancelled = false;
  let badAddress = false;
  let asked = false;
  // The code only to scrub GHOST Protocol's words of it (saidBy): it is never kept anywhere else.
  let given = "";
  let resolveRunning!: (running: Awaited<ReturnType<typeof startRun>>) => void;
  const running = new Promise<Awaited<ReturnType<typeof startRun>>>((resolve) => (resolveRunning = resolve));
  const answer = async (url: string) => {
    const process = await running;
    try {
      const code = await askCode(url, signal);
      given = code;
      await process.end(`${code}\n`);
    } catch {
      cancelled = true;
      await process.kill();
    }
  };
  const refuse = async () => {
    badAddress = true;
    await (await running).kill();
  };
  const started = await startRun(claude.start, commands.claudeLogin(slug), {
    signal,
    timeoutMs: LIMITS.login,
    onLine(line) {
      const address = LOGIN_LINE.exec(line)?.[1]?.trim();
      if (address === undefined || asked) return;
      asked = true;
      if (WEB_ADDRESS.test(address)) void answer(address);
      else void refuse();
    },
  });
  resolveRunning(started);
  // The command prints its address at once. One that does not within the time docker normally takes has nothing to sign in at.
  const waitForAddress = setTimeout(() => {
    if (!asked) void refuse();
  }, LIMITS.quick);
  const outcome = await started.done.finally(() => clearTimeout(waitForAddress));
  if (outcome.kind === "cannot-start") return fail(WORDS.docker);
  if (outcome.kind === "aborted") return stopped;
  if (badAddress) return fail("GHOST Protocol did not give an address to sign in at. Try again.");
  if (outcome.kind === "timeout") return fail("Signing in to Claude took too long. Try again.");
  if (cancelled) return fail("Signing in to Claude was cancelled.");
  if (unknownInterface(outcome.gp)) return fail(WORDS.unknownInterface);
  if (outcome.code !== 0 || outcome.gp.error || outcome.gp.values.get("CLAUDE") !== "active") return fail("Claude did not accept the sign-in. Try again.", saidBy(outcome.gp, [given]));
  return { ok: true };
}
