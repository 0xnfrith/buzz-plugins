// ---- State: one immutable snapshot, replaced on every change ----------------------------
import { apple, LEADERS, OLD_STORAGE_KEY, PENDING_MS, PERF_LEVELS, SETTING_KEYS, STORAGE_KEY } from "./constants";
import * as perf from "./perf";
import type { VimState } from "./types";

type SettingName = (typeof SETTING_KEYS)[number];

const read = (key: string, names: readonly SettingName[]): Partial<VimState> => {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    const valid = (name: SettingName) =>
      name === "leader"
        ? Object.hasOwn(LEADERS, saved.leader)
        : name === "perf"
          ? PERF_LEVELS.some((entry) => entry.id === saved.perf)
          : typeof saved[name] === "boolean";
    return Object.fromEntries(names.filter(valid).map((name) => [name, saved[name]]));
  } catch {
    return {};
  }
};
const load = (): Partial<VimState> => ({
  ...read(OLD_STORAGE_KEY, ["enabled", "statusLine"]),
  ...read(STORAGE_KEY, SETTING_KEYS),
});

const initialState = (): VimState =>
  Object.freeze({
    enabled: true,
    statusLine: true,
    composerNormal: true,
    mode: "normal",
    textMode: "insert",
    visual: "",
    region: "main",
    count: 0,
    operator: "",
    prefix: "",
    leader: apple ? "ctrl-w" : "space",
    perf: "",
    ...load(),
  });

export let state: VimState = initialState();
const listeners = new Set<() => void>();

// A new revision, or the same one enabled again (the host reuses an evaluated module): start from the saved settings.
export const resetState = () => {
  state = initialState();
  listeners.clear();
  // Work a disposed run left in flight (a timer, a settle loop) is live again from here; it lasts seconds at most. The key
  // counter is not reset, so a run cannot mistake the old run's epoch for its own.
  disposed = false;
};

export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const set = (patch: Partial<VimState>) => {
  if (perf.active()) {
    perf.count("set");
    if ((Object.keys(patch) as (keyof VimState)[]).every((name) => state[name] === patch[name])) perf.count("set, nothing changed");
    perf.count("set, listeners called", listeners.size);
  }
  state = Object.freeze({ ...state, ...patch });
  for (const listener of [...listeners]) listener();
};
// Changes the snapshot without telling anyone (the caller calls syncFocus next, which does).
export const setQuietly = (patch: Partial<VimState>) => {
  state = Object.freeze({ ...state, ...patch });
};
export const setting = (patch: Partial<VimState>) => {
  set(patch);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(STORAGE_KEY, SETTING_KEYS), ...patch }));
  } catch {}
};

// ---- The plugin's life ------------------------------------------------------------------
export let disposed = false;
export const dispose = () => {
  disposed = true;
  clearTimeout(pendingTimer);
};
// Counts key presses, so a landing that finishes late can tell the user has moved on.
export let keyEpoch = 0;
export const bumpKeyEpoch = () => void keyEpoch++;
// A key held down repeats: the repeats are the press it began with, not another key (a held `o` must not end its own landing).
export const onAnyKey = (event: KeyboardEvent) => {
  if (!event.repeat) bumpKeyEpoch();
};

// Pending count/operator expire like vim's timeoutlen, so a stray "g" cannot linger.
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
export const armPending = () => {
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(clearPending, PENDING_MS);
};
export function clearPending() {
  clearTimeout(pendingTimer);
  if (state.count || state.operator || state.prefix) set({ count: 0, operator: "", prefix: "" });
}
export const takeCount = () => {
  const n = Math.max(1, state.count);
  clearPending();
  return n;
};
