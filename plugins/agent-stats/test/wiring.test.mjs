// `apply` against a made-up Buzz: the telemetry lease is taken for each ready session and given back, the plugin says so when Buzz does
// not share the telemetry, the tab and the page are registered and show the numbers, and disabling the plugin leaves nothing behind.
// The components are called as plain functions with a stand-in for React, so what they would draw can be read as text.
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as plugin from "../plugin.js";
import { AGENT, NOON, OTHER, frame } from "./helpers.mjs";

const MIN = 60_000;
const text = (node) => (node == null || node === false ? "" : Array.isArray(node) ? node.map(text).join(" ") : typeof node === "object" ? text(node.children) : String(node));
const find = (node, test) => {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) return node.map((child) => find(child, test)).find(Boolean);
  return test(node) ? node : find(node.children, test);
};
const fakeReact = {
  createElement: (type, props, ...children) => (typeof type === "function" ? type({ ...props, children }) : { type, props: props ?? {}, children }),
  Fragment: "fragment",
  useSyncExternalStore: (_subscribe, get) => get(),
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
};

let appended;
let removed;
let storage;
beforeEach(() => {
  // A fixed clock, three hours past local noon: the tests build their times from it, so no run depends on the time of day it is made.
  mock.method(Date, "now", () => NOON + 3 * 3600_000);
  appended = 0;
  removed = 0;
  const data = new Map();
  storage = { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
  globalThis.document = { createElement: () => ({ dataset: {}, remove: () => removed++ }), head: { append: () => appended++ } };
  globalThis.window = { localStorage: storage };
});
afterEach(() => {
  mock.restoreAll();
  delete globalThis.document;
  delete globalThis.window;
});

/** A Buzz with one telemetry store. `held` is what the session holds now; `push` changes it and tells whoever subscribed. */
function fakeBuzz({ agentActivity = true, tabs = true, status = "ready", names = [] } = {}) {
  const log = { activated: 0, released: 0, subscribed: 0, unsubscribed: 0 };
  const held = { status: "listening", records: [], turns: [] };
  const watchers = new Set();
  const activity = {
    activate: () => (log.activated++, () => void log.released++),
    snapshot: () => held,
    subscribe: (listener) => (log.subscribed++, watchers.add(listener), () => (log.unsubscribed++, watchers.delete(listener))),
  };
  const session = agentActivity === true ? { agentActivity: activity } : agentActivity === false ? {} : { agentActivity };
  const relayListeners = new Set();
  const connection = { status, session, scope: "community-a" };
  const registered = { tabs: [], pages: [] };
  const cleanups = [];
  const ctx = {
    react: fakeReact,
    effect: (fn) => void cleanups.push(fn()),
    relay: { snapshot: () => connection, subscribe: (listener) => (relayListeners.add(listener), () => relayListeners.delete(listener)) },
    agents: { subscribe: () => () => {}, snapshot: () => ({ agents: names, running: [] }), ...(tabs ? { registerTab: (tab) => registered.tabs.push(tab) } : {}) },
    pages: { register: (page) => registered.pages.push(page) },
  };
  return {
    ctx,
    log,
    registered,
    held,
    connection,
    push(records, turns = [], statusNow = "listening") {
      held.records = records;
      held.turns = turns;
      held.status = statusNow;
      watchers.forEach((watch) => watch());
    },
    relayChanged: () => relayListeners.forEach((listener) => listener()),
    dispose: () => cleanups.splice(0).forEach((cleanup) => cleanup?.()),
  };
}
const page = (buzz) => buzz.registered.pages[0].component({});
const tab = (buzz, agent = AGENT) => buzz.registered.tabs[0].component({ agent: { pubkey: agent, name: "Scout" } });

test("it declares what it needs, registers a Stats tab and a page, and adds one style that it removes again", () => {
  assert.deepEqual(plugin.inject, ["react", "relay", "agents", "pages"]);
  const buzz = fakeBuzz();
  plugin.apply(buzz.ctx);
  assert.deepEqual(buzz.registered.tabs.map((entry) => [entry.id, entry.title]), [["stats", "Stats"]]);
  assert.equal(buzz.registered.tabs[0].when, undefined, "shown for every agent Buzz gives a tab to");
  assert.deepEqual(buzz.registered.pages.map((entry) => [entry.id, entry.title, entry.primary, entry.layout]), [["stats", "Agent stats", true, "workspace"]]);
  assert.equal(appended, 1);
  buzz.dispose();
  assert.equal(removed, 1);
});

test("the telemetry lease is taken once, and given back with its subscription when the plugin goes", () => {
  const buzz = fakeBuzz();
  plugin.apply(buzz.ctx);
  assert.deepEqual([buzz.log.activated, buzz.log.subscribed], [1, 1]);
  buzz.relayChanged();
  assert.deepEqual([buzz.log.activated, buzz.log.subscribed], [1, 1], "the same session is not leased twice");
  buzz.dispose();
  assert.deepEqual([buzz.log.released, buzz.log.unsubscribed], [1, 1]);
});

test("a new session gets a new lease and the old one is given back; no session, no lease", () => {
  const buzz = fakeBuzz();
  plugin.apply(buzz.ctx);
  const next = { agentActivity: { activate: () => (buzz.log.activated++, () => void buzz.log.released++), snapshot: () => ({ status: "connecting", records: [], turns: [] }), subscribe: () => () => {} } };
  buzz.connection.session = next;
  buzz.relayChanged();
  assert.deepEqual([buzz.log.activated, buzz.log.released, buzz.log.unsubscribed], [2, 1, 1]);
  buzz.connection.status = "connecting";
  buzz.connection.session = undefined;
  buzz.relayChanged();
  assert.equal(buzz.log.released, 2);
  assert.match(text(page(buzz)), /Connecting/);
  buzz.dispose();
  assert.equal(buzz.log.released, 2, "nothing is given back twice");
});

test("a Buzz that does not share the telemetry gets a plain message, not an error", () => {
  for (const agentActivity of [false, { snapshot: () => ({}) }, { activate: 5, snapshot: () => ({}), subscribe: () => () => {} }, { activate: () => () => {}, snapshot: () => ({}) }]) {
    const buzz = fakeBuzz({ agentActivity });
    assert.doesNotThrow(() => plugin.apply(buzz.ctx));
    assert.match(text(page(buzz)), /This version of Buzz does not share agent telemetry with plugins/);
    assert.match(text(tab(buzz)), /This version of Buzz does not share agent telemetry/);
    buzz.dispose();
  }
});

test("when Buzz itself says the telemetry is unavailable, the page says that, not that the plugin is unsupported", () => {
  const buzz = fakeBuzz();
  plugin.apply(buzz.ctx);
  buzz.push([], [], "unavailable");
  const shown = text(page(buzz));
  assert.match(shown, /Buzz is not offering agent telemetry for this community right now/);
  assert.doesNotMatch(shown, /This version of Buzz/);
  assert.equal(find(page(buzz), (node) => node.props?.["data-state"] === "unavailable") !== undefined, true);
  buzz.dispose();
});

test("an older Buzz with no tabs still gets the page", () => {
  const buzz = fakeBuzz({ tabs: false });
  assert.doesNotThrow(() => plugin.apply(buzz.ctx));
  assert.equal(buzz.registered.tabs.length, 0);
  assert.equal(buzz.registered.pages.length, 1);
});

test("the page lists agents by name with their numbers, busy first, and says what the working one is doing", () => {
  const buzz = fakeBuzz({ names: [{ pubkey: AGENT, name: "Scout" }] });
  plugin.apply(buzz.ctx);
  assert.match(text(page(buzz)), /No agent has reported yet/);
  const now = Date.now();
  const at = (offset) => new Date(now + offset).toISOString();
  const ev = (kind, turnId, offset, extra = {}) => ({ kind, turnId, seq: 1, channelId: "room", timestamp: at(offset), ...extra });
  const records = [
    frame(ev("turn_started", "t1", -5 * MIN, { startedAt: at(-5 * MIN) })),
    frame(ev("acp_read", "t1", -4 * MIN, { payload: { method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "c1", title: "Bash", kind: "execute", rawInput: { command: "npm test" } } } } })),
    frame(ev("turn_started", "z1", -30 * MIN, { startedAt: at(-30 * MIN) }), OTHER),
    frame(ev("turn_completed", "z1", -29 * MIN), OTHER),
  ];
  buzz.push(records, [{ agent: AGENT, turnId: "t1", state: "working" }]);
  const rows = text(page(buzz));
  assert.match(rows, /Scout/);
  assert.match(rows, new RegExp(`Agent ${OTHER.slice(0, 8)}`), "an agent Buzz does not name is shown by its key");
  assert.ok(rows.indexOf("Scout") < rows.indexOf(`Agent ${OTHER.slice(0, 8)}`), "the busy one first");
  assert.match(rows, /Working/);
  assert.match(rows, /Doing now Bash · npm\b/);
  assert.doesNotMatch(rows, /npm test/, "the arguments of a command are never shown");
  assert.match(rows, /Turns today 1/);
  assert.match(rows, /Commands run 1/);
  assert.match(rows, /Idle/);
  assert.match(rows, /Listening to your agents/);
  assert.match(rows, /never sent anywhere/);
  buzz.dispose();
});

test("the tab shows one agent's numbers, an empty message for one that has not reported, and the model and context when known", () => {
  const buzz = fakeBuzz();
  plugin.apply(buzz.ctx);
  assert.match(text(tab(buzz)), /Nothing seen from this agent yet/);
  const now = Date.now();
  const at = (offset) => new Date(now + offset).toISOString();
  buzz.push([
    frame({ kind: "turn_started", turnId: "t1", seq: 1, timestamp: at(-2 * MIN), startedAt: at(-2 * MIN) }),
    frame({ kind: "session_config_captured", turnId: "t1", seq: 2, timestamp: at(-2 * MIN + 1), payload: { configOptions: [{ category: "model", currentValue: "m1", options: [{ value: "m1", name: "Model One" }] }] } }),
    frame({ kind: "acp_read", turnId: "t1", seq: 3, timestamp: at(-MIN), payload: { method: "session/update", params: { update: { sessionUpdate: "usage_update", used: 50_000, size: 200_000 } } } }),
    frame({ kind: "turn_completed", turnId: "t1", seq: 4, timestamp: at(-MIN) }),
  ]);
  const shown = text(tab(buzz));
  assert.match(shown, /Turns today 1/);
  assert.match(shown, /Time working 1m 00s/);
  assert.match(shown, /Model Model One/);
  assert.match(shown, /Context window used 25% of 200,000/);
  assert.doesNotMatch(shown, /Doing now/, "idle agents show no task");
  assert.match(text(tab(buzz, OTHER)), /Nothing seen from this agent yet/);
  buzz.dispose();
});

test("an interrupted connection is said, and a leftover task of an ended turn is not shown", () => {
  const buzz = fakeBuzz();
  plugin.apply(buzz.ctx);
  const now = Date.now();
  const at = (offset) => new Date(now + offset).toISOString();
  buzz.push([frame({ kind: "turn_started", turnId: "t1", seq: 1, timestamp: at(-MIN), startedAt: at(-MIN) }), frame({ kind: "acp_read", turnId: "t1", seq: 2, timestamp: at(-MIN + 1), payload: { method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "c", title: "Stale thing" } } } })], [], "interrupted");
  const shown = text(page(buzz));
  assert.match(shown, /interrupted/);
  assert.doesNotMatch(shown, /Stale thing/);
  assert.equal(find(page(buzz), (node) => node.props?.["data-state"] === "interrupted") !== undefined, true);
  buzz.dispose();
});

test("disabling the plugin saves the day's tally and gives everything back", () => {
  const buzz = fakeBuzz();
  plugin.apply(buzz.ctx);
  const now = Date.now();
  buzz.push([frame({ kind: "turn_started", turnId: "t1", seq: 1, timestamp: new Date(now - MIN).toISOString() })]);
  assert.equal(storage.data.size, 0, "saved after a moment, not on every frame");
  buzz.dispose();
  assert.deepEqual([...storage.data.keys()], [`${plugin.STORAGE_KEY}:community-a`]);
  assert.deepEqual([buzz.log.released, buzz.log.unsubscribed, removed], [1, 1, 1]);
  const again = fakeBuzz();
  plugin.apply(again.ctx);
  assert.match(text(tab(again)), /Turns today 1/, "enabled again, the tally is there");
  again.dispose();
});

test("storage that is blocked does not stop the plugin from starting", () => {
  Object.defineProperty(globalThis.window, "localStorage", { get: () => { throw new Error("blocked"); } });
  const buzz = fakeBuzz();
  assert.doesNotThrow(() => plugin.apply(buzz.ctx));
  assert.doesNotThrow(() => buzz.dispose());
});
