// Types for index.mjs, for a plugin test written in TypeScript.

export interface Scenario {
  docker?: "ok" | "missing" | "daemon-down" | "permission-denied";
  dockerVersion?: string;
  interface?: number;
  pull?: "ok" | "not-found" | "unauthorized" | "network";
  authTag?: "accept" | "reject";
  claude?: "not-active" | "active";
  loginCode?: string | null;
  relay?: "connected" | "refused-not-member" | "unreachable";
  connectingPolls?: number;
  /** `image` and `digest` are what the status prints for them, whatever they are (a test gives a malformed one on purpose); left out, the status has no such key. */
  update?: { available: boolean; version: string | null; image?: string | null; digest?: string | null };
  updateStartPolls?: number;
  updatingPolls?: number;
  updateGapPolls?: number | "forever";
  updateGapKind?: "gone" | "stopped";
  dockerStyle?: "classic" | "current";
  selfUpdate?: "yes" | "no";
  statusFormat?: "pretty" | "compact";
  statusPreamble?: boolean;
  statusOverride?: Record<string, unknown> | null;
  fail?: Partial<Record<"init" | "authTag" | "claudeLogin" | "claudeToken" | "updateRequest" | "updateRollback", boolean | { code?: string; message?: string }>>;
  delayMs?: Record<string, number>;
  hang?: string[];
  logLines?: boolean;
}

export type Preset =
  | "ok" | "docker-missing" | "daemon-down" | "permission-denied" | "pull-not-found" | "pull-unauthorized" | "pull-offline" | "init-fails"
  | "bad-auth-tag" | "claude-signed-in" | "login-fails" | "token-rejected" | "relay-refuses" | "relay-unreachable" | "update-available"
  | "update-pinned" | "update-image-null" | "update-image-malformed" | "no-self-update" | "docker-29-wording" | "update-gap" | "update-gap-stopped" | "update-never-returns" | "unknown-interface" | "status-error" | "status-compact-with-preamble";

/** A preset name, several joined with commas, or an object. */
export type ScenarioInput = Preset | (string & {}) | Scenario;

export interface Result {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  /** The process was still there after `timeoutMs` and was killed. */
  timedOut: boolean;
}

export interface Running {
  child: import("node:child_process").ChildProcessWithoutNullStreams;
  exited: Promise<Result>;
  stdout(): string;
  stderr(): string;
  write(text: string): boolean;
  end(): void;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface Call {
  n: number;
  argv: string[];
  exit?: number;
  refused?: true;
  /** The attestation tag, as text: it is public. */
  tag?: string;
  stdin?: { attached: boolean; bytes: number; sha256: string; terminated?: boolean };
}

export interface SeedOptions {
  condition?: "needs-auth-tag" | "needs-claude" | "running" | "stopped";
  slug?: string;
  name?: string;
  relay?: string;
  owner?: string;
  version?: string;
  previousVersion?: string | null;
  /** The agent's image, pinned: `<registry>/ghost-protocol:<tag>@sha256:<64 hex>`. By default `imageOfVersion(version)`. */
  image?: string;
  container?: boolean;
  /** The update helper beside the agent: there when the scenario's `selfUpdate` is "yes", by default. */
  updater?: boolean;
}

export interface FakeDocker {
  binDir: string;
  stateDir: string;
  env(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  missingEnv(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  use(scenario: ScenarioInput): void;
  tweak(changes: Scenario): void;
  start(argv: string[], options?: { env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number }): Running;
  run(argv: string[], options?: { env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number }): Promise<Result>;
  calls(): Call[];
  state(): { counter: number; images: Record<string, unknown>; volumes: Record<string, any>; containers: Record<string, any> };
  patchState<T>(change: (state: ReturnType<FakeDocker["state"]>) => T): T;
  seed(options?: SeedOptions): { container: string; volume: string; pubkey: string; owner: string; image: string };
  cleanup(): void;
}

export const BIN_DIR: string;
export const PRESET_NAMES: Preset[];
export function ownerKey(label?: string): string;
/** The image of one version as the fake pins it (`<repository>/ghost-protocol:<tag>@sha256:<digest>`, a made-up digest the same for the same tag). */
export function imageOfVersion(tag: string, repository?: string): string;
export function attestationTag(owner?: string, conditions?: string): string;
export function createFakeDocker(options?: { scenario?: ScenarioInput; dir?: string }): FakeDocker;
