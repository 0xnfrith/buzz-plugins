// Agent Stats: what each of your agents did today (turns, time working, commands run, last active, what it is doing now), added up from the
// live telemetry Buzz already receives from the agents you own. It adds a "Stats" tab to an agent's profile and one page that lists every
// agent that has reported. No build step: this file is the plugin. Nothing is published and nothing leaves the computer; the day's tally
// is kept in localStorage under the plugin's id so a restart does not lose it.
//
// Where the numbers come from. A plugin that injects `relay` gets the session, and the session's `agentActivity` holds the owner's agent
// telemetry, already decrypted by the host (the plugin never sees a key). Taking its lease (`activate`) is what makes the host listen.
// Block documents this only for its own Agent Activity plugin, so it is detected, not assumed: without it the plugin says so and shows
// nothing. The telemetry is live only (nothing is stored by the relay or the app), so "today" means "seen while Buzz was open today".

export const inject = ["react", "relay", "agents", "pages"];

export const PLUGIN_ID = "megatech.agent-stats";
export const STORAGE_KEY = PLUGIN_ID;

const MAX_ID = 256; // Buzz's own limit for a turn or session id in a frame
const MAX_TURNS_PER_AGENT = 1000;
const MAX_COMMANDS_PER_TURN = 500;
const MAX_AGENTS = 200;
const KEEP_DAYS = 2; // today and the day before, so a turn that crosses midnight is still counted on the day it began
const FORGET_AGENT_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const FUTURE_SLACK_MS = 5000; // a frame stamped further ahead than this is a clock error, as in Buzz
const SAVE_DELAY_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ENDS = new Set(["turn_completed", "turn_error", "agent_panic"]);
const HEX64 = /^[0-9a-f]{64}$/;

const object = (value) => (value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined);
const text = (value, max = MAX_ID) => (typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const pad = (n) => String(n).padStart(2, "0");
/** A map keyed by names an agent chooses (turn ids), so one called "__proto__" is just a key. */
const dict = () => Object.create(null);

/** The local calendar day of a time, as the key that says which day a turn belongs to. */
export function dayKey(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading frames. A frame is `{ id, agent, createdAt, plaintext }`; the plaintext is JSON: one event, or a "batch" of them.

/** The events inside one frame's plaintext. Anything that does not parse, and Buzz's management requests, give none. */
export function frameItems(plaintext) {
  let raw;
  try {
    raw = JSON.parse(plaintext);
  } catch {
    return [];
  }
  const envelope = object(raw);
  if (!envelope || envelope.kind === "agent_management_request") return [];
  if (envelope.kind === "batch") {
    const events = object(envelope.payload)?.events;
    return Array.isArray(events) ? events.map(object).filter(Boolean) : [];
  }
  return [envelope];
}

/** The model an agent reports in its ACP config options, as its own label for it, or undefined when it reports none. */
export function modelLabel(options) {
  if (!Array.isArray(options)) return undefined;
  for (const raw of options) {
    const option = object(raw);
    if (!option) continue;
    const named = [option.category, option.id, option.name].some((value) => typeof value === "string" && value.toLowerCase() === "model");
    const current = option.currentValue;
    if (!named || typeof current !== "string" || !current) continue;
    // Choices are a flat list, or groups of them.
    const choices = (Array.isArray(option.options) ? option.options : []).flatMap((choice) => {
      const entry = object(choice);
      return Array.isArray(entry?.options) ? entry.options : [entry];
    });
    const chosen = choices.map(object).find((choice) => choice?.value === current);
    const label = text(chosen?.name, 200) ?? current;
    return label.slice(0, 80);
  }
  return undefined;
}

/** Buzz's own shell tool, as it is named on the wire: it is published with ACP kind `other`, so the kind alone does not say it runs a command. */
export const SHELL_TOOL = "buzz-dev-mcp__shell";

/** Whether a tool call is a command: ACP's own kind for running one, or Buzz's shell tool by its exact name. */
export function isCommand(kind, title) {
  return kind === "execute" || title === SHELL_TOOL;
}

/** Plain labels for the tools Buzz itself provides; any other tool is shown under the name its agent gave it. */
const TOOL_LABELS = new Map([
  [SHELL_TOOL, "Command"],
  ["buzz-dev-mcp__read_file", "Read file"],
  ["buzz-dev-mcp__str_replace", "Edit file"],
  ["buzz-dev-mcp__view_image", "View image"],
]);

function basename(value) {
  if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) return undefined;
  const name = value.split(/[/\\]/).filter(Boolean).at(-1);
  return name && name !== "." && name !== ".." ? name.slice(0, 80) : undefined;
}

/**
 * The program a command line runs, and nothing after it: arguments can carry a token. Plain `NAME=value` settings before the program are
 * skipped. Anything the plugin cannot read with certainty (a quoted or substituted value, a program in quotes, a first word that starts
 * with `-` or holds an `=`) gives nothing rather than a guess, because a guess can be a piece of a secret.
 */
export function programName(command) {
  const line = command
    .split(/\r?\n/)
    .find((part) => part.trim())
    ?.replace(/\p{Cc}/gu, " ");
  const words = line?.trim().split(/\s+/) ?? [];
  let word;
  for (const candidate of words) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(candidate)) {
      word = candidate;
      break;
    }
    // A setting whose value could run past this word, or hide something, makes everything after it unreliable.
    if (/["'`$()\\;&|<>{}]/.test(candidate)) return undefined;
  }
  word = word?.replace(/^\(+/, "").replace(/;+$/, "");
  if (!word || word.startsWith("-") || word.includes("=") || !/^[\w.+@%~:/\\-]+$/.test(word)) return undefined;
  const name = word.split(/[/\\]/).filter(Boolean).at(-1);
  return name ? name.slice(0, 40) : undefined;
}

/** A short line that says what a tool call is working on: the program of a command (never its arguments), or the name of a file. */
export function toolDetail(rawInput) {
  let input = rawInput;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return undefined;
    }
  }
  input = object(input);
  if (!input) return undefined;
  if (typeof input.command === "string") {
    const program = programName(input.command);
    if (program) return program;
  }
  return basename(input.path) ?? basename(input.file_path) ?? basename(input.filePath);
}

/**
 * Adds one event of one agent to `state` (what is kept between restarts) and `live` (what is only worth showing now: the current tool
 * call and the context window). It is idempotent: the same event, seen twice, changes nothing the second time. Returns whether `state`
 * changed.
 */
export function foldItem(state, live, agent, item, now = Date.now()) {
  const kind = text(item.kind, 64);
  const turnId = text(item.turnId);
  if (!kind || !turnId || !HEX64.test(agent)) return false;
  const at = Date.parse(item.timestamp);
  if (!Number.isFinite(at) || at > now + FUTURE_SLACK_MS) return false;
  const payload = object(item.payload) ?? {};
  const entry = (state.agents[agent] ??= { turns: dict(), last: 0 });
  let changed = false;
  let turn = entry.turns[turnId];
  if (!turn) {
    const started = kind === "turn_started" ? Date.parse(item.startedAt) : NaN;
    const s = Number.isFinite(started) && started <= at ? started : at;
    turn = entry.turns[turnId] = { s, l: at, d: dayKey(s), c: [] };
    changed = true;
  } else if (kind === "turn_started") {
    const started = Date.parse(item.startedAt);
    if (Number.isFinite(started) && started < turn.s) {
      turn.s = started;
      turn.d = dayKey(started);
      changed = true;
    }
  }
  if (at > turn.l) {
    turn.l = at;
    changed = true;
  }
  if (at > entry.last) {
    entry.last = at;
    changed = true;
  }
  // The first end wins: a heartbeat that arrives late does not reopen a finished turn.
  if (ENDS.has(kind) && turn.e === undefined) {
    turn.e = at;
    changed = true;
  }
  if (kind === "session_config_captured") {
    const model = modelLabel(payload.configOptions);
    if (model && entry.model !== model) {
      entry.model = model;
      changed = true;
    }
  }
  const update = (kind === "acp_read" || kind === "acp_write") && payload.method === "session/update" ? object(object(payload.params)?.update) : undefined;
  if (update) {
    const type = text(update.sessionUpdate, 64);
    if (type === "config_option_update") {
      const model = modelLabel(update.configOptions);
      if (model && entry.model !== model) {
        entry.model = model;
        changed = true;
      }
    } else if (type === "usage_update") {
      const used = finite(update.used);
      const size = finite(update.size);
      if (used !== undefined && size !== undefined && size > 0) {
        const slot = (live[agent] ??= {});
        if (!slot.context || at >= slot.context.at) slot.context = { used, size, at };
      }
    } else if (type === "tool_call" || type === "tool_call_update") {
      const id = text(update.toolCallId);
      if (id) {
        const title = typeof update.title === "string" && update.title ? update.title.slice(0, 120) : undefined;
        if (isCommand(update.kind, title) && !turn.c.includes(id) && turn.c.length < MAX_COMMANDS_PER_TURN) {
          turn.c.push(id);
          changed = true;
        }
        const slot = (live[agent] ??= {});
        const before = slot.task?.id === id ? slot.task : undefined;
        if (!slot.task || at >= slot.task.at) {
          slot.task = {
            id,
            at,
            turnId,
            title: title ?? before?.title,
            detail: toolDetail(update.rawInput) ?? before?.detail,
            status: typeof update.status === "string" ? update.status : before?.status,
          };
        }
      }
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// What is kept, and the numbers made from it.

export function emptyState() {
  return { v: 1, agents: dict() };
}

/** Reads the saved tally. A value that is missing, hand-edited or from another version gives an empty one, never an error. */
export function parseState(raw) {
  const state = emptyState();
  let saved;
  try {
    saved = object(JSON.parse(raw));
  } catch {
    return state;
  }
  const agents = object(saved?.agents);
  if (saved?.v !== 1 || !agents) return state;
  for (const [agent, value] of Object.entries(agents)) {
    const source = object(value);
    if (!HEX64.test(agent) || !source) continue;
    const entry = { turns: dict(), last: finite(source.last) ?? 0 };
    if (text(source.model, 80)) entry.model = source.model;
    for (const [id, row] of Object.entries(object(source.turns) ?? {})) {
      const turn = object(row);
      if (!text(id) || !turn || finite(turn.s) === undefined || finite(turn.l) === undefined || !text(turn.d, 10)) continue;
      const kept = { s: turn.s, l: turn.l, d: turn.d, c: (Array.isArray(turn.c) ? turn.c : []).filter((c) => text(c)).slice(0, MAX_COMMANDS_PER_TURN) };
      if (finite(turn.e) !== undefined) kept.e = turn.e;
      entry.turns[id] = kept;
    }
    state.agents[agent] = entry;
  }
  return state;
}

/** Drops what no longer counts: turns older than yesterday, agents long quiet, and the oldest turns beyond the cap. Returns whether it dropped any. */
export function pruneState(state, now = Date.now()) {
  let dropped = false;
  const oldest = dayKey(now - (KEEP_DAYS - 1) * DAY_MS);
  for (const [agent, entry] of Object.entries(state.agents)) {
    for (const [id, turn] of Object.entries(entry.turns)) {
      if (turn.d < oldest) {
        delete entry.turns[id];
        dropped = true;
      }
    }
    const ids = Object.keys(entry.turns);
    if (ids.length > MAX_TURNS_PER_AGENT) {
      ids.sort((a, b) => entry.turns[a].s - entry.turns[b].s);
      for (const id of ids.slice(0, ids.length - MAX_TURNS_PER_AGENT)) delete entry.turns[id];
      dropped = true;
    }
    if (!ids.length && now - entry.last > FORGET_AGENT_AFTER_MS) {
      delete state.agents[agent];
      dropped = true;
    }
  }
  const agents = Object.entries(state.agents);
  if (agents.length > MAX_AGENTS) {
    agents.sort((a, b) => b[1].last - a[1].last);
    for (const [agent] of agents.slice(MAX_AGENTS)) delete state.agents[agent];
    dropped = true;
  }
  return dropped;
}

/** One agent's numbers for today. `working` is the set of `agent:turnId` keys Buzz says are in progress right now. */
export function agentStats(state, agent, { now = Date.now(), working = new Set(), live = {} } = {}) {
  const entry = state.agents[agent];
  if (!entry) return undefined;
  const today = dayKey(now);
  let turns = 0;
  const spans = [];
  let commands = 0;
  const running = new Set();
  for (const [id, turn] of Object.entries(entry.turns)) {
    if (turn.d !== today) continue;
    turns++;
    commands += turn.c.length;
    const open = turn.e === undefined && working.has(`${agent}:${id}`);
    if (open) running.add(id);
    // A finished turn lasts until its end; a running one until now; one that stopped reporting without an end, until its last frame.
    spans.push([turn.s, Math.max(turn.s, turn.e ?? (open ? now : turn.l))]);
  }
  // Turns of one agent can overlap (two channels at once): the time they share counts once, so the total never passes the clock.
  let workingMs = 0;
  let current;
  for (const span of spans.sort((a, b) => a[0] - b[0])) {
    if (current && span[0] <= current[1]) current[1] = Math.max(current[1], span[1]);
    else {
      if (current) workingMs += current[1] - current[0];
      current = [...span];
    }
  }
  if (current) workingMs += current[1] - current[0];
  const busy = running.size > 0;
  const slot = live[agent] ?? {};
  return {
    agent,
    turns,
    workingMs,
    commands,
    lastActive: entry.last || undefined,
    working: busy,
    model: entry.model,
    // The tool call shown is one of a turn that is running now, never a leftover of the turn before.
    task: busy && running.has(slot.task?.turnId) ? slot.task : undefined,
    context: slot.context,
  };
}

/** Time as "42s", "7m 05s" or "1h 12m". */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${pad(total % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

/** "just now", "12 min ago", "3 h ago", or the date for anything older than a day. */
export function formatAgo(ms, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - ms) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The context window as "42% of 200,000". */
export function formatContext(context) {
  if (!context) return undefined;
  const percent = Math.min(100, Math.max(0, Math.round((context.used / context.size) * 100)));
  return `${percent}% of ${Math.round(context.size).toLocaleString("en-US")}`;
}

/** What an agent is doing right now, from its current tool call. */
export function formatTask(task) {
  if (!task?.title) return undefined;
  const title = TOOL_LABELS.get(task.title) ?? task.title;
  return task.detail ? `${title} · ${task.detail}` : title;
}

/**
 * The store: the tally, the live details, and the link to Buzz's telemetry. `storage` is localStorage (or anything with getItem and
 * setItem), `schedule` and `cancel` are the timer used to save once in a while, not on every frame.
 */
export function createStatsStore({ storage, key = STORAGE_KEY, now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id) } = {}) {
  let scope = "";
  let state = emptyState();
  let live = {};
  let working = new Set();
  let status = "connecting";
  let seen = new Set();
  let timer;
  let dirty = false;
  let version = 0;
  let snapshot = Object.freeze({ version, status });
  const listeners = new Set();
  const slot = () => `${key}:${scope}`;

  function publish() {
    version++;
    snapshot = Object.freeze({ version, status });
    for (const listener of [...listeners]) listener();
  }
  function save() {
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    try {
      pruneState(state, now());
      storage?.setItem(slot(), JSON.stringify(state));
    } catch {
      // A full or blocked store only means the tally is not kept across a restart.
    }
  }
  function touch() {
    dirty = true;
    timer ??= schedule(save, SAVE_DELAY_MS);
  }
  function load() {
    try {
      state = parseState(storage?.getItem(slot()) ?? "");
    } catch {
      state = emptyState();
    }
    pruneState(state, now());
  }
  return {
    /** Moves to another community: saves this one's tally and reads that one's. */
    useScope(next) {
      if (next === scope) return;
      this.flush();
      scope = next;
      live = {};
      seen = new Set();
      working = new Set();
      load();
      publish();
    },
    /** Folds in the frames not seen before. `inProgress` lists the `agent:turnId` keys Buzz says are working now. */
    ingest(frames, inProgress = []) {
      let changed = false;
      const current = new Set();
      for (const frame of frames) {
        if (!frame || typeof frame.id !== "string") continue;
        current.add(frame.id);
        if (seen.has(frame.id)) continue;
        for (const item of frameItems(frame.plaintext)) changed = foldItem(state, live, frame.agent, item, now()) || changed;
      }
      seen = current; // what Buzz no longer holds cannot arrive again
      const next = new Set(inProgress);
      const moved = next.size !== working.size || [...next].some((value) => !working.has(value));
      working = next;
      if (changed) touch();
      if (changed || moved) publish();
      return changed;
    },
    setStatus(next) {
      if (next === status) return;
      status = next;
      publish();
    },
    /** One agent's numbers now, or undefined when it has not reported. */
    statsFor: (agent, at = now()) => agentStats(state, agent, { now: at, working, live }),
    /** The agents that have reported, the busy ones first, then the most recently active. */
    agents: (at = now()) =>
      Object.keys(state.agents)
        .map((agent) => agentStats(state, agent, { now: at, working, live }))
        .sort((a, b) => Number(b.working) - Number(a.working) || (b.lastActive ?? 0) - (a.lastActive ?? 0)),
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush() {
      if (timer !== undefined) cancel(timer);
      timer = undefined;
      if (dirty) save();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The look. Colours and type come from the host's tokens, each with a fallback; every class is the plugin's own.

export const CSS = `
.megatech-agent-stats{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;min-width:0;padding:16px;color:var(--text-standard,inherit)}
.megatech-agent-stats--page{height:100%;min-height:0;overflow:auto;padding:24px 28px 32px}
.megatech-agent-stats__head{display:flex;flex-direction:column;gap:4px}
.megatech-agent-stats__title{margin:0;font-size:1.25rem;font-weight:600}
.megatech-agent-stats__note,.megatech-agent-stats__status,.megatech-agent-stats__empty{margin:0;font-size:.8125rem;line-height:1.45;color:var(--text-subtle,var(--text-metadata,inherit))}
.megatech-agent-stats__status[data-state="interrupted"],.megatech-agent-stats__status[data-state="unavailable"],.megatech-agent-stats__status[data-state="missing"]{color:var(--text-standard,inherit);border-left:3px solid var(--accent-9,currentColor);padding-left:10px}
.megatech-agent-stats__list{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
.megatech-agent-stats__card{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--border-standard,color-mix(in srgb,currentColor 18%,transparent));border-radius:10px;background:var(--surface-panel,transparent)}
.megatech-agent-stats__who{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 12px}
.megatech-agent-stats__name{margin:0;font-size:1rem;font-weight:600;overflow-wrap:anywhere}
.megatech-agent-stats__badge{font-size:.75rem;font-weight:500;color:var(--text-subtle,inherit)}
.megatech-agent-stats__badge[data-working="true"]{color:var(--text-standard,inherit)}
.megatech-agent-stats__badge[data-working="true"]::before{content:"";display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%;background:var(--accent-9,currentColor)}
.megatech-agent-stats__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px 16px;margin:0}
.megatech-agent-stats__item{display:flex;flex-direction:column;gap:2px;min-width:0;margin:0}
.megatech-agent-stats__task{margin:0}
.megatech-agent-stats__label{font-size:.75rem;color:var(--text-subtle,var(--text-metadata,inherit))}
.megatech-agent-stats__value{margin:0;font-size:1.125rem;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.megatech-agent-stats__value--text{font-size:.875rem;font-weight:500}
@media (prefers-reduced-motion:no-preference){.megatech-agent-stats__badge[data-working="true"]::before{animation:megatech-agent-stats-pulse 1.6s ease-in-out infinite}}
@keyframes megatech-agent-stats-pulse{50%{opacity:.35}}
`;

const STATUS_TEXT = {
  listening: "Listening to your agents.",
  connecting: "Connecting to your agents' telemetry…",
  disabled: "Waiting to listen to your agents.",
  interrupted: "The connection to your agents' telemetry was interrupted. Counts may miss what happened meanwhile.",
  unavailable: "Buzz is not offering agent telemetry for this community right now, so there is nothing to show.",
  missing: "This version of Buzz does not share agent telemetry with plugins, so there is nothing to show.",
};
const NOTE = "Counted while Buzz is open, from today's activity of your own agents. Kept on this computer, never sent anywhere.";

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const store = createStatsStore({ storage: safeStorage() });
  const useStore = () => React.useSyncExternalStore(store.subscribe, store.snapshot);

  ctx.effect(() => {
    // [DOM] No style service in API v1: one <style> element, removed when the plugin's scope ends.
    const style = document.createElement("style");
    style.dataset.megatechAgentStats = "";
    style.textContent = CSS;
    document.head.append(style);
    return () => style.remove();
  });

  // The link to Buzz's telemetry: take the lease for each ready session, fold in what it holds, and let go when the session changes.
  ctx.effect(() => {
    let session;
    let release;
    let stopActivity;
    const unbind = () => {
      stopActivity?.();
      release?.();
      stopActivity = release = undefined;
    };
    const bind = () => {
      const connection = ctx.relay.snapshot();
      const next = connection.status === "ready" ? connection.session : undefined;
      if (next === session) return;
      unbind();
      session = next;
      if (!next) {
        store.setStatus("connecting");
        return;
      }
      store.useScope(String(connection.scope ?? connection.origin ?? ""));
      const activity = next.agentActivity;
      if (!activity || typeof activity.activate !== "function" || typeof activity.snapshot !== "function" || typeof activity.subscribe !== "function") {
        store.setStatus("missing");
        return;
      }
      release = activity.activate();
      const pull = () => {
        const held = activity.snapshot();
        const inProgress = (held.turns ?? []).filter((turn) => turn.state === "working").map((turn) => `${turn.agent}:${turn.turnId}`);
        store.ingest(held.records ?? [], inProgress);
        store.setStatus(typeof held.status === "string" ? held.status : "connecting");
      };
      stopActivity = activity.subscribe(pull);
      pull();
    };
    const stop = ctx.relay.subscribe(bind);
    bind();
    return () => {
      stop();
      unbind();
      store.flush();
    };
  });

  const useNow = (fast) => {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
      const timer = setInterval(() => setNow(Date.now()), fast ? 1000 : 15000);
      return () => clearInterval(timer);
    }, [fast]);
    return now;
  };
  const useNames = () => {
    const snap = React.useSyncExternalStore(ctx.agents.subscribe, ctx.agents.snapshot);
    return React.useMemo(() => new Map([...(snap?.running ?? []), ...(snap?.agents ?? [])].map((agent) => [agent.pubkey, agent.name])), [snap]);
  };

  const item = (label, value) =>
    h(
      "div",
      { className: "megatech-agent-stats__item", key: label },
      h("dt", { className: "megatech-agent-stats__label" }, label),
      h("dd", { className: `megatech-agent-stats__value${typeof value === "string" && value.length > 12 ? " megatech-agent-stats__value--text" : ""}` }, value),
    );

  /** The numbers of one agent, as a list of terms. */
  function Numbers({ stats, now }) {
    const task = formatTask(stats.task);
    // The task is a line of its own, outside the grid: an item that spans every column would keep the grid from collapsing its empty
    // columns, and the figures of a working agent would sit in narrow columns while an idle agent's spread across the card.
    return h(
      React.Fragment,
      null,
      h(
        "dl",
        { className: "megatech-agent-stats__grid" },
        item("Turns today", String(stats.turns)),
        item("Time working", formatDuration(stats.workingMs)),
        item("Commands run", String(stats.commands)),
        item("Last active", stats.lastActive ? formatAgo(stats.lastActive, now) : "never"),
        stats.model ? item("Model", stats.model) : null,
        stats.context ? item("Context window used", formatContext(stats.context)) : null,
      ),
      stats.working ? h("dl", { className: "megatech-agent-stats__task" }, item("Doing now", task ?? "Working")) : null,
    );
  }

  const StatusLine = ({ status }) => h("p", { className: "megatech-agent-stats__status", "data-state": status }, STATUS_TEXT[status] ?? STATUS_TEXT.connecting);

  /** The tab in an agent's profile. */
  function AgentStatsTab({ agent }) {
    const { status } = useStore();
    const stats = store.statsFor(agent.pubkey);
    const now = useNow(Boolean(stats?.working));
    const shown = store.statsFor(agent.pubkey, now);
    return h(
      "div",
      { className: "megatech-agent-stats", "data-agent-stats": "tab" },
      shown
        ? h(Numbers, { stats: shown, now })
        : h("p", { className: "megatech-agent-stats__empty" }, "Nothing seen from this agent yet. Its numbers appear here while Buzz is open and it works."),
      h(StatusLine, { status }),
      h("p", { className: "megatech-agent-stats__note" }, NOTE),
    );
  }

  /** The page: every agent that has reported. */
  function AgentStatsPage() {
    const { status } = useStore();
    const names = useNames();
    const busy = store.agents().some((stats) => stats.working);
    const now = useNow(busy);
    const rows = store.agents(now);
    return h(
      "div",
      { className: "megatech-agent-stats megatech-agent-stats--page", "data-agent-stats": "page" },
      h("div", { className: "megatech-agent-stats__head" }, h("h1", { className: "megatech-agent-stats__title" }, "Agent stats"), h("p", { className: "megatech-agent-stats__note" }, NOTE)),
      h(StatusLine, { status }),
      rows.length
        ? h(
            "ul",
            { className: "megatech-agent-stats__list" },
            rows.map((stats) =>
              h(
                "li",
                { key: stats.agent, className: "megatech-agent-stats__card", "data-agent": stats.agent },
                h(
                  "div",
                  { className: "megatech-agent-stats__who" },
                  h("h2", { className: "megatech-agent-stats__name" }, names.get(stats.agent) ?? `Agent ${stats.agent.slice(0, 8)}`),
                  h("span", { className: "megatech-agent-stats__badge", "data-working": String(stats.working) }, stats.working ? "Working" : "Idle"),
                ),
                h(Numbers, { stats, now }),
              ),
            ),
          )
        : h("p", { className: "megatech-agent-stats__empty" }, "No agent has reported yet. They appear here as soon as one of your agents works while Buzz is open."),
    );
  }

  // The agent's profile is the click target. Buzz adds the tab only for agents it runs or hosts; an older Buzz has no `registerTab`.
  if (typeof ctx.agents.registerTab === "function") ctx.agents.registerTab({ id: "stats", title: "Stats", component: AgentStatsTab });
  ctx.pages.register({ id: "stats", title: "Agent stats", primary: true, layout: "workspace", component: AgentStatsPage });
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined; // blocked storage: the tally lasts until Buzz closes
  }
}
