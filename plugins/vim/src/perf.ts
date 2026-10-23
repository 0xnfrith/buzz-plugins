// ---- Performance trace ---------------------------------------------------------------------------
// Off by default (a select on the Vim mode page). Two levels:
//   paint  for every key, the time from the keydown reaching the window to the frame after it (a message
//          posted after requestAnimationFrame arrives once the frame is on screen), and the page's event-loop
//          lag once a second
//   full   also the time spent in each of the plugin's own handlers (inclusive of the handlers they call),
//          how often each called querySelectorAll, closest, getBoundingClientRect, getClientRects and
//          Selection.modify (the page's own calls are counted apart), and named event counters
// Ctrl+Alt+Shift+P copies the numbers as JSON to the clipboard, Ctrl+Alt+Shift+R starts over; window.__vimPerf
// has the same for a test. Nothing is kept, sent or written anywhere else.
import { MESSAGE } from "./constants";
import type { PerfLevel } from "./types";

const RING = 5000;
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);
const APIS: [owner: string, name: string][] = [
  ["Element", "querySelectorAll"],
  ["Document", "querySelectorAll"],
  ["Element", "closest"],
  ["Element", "getBoundingClientRect"],
  ["Element", "getClientRects"],
  ["Selection", "modify"],
  ["Selection", "toString"],
  ["Element", "scrollIntoView"],
  ["HTMLElement", "focus"],
];

interface HandlerStat {
  n: number;
  ms: number;
  max: number;
  api: Record<string, number>;
  apiMs: Record<string, number>;
}

let level: PerfLevel = "";
let current = ""; // the plugin handler running now, for attributing DOM calls
let cleanup: (() => void)[] = [];
let paint: [key: string, ms: number][] = [];
let lag: number[] = [];
let handlers: Record<string, HandlerStat> = {}; // name -> { n, ms, max, api: { Element.closest: n } }
let counters: Record<string, number> = {};
let host: Record<string, number> = {}; // DOM calls made outside any plugin handler
const hostMs: Record<string, number> = {};

const keep = <T>(list: T[], entry: T) => {
  list.push(entry);
  if (list.length > RING) list.shift();
};
const round = (x: number) => Math.round(x * 100) / 100;
const stat = (name: string) => (handlers[name] ??= { n: 0, ms: 0, max: 0, api: {}, apiMs: {} });

// A function that reports how long it ran and which DOM calls it made, when the level is "full".
export const timed = <Args extends unknown[], Result>(
  name: string,
  fn: (...args: Args) => Result,
): ((...args: Args) => Result) =>
  function (this: unknown, ...args: Args): Result {
    if (level !== "full") return fn.apply(this, args);
    const outer = current;
    current = name;
    const t0 = performance.now();
    try {
      return fn.apply(this, args);
    } finally {
      const ms = performance.now() - t0;
      current = outer;
      const entry = stat(name);
      entry.n++;
      entry.ms += ms;
      if (ms > entry.max) entry.max = ms;
    }
  };

export const count = (name: string, n = 1) => {
  if (level) counters[name] = (counters[name] ?? 0) + n;
};
export const active = () => level !== "";

const quantiles = (values: number[]) => {
  if (!values.length) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    n: sorted.length,
    median: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
};

// What the page holds right now, so two dumps minutes apart show whether the page itself grows (not the plugin).
const pageCounts = () => ({
  nodes: document.getElementsByTagName("*").length,
  messageRows: document.querySelectorAll(MESSAGE).length,
  images: document.images.length,
  styleSheets: document.styleSheets.length,
  iframes: document.querySelectorAll("iframe").length,
  canvases: document.querySelectorAll("canvas").length,
  media: document.querySelectorAll("video, audio").length,
  threadTabs: document.querySelectorAll('[data-panel-workspace] [role="tab"]').length,
  jsHeapMB: performance.memory ? round(performance.memory.usedJSHeapSize / 1048576) : null, // Chromium only
});

const summary = () => {
  const byKey: Record<string, number[]> = {};
  for (const [key, ms] of paint) (byKey[key] ??= []).push(ms);
  return {
    level,
    at: new Date().toISOString(),
    agent: navigator.userAgent,
    paint: quantiles(paint.map(([, ms]) => ms)),
    paintByKey: Object.fromEntries(Object.entries(byKey).map(([key, list]) => [key, quantiles(list)])),
    lag: quantiles(lag),
    handlers: Object.fromEntries(
      Object.entries(handlers)
        .sort((a, b) => b[1].ms - a[1].ms)
        .map(([name, h]) => [
          name,
          {
            n: h.n,
            ms: round(h.ms),
            max: round(h.max),
            api: h.api,
            apiMs: Object.fromEntries(Object.entries(h.apiMs).map(([label, ms]) => [label, round(ms)])),
          },
        ]),
    ),
    revisions: window.__vimRevisions,
    page: pageCounts(),
    host,
    hostMs: Object.fromEntries(Object.entries(hostMs).map(([label, ms]) => [label, round(ms)])),
    counters,
    samples: paint,
  };
};

export const reset = () => {
  paint = [];
  lag = [];
  handlers = {};
  counters = {};
  host = {};
  for (const label of Object.keys(hostMs)) delete hostMs[label];
};

const copyText = (text: string) => {
  // A hidden text box holds the selection a copy command needs (the page's own selection may be empty).
  const box = document.createElement("textarea");
  box.value = text;
  Object.assign(box.style, { position: "fixed", left: "-9999px", top: "0" });
  document.body.append(box);
  const was = document.activeElement as HTMLElement | null;
  box.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {}
  box.remove();
  was?.focus?.({ preventScroll: true });
  return ok;
};

const dump = () => {
  const text = JSON.stringify(summary());
  copyText(text);
  return text;
};

export const stop = () => {
  for (const undo of cleanup.splice(0)) undo();
  delete window.__vimPerf;
  level = "";
};

export const start = (next: PerfLevel) => {
  stop();
  if (!next) return;
  level = next;
  const onKey = (event: KeyboardEvent) => {
    if (MODIFIERS.has(event.key)) return;
    const t0 = performance.now();
    window.requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        keep(paint, [event.key, round(performance.now() - t0)]);
        channel.port1.close();
      };
      channel.port2.postMessage(0);
    });
  };
  window.addEventListener("keydown", onKey, true);
  cleanup.push(() => window.removeEventListener("keydown", onKey, true));
  const onChord = (event: KeyboardEvent) => {
    if (!event.ctrlKey || !event.altKey || !event.shiftKey) return;
    if (event.code === "KeyP") dump();
    else if (event.code === "KeyR") reset();
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.addEventListener("keydown", onChord, true);
  cleanup.push(() => document.removeEventListener("keydown", onChord, true));
  let last = performance.now();
  const tick = setInterval(() => {
    const now = performance.now();
    keep(lag, round(now - last - 1000));
    last = now;
  }, 1000);
  cleanup.push(() => clearInterval(tick));
  if (next === "full") {
    for (const [owner, name] of APIS) {
      // The trace wraps the page's own DOM methods, so it is typed loosely: this is the one place that has to.
      // biome-ignore lint: dynamic prototype patching
      const proto = (window as any)[owner].prototype as Record<string, (...args: unknown[]) => unknown>;
      const original = proto[name];
      const label = `${owner}.${name}`;
      const wrapper = function (this: unknown, ...args: unknown[]) {
        const entry = current ? stat(current) : undefined;
        const bucket = entry ? entry.api : host;
        const times = entry ? entry.apiMs : hostMs;
        bucket[label] = (bucket[label] ?? 0) + 1;
        const t0 = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          times[label] = (times[label] ?? 0) + (performance.now() - t0);
        }
      };
      proto[name] = wrapper;
      cleanup.push(() => {
        if (proto[name] === wrapper) proto[name] = original;
      });
    }
  }
  window.__vimPerf = { dump: () => JSON.parse(dump()), summary, reset, level: () => level };
};
