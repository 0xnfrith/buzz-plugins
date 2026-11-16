// What the Create form shows while it works: the steps and where each is, the address to sign in at (way A), and the public key of an
// agent the relay refused. One small store the flow writes and the form reads. It keeps nothing secret: a Claude token has its own holder
// below, in memory only, and no step's note is ever made from output that could carry one.

export type StepId = "docker" | "pull" | "init" | "start" | "updater" | "tag" | "claude" | "wait";
export type StepState = "waiting" | "running" | "done" | "skipped" | "failed";

export const STEP_LABELS: Readonly<Record<StepId, string>> = {
  docker: "Check Docker",
  pull: "Download GHOST Protocol",
  init: "Make the agent's key",
  start: "Start the agent",
  updater: "Start the update helper",
  tag: "Give it your attestation",
  claude: "Sign in to Claude",
  wait: "Wait for it to connect",
};
export const STEP_ORDER: readonly StepId[] = ["docker", "pull", "init", "start", "updater", "tag", "claude", "wait"];

export type Step = Readonly<{ id: StepId; label: string; state: StepState; note: string }>;

export type View = Readonly<{
  /** Create has started (and not been reset): the form shows the steps. */
  active: boolean;
  steps: readonly Step[];
  /** Way A: the address `gp claude login` printed; the person signs in there and sends the code back. */
  login: Readonly<{ url: string }> | undefined;
  /** The relay does not accept the agent: its public key, for the person to hand to the relay's admin. */
  refused: Readonly<{ pubkey: string }> | undefined;
  /** The one line Create failed with, while it has. */
  failure: string | undefined;
}>;

const blank = (): View => ({ active: false, steps: STEP_ORDER.map((id) => ({ id, label: STEP_LABELS[id], state: "waiting", note: "" })), login: undefined, refused: undefined, failure: undefined });

/** A store React reads with `useSyncExternalStore`: `view()` is the same object until something changes. */
export type Progress = Readonly<{
  view(): View;
  subscribe(listener: () => void): () => void;
  /** Back to nothing active: a new form starts with no trace of an earlier one. */
  reset(): void;
  /** Starts again: every step waits. `skipUpdater` marks the helper step skipped (the person said no). */
  begin(options: { skipUpdater: boolean }): void;
  /** Create continues an agent whose first steps were done earlier (a retry, or Buzz started again): they show as done. */
  resume(options: { skipUpdater: boolean }): void;
  set(id: StepId, state: StepState, note?: string): void;
  refused(pubkey: string): void;
  fail(message: string): void;
  /**
   * Shows the address and waits for the person to send the code. Rejects when they cancel or `signal` aborts. Only the code goes through
   * here, and only to the one waiting call.
   */
  askCode(url: string, signal: AbortSignal): Promise<string>;
  /** The person sends the code. False when none is awaited or it is empty. */
  submitCode(code: string): boolean;
  /** The person gives up on signing in. */
  cancelCode(): void;
}>;

export function createProgress(): Progress {
  let view = blank();
  const listeners = new Set<() => void>();
  let waiting: { resolve(code: string): void; reject(error: Error): void } | undefined;
  const publish = (next: View) => {
    view = next;
    for (const listener of [...listeners]) listener();
  };
  const patch = (id: StepId, change: Partial<Pick<Step, "state" | "note">>): View => ({
    ...view,
    steps: view.steps.map((step) => (step.id === id ? { ...step, ...change } : step)),
  });
  return {
    view: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    reset() {
      publish(blank());
    },
    begin({ skipUpdater }) {
      const fresh = blank();
      publish({ ...fresh, active: true, steps: fresh.steps.map((step) => (step.id === "updater" && skipUpdater ? { ...step, state: "skipped" } : step)) });
    },
    resume({ skipUpdater }) {
      const fresh = blank();
      const earlier = new Set<StepId>(["docker", "pull", "init"]);
      publish({
        ...fresh,
        active: true,
        steps: fresh.steps.map((step) =>
          earlier.has(step.id) ? { ...step, state: "done" } : step.id === "updater" && skipUpdater ? { ...step, state: "skipped" } : step,
        ),
      });
    },
    set(id, state, note = "") {
      publish(patch(id, { state, note }));
    },
    refused(pubkey) {
      publish({ ...view, refused: { pubkey } });
    },
    fail(message) {
      publish({ ...view, failure: message, login: undefined });
    },
    askCode(url, signal) {
      waiting?.reject(new Error("Another sign-in started."));
      return new Promise<string>((resolve, reject) => {
        const settle = () => {
          waiting = undefined;
          signal.removeEventListener("abort", onAbort);
          publish({ ...view, login: undefined });
        };
        const onAbort = () => {
          settle();
          reject(new Error("Stopped."));
        };
        if (signal.aborted) return reject(new Error("Stopped."));
        signal.addEventListener("abort", onAbort, { once: true });
        waiting = {
          resolve: (code) => {
            settle();
            resolve(code);
          },
          reject: (error) => {
            settle();
            reject(error);
          },
        };
        publish({ ...view, login: { url } });
      });
    },
    submitCode(code) {
      const trimmed = code.trim();
      if (!waiting || trimmed === "") return false;
      waiting.resolve(trimmed);
      return true;
    },
    cancelCode() {
      waiting?.reject(new Error("Signing in to Claude was cancelled."));
    },
  };
}

/**
 * A Claude setup token the person pasted, held in memory for the one command that takes it. It is never written to the agent's `config`
 * (Buzz keeps that), to storage, to a note or to a log, and it is gone once the agent has it, when it is refused, or when the form closes.
 */
export type Secrets = Readonly<{
  token(): string;
  setToken(value: string): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}>;

export function createSecrets(): Secrets {
  let token = "";
  const listeners = new Set<() => void>();
  const change = (next: string) => {
    if (next === token) return;
    token = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    token: () => token,
    setToken: (value) => change(value),
    clear: () => change(""),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
