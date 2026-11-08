// The store: what is kept between restarts, when it is saved, how communities are kept apart, and that Buzz handing over the same
// frames again (as it does when the plugin is updated in place) never counts anything twice.
import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY, createStatsStore, emptyState, parseState, pruneState } from "../plugin.js";
import { AGENT, NOON, OTHER, batch, finished, frame, started, toolCall } from "./helpers.mjs";

const MIN = 60_000;
const DAY = 24 * 3600_000;
const memory = () => {
  const data = new Map();
  return { data, getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => void data.set(key, value) };
};
const timers = () => {
  const queue = [];
  return {
    queue,
    schedule: (fn, ms) => queue.push({ fn, ms, live: true }) - 1,
    cancel: (id) => void (queue[id].live = false),
    run: () => queue.splice(0).forEach((timer) => timer.live && timer.fn()),
    pending: () => queue.filter((timer) => timer.live).length,
  };
};
const make = (overrides = {}) => {
  const clock = { at: NOON + 3600_000 };
  const storage = overrides.storage ?? memory();
  const timer = timers();
  const store = createStatsStore({ storage, now: () => clock.at, schedule: timer.schedule, cancel: timer.cancel });
  store.useScope("community-a");
  return { store, storage, timer, clock };
};
const turn = (id, from, to, commands = 0) => [
  frame(started(id, from)),
  ...Array.from({ length: commands }, (_, i) => frame(toolCall(id, from + 1 + i, `${id}-c${i}`, { kind: "execute", title: "Bash" }))),
  frame(finished(id, to)),
];

test("ingest folds the frames in, and tells listeners only when something changed", () => {
  const { store, clock } = make();
  let calls = 0;
  store.subscribe(() => calls++);
  const frames = turn("t1", 0, 5 * MIN, 2);
  assert.equal(store.ingest(frames), true);
  assert.equal(calls, 1);
  const stats = store.statsFor(AGENT, clock.at);
  assert.deepEqual([stats.turns, stats.commands, stats.workingMs], [1, 2, 5 * MIN]);
  assert.equal(store.ingest(frames), false, "the same frames again");
  assert.equal(calls, 1);
});

test("a frame is folded once however often Buzz hands it over, and a frame Buzz let go of is forgotten", () => {
  const { store, clock } = make();
  const first = turn("t1", 0, MIN, 1);
  store.ingest(first);
  store.ingest([...first, ...turn("t2", 2 * MIN, 3 * MIN)]);
  assert.equal(store.statsFor(AGENT, clock.at).turns, 2);
  store.ingest([]);
  assert.equal(store.statsFor(AGENT, clock.at).turns, 2, "what was counted stays counted");
  store.ingest(first);
  assert.equal(store.statsFor(AGENT, clock.at).turns, 2, "and arriving again counts nothing twice");
  assert.equal(store.statsFor(AGENT, clock.at).commands, 1);
});

test("a tally survives a restart, and the same frames arriving again after it add nothing", () => {
  const first = make();
  const frames = turn("t1", 0, 4 * MIN, 3);
  first.store.ingest(frames);
  first.store.flush();
  const second = make({ storage: first.storage });
  assert.deepEqual([second.store.statsFor(AGENT, second.clock.at).turns, second.store.statsFor(AGENT, second.clock.at).commands], [1, 3]);
  second.store.ingest(frames);
  assert.deepEqual([second.store.statsFor(AGENT, second.clock.at).turns, second.store.statsFor(AGENT, second.clock.at).commands], [1, 3]);
  assert.equal(second.timer.pending(), 0, "folding what was already counted saves nothing");
});

test("saving waits a moment and happens once for many frames; flush saves at once; nothing changed means nothing written", () => {
  const { store, storage, timer } = make();
  for (let i = 0; i < 10; i++) store.ingest(turn(`t${i}`, i * MIN, i * MIN + 1000));
  assert.equal(timer.pending(), 1);
  assert.equal(storage.data.size, 0, "not yet");
  timer.run();
  const key = `${STORAGE_KEY}:community-a`;
  assert.deepEqual([...storage.data.keys()], [key]);
  assert.equal(Object.keys(JSON.parse(storage.data.get(key)).agents[AGENT].turns).length, 10);
  storage.data.clear();
  timer.run();
  assert.equal(storage.data.size, 0, "no change, no write");
  store.ingest(turn("late", 20 * MIN, 21 * MIN));
  store.flush();
  assert.equal(timer.pending(), 0, "flush cancels the wait");
  assert.equal(storage.data.size, 1);
  store.flush();
});

test("storage that throws, or holds garbage, never breaks the store", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  const { store, timer, clock } = make({ storage: broken });
  store.ingest(turn("t1", 0, MIN));
  assert.doesNotThrow(() => timer.run());
  assert.doesNotThrow(() => store.flush());
  assert.equal(store.statsFor(AGENT, clock.at).turns, 1, "it still counts, until Buzz closes");
  const garbage = memory();
  garbage.setItem(`${STORAGE_KEY}:community-a`, "{not json");
  assert.deepEqual(make({ storage: garbage }).store.agents(), []);
  assert.deepEqual(createStatsStore({}).agents(), [], "no storage at all");
});

test("each community keeps its own tally, saved when you leave it and read back when you return", () => {
  const { store, clock } = make();
  store.ingest(turn("t1", 0, MIN));
  store.useScope("community-b");
  assert.deepEqual(store.agents(clock.at), []);
  store.ingest(turn("t9", 0, 2 * MIN).map((entry) => ({ ...entry, agent: OTHER })));
  assert.deepEqual(store.agents(clock.at).map((row) => row.agent), [OTHER]);
  store.useScope("community-a");
  assert.deepEqual(store.agents(clock.at).map((row) => [row.agent, row.turns]), [[AGENT, 1]]);
  store.useScope("community-a");
  assert.equal(store.agents(clock.at).length, 1, "the same community again changes nothing");
});

test("the snapshot changes when the status, the working set or the tally does, and not otherwise", () => {
  const { store } = make();
  const seen = [store.snapshot()];
  store.subscribe(() => seen.push(store.snapshot()));
  store.setStatus("listening");
  store.setStatus("listening");
  assert.equal(seen.length, 2);
  assert.equal(seen[1].status, "listening");
  store.ingest([], [`${AGENT}:t1`]);
  assert.equal(seen.length, 3, "a turn started working");
  store.ingest([], [`${AGENT}:t1`]);
  assert.equal(seen.length, 3, "the same set again");
  store.ingest([], []);
  assert.equal(seen.length, 4, "it stopped");
  assert.notEqual(seen[2], seen[3]);
  assert.equal(Object.isFrozen(seen[3]), true);
});

test("a running turn lasts until now, and agents are listed busy first, then by last activity", () => {
  const { store, clock } = make();
  store.ingest([...turn("quiet", 0, MIN).map((entry) => ({ ...entry, agent: OTHER })), frame(started("busy", 5 * MIN))], [`${AGENT}:busy`]);
  const rows = store.agents(clock.at);
  assert.deepEqual(rows.map((row) => row.agent), [AGENT, OTHER]);
  assert.equal(rows[0].working, true);
  assert.equal(store.statsFor(AGENT, NOON + 8 * MIN).workingMs, 3 * MIN);
  assert.equal(store.statsFor(AGENT, NOON + 9 * MIN).workingMs, 4 * MIN);
  assert.equal(store.statsFor("ef".repeat(32), clock.at), undefined);
  store.ingest([], []);
  assert.deepEqual(store.agents(clock.at).map((row) => row.agent), [AGENT, OTHER], "both idle: the more recent first");
});

test("frames of a batch, and frames that are not frames", () => {
  const { store, clock } = make();
  store.ingest([frame(batch(started("t1", 0), finished("t1", MIN))), null, {}, { id: 5 }, { id: "x".repeat(64), agent: AGENT, plaintext: "{" }]);
  assert.equal(store.statsFor(AGENT, clock.at).turns, 1);
});

test("saving drops what is older than yesterday", () => {
  const { store, storage, timer, clock } = make();
  const old = (id, daysAgo) => frame({ kind: "turn_started", turnId: id, timestamp: new Date(NOON - daysAgo * DAY).toISOString(), startedAt: new Date(NOON - daysAgo * DAY).toISOString() });
  clock.at = NOON + MIN;
  store.ingest([old("recent", 1), old("ancient", 5), frame(started("now", 0))]);
  timer.run();
  const saved = JSON.parse(storage.data.get(`${STORAGE_KEY}:community-a`));
  assert.deepEqual(Object.keys(saved.agents[AGENT].turns).sort(), ["now", "recent"]);
});

test("parseState keeps what is good and drops the rest", () => {
  const good = { s: NOON, l: NOON + 1, d: "2026-11-08", c: ["a"] };
  const raw = JSON.stringify({
    v: 1,
    agents: {
      [AGENT]: { last: NOON, model: "M", turns: { ok: good, noTime: { l: 1, d: "2026-11-08", c: [] }, noDay: { s: 1, l: 2, c: [] }, nonsense: 5, ended: { ...good, e: NOON + 2 }, badIds: { ...good, c: ["a", 5, "", "x".repeat(300)] } } },
      "not-a-key": { turns: {} },
      [OTHER]: "text",
    },
  });
  const state = parseState(raw);
  assert.deepEqual(Object.keys(state.agents), [AGENT]);
  const entry = state.agents[AGENT];
  assert.deepEqual(Object.keys(entry.turns).sort(), ["badIds", "ended", "ok"]);
  assert.equal(entry.turns.ended.e, NOON + 2);
  assert.deepEqual(entry.turns.badIds.c, ["a"]);
  assert.equal(entry.model, "M");
  for (const bad of ["", "null", "[]", "5", "{", JSON.stringify({ v: 2, agents: {} }), JSON.stringify({ v: 1 }), JSON.stringify({ v: 1, agents: [] })]) {
    assert.deepEqual(Object.keys(parseState(bad).agents), [], bad);
  }
  const proto = parseState('{"v":1,"agents":{"' + AGENT + '":{"last":1,"turns":{"__proto__":{"s":1,"l":2,"d":"2026-11-08","c":[]}}}}}');
  assert.equal(Object.getPrototypeOf(proto.agents[AGENT].turns), null);
  assert.deepEqual(Object.keys(proto.agents[AGENT].turns), ["__proto__"]);
});

test("pruneState caps turns and agents, and forgets an agent only when it is long quiet and has no turns left", () => {
  const state = emptyState();
  const turns = {};
  for (let i = 0; i < 1200; i++) turns[`t${i}`] = { s: NOON + i, l: NOON + i, d: "2026-11-08", c: [] };
  state.agents[AGENT] = { turns: Object.assign(Object.create(null), turns), last: NOON };
  assert.equal(pruneState(state, NOON + MIN), true);
  const kept = Object.keys(state.agents[AGENT].turns);
  assert.equal(kept.length, 1000);
  assert.equal(kept.includes("t0"), false, "the oldest went");
  assert.equal(kept.includes("t1199"), true);
  assert.equal(pruneState(state, NOON + MIN), false, "nothing more to drop");
  const quiet = emptyState();
  quiet.agents[AGENT] = { turns: Object.create(null), last: NOON - 31 * DAY };
  quiet.agents[OTHER] = { turns: Object.create(null), last: NOON - 29 * DAY };
  pruneState(quiet, NOON);
  assert.deepEqual(Object.keys(quiet.agents), [OTHER]);
  const many = emptyState();
  for (let i = 0; i < 230; i++) many.agents[i.toString(16).padStart(64, "0")] = { turns: Object.create(null), last: NOON - i };
  pruneState(many, NOON);
  assert.equal(Object.keys(many.agents).length, 200);
  assert.equal(Object.keys(many.agents).includes((229).toString(16).padStart(64, "0")), false, "the least recent went");
});
