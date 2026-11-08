// How one event of an agent's telemetry changes the tally: turns, the time they took, commands, the model, the context window and the
// current tool call; and that hostile or garbled events change nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { SHELL_TOOL, agentStats, foldItem, frameItems, isCommand, modelLabel, programName, toolDetail, emptyState } from "../plugin.js";
import { AGENT, NOON, TODAY, batch, event, finished, foldAll, started, toolCall, toolUpdate, update } from "./helpers.mjs";

const fold = (events, agent = AGENT, now = NOON + 3 * 3600_000) => foldAll(events, agent, now, foldItem);
const MIN = 60_000;

test("a turn from start to end counts once, and lasts from its start to its end", () => {
  const { state } = fold([started("t1", 0), event("turn_liveness", "t1", 2 * MIN), finished("t1", 5 * MIN)]);
  const stats = agentStats(state, AGENT, { now: NOON + 6 * MIN });
  assert.equal(stats.turns, 1);
  assert.equal(stats.workingMs, 5 * MIN);
  assert.equal(stats.working, false);
  assert.equal(stats.lastActive, NOON + 5 * MIN);
});

test("the time a turn began is its startedAt when the frame gives one, and the frame's own time otherwise", () => {
  const early = fold([started("t1", 10_000, -20_000), finished("t1", 40_000)]).state;
  assert.equal(agentStats(early, AGENT, { now: NOON + MIN }).workingMs, 60_000);
  const bare = fold([event("turn_liveness", "t2", 10_000), finished("t2", 40_000)]).state;
  assert.equal(agentStats(bare, AGENT, { now: NOON + MIN }).workingMs, 30_000);
  // A startedAt later than the frame carrying it is nonsense and is ignored.
  const lying = fold([started("t3", 0, 30_000), finished("t3", 10_000)]).state;
  assert.equal(agentStats(lying, AGENT, { now: NOON + MIN }).workingMs, 10_000);
});

test("two turns add up, a second agent keeps its own numbers, and the same turn id for another agent is another turn", () => {
  const { state } = fold([started("t1", 0), finished("t1", MIN), started("t2", 2 * MIN), finished("t2", 5 * MIN)]);
  const other = "cd".repeat(32);
  foldItem(state, {}, other, started("t1", 0), NOON + 3 * 3600_000);
  assert.equal(agentStats(state, AGENT, { now: NOON + 6 * MIN }).turns, 2);
  assert.equal(agentStats(state, AGENT, { now: NOON + 6 * MIN }).workingMs, 4 * MIN);
  assert.equal(agentStats(state, other, { now: NOON + 6 * MIN }).turns, 1);
});

test("the same event twice changes nothing the second time", () => {
  const state = emptyState();
  const live = {};
  const items = [started("t1", 0), toolCall("t1", 1000, "c1", { kind: "execute", title: "Run command" }), finished("t1", MIN)];
  for (const item of items) assert.equal(foldItem(state, live, AGENT, item, NOON + 3600_000), true);
  const before = JSON.stringify(state);
  for (const item of items) assert.equal(foldItem(state, live, AGENT, item, NOON + 3600_000), false);
  assert.equal(JSON.stringify(state), before);
});

test("the first end wins: a late heartbeat does not reopen or stretch a finished turn", () => {
  const { state } = fold([started("t1", 0), finished("t1", MIN), event("turn_liveness", "t1", 10 * MIN)]);
  const stats = agentStats(state, AGENT, { now: NOON + 20 * MIN });
  assert.equal(stats.workingMs, MIN);
  assert.equal(stats.lastActive, NOON + 10 * MIN, "it was still seen then");
  const errored = fold([started("t2", 0), finished("t2", 3 * MIN, "turn_error"), finished("t2", 9 * MIN)]).state;
  assert.equal(agentStats(errored, AGENT, { now: NOON + 20 * MIN }).workingMs, 3 * MIN);
  const panic = fold([started("t3", 0), event("agent_panic", "t3", 2 * MIN)]).state;
  assert.equal(agentStats(panic, AGENT, { now: NOON + 20 * MIN }).workingMs, 2 * MIN);
});

test("a turn Buzz says is working lasts until now, and one that went quiet without an end lasts until its last frame", () => {
  const { state } = fold([started("t1", 0), event("turn_liveness", "t1", MIN)]);
  const running = agentStats(state, AGENT, { now: NOON + 4 * MIN, working: new Set([`${AGENT}:t1`]) });
  assert.equal(running.workingMs, 4 * MIN);
  assert.equal(running.working, true);
  const quiet = agentStats(state, AGENT, { now: NOON + 4 * MIN, working: new Set() });
  assert.equal(quiet.workingMs, MIN);
  assert.equal(quiet.working, false);
  // Another agent's turn with the same id does not make this one busy.
  assert.equal(agentStats(state, AGENT, { now: NOON + 4 * MIN, working: new Set([`${"cd".repeat(32)}:t1`]) }).working, false);
});

test("commands are counted once per tool call: ACP's execute kind, and Buzz's shell tool by its exact name", () => {
  const { state } = fold([
    started("t1", 0),
    toolCall("t1", 1000, "a", { kind: "execute", title: "Bash" }),
    toolUpdate("t1", 2000, "a", { status: "completed" }),
    toolUpdate("t1", 2500, "a", { kind: "execute", status: "completed" }),
    toolCall("t1", 3000, "b", { kind: "other", title: SHELL_TOOL }),
    toolCall("t1", 4000, "c", { kind: "read", title: "Read file" }),
    toolCall("t1", 5000, "d", { kind: "edit", title: "Edit file" }),
  ]);
  assert.equal(agentStats(state, AGENT, { now: NOON + MIN }).commands, 2);
  // Names that merely look like a shell are not commands: the display title Buzz's own UI draws, and another server's tool of a like name.
  const lookalikes = fold([started("t2", 0), toolCall("t2", 1000, "x", { kind: "other", title: "Run command" }), toolCall("t2", 2000, "y", { kind: "other", title: "other-server__shell" }), toolCall("t2", 3000, "z", { kind: "other", title: "shell" })]);
  assert.equal(agentStats(lookalikes.state, AGENT, { now: NOON + MIN }).commands, 0);
});

test("a tool call update with no kind or title does not count, and does not erase what the call showed", () => {
  const { state, live } = fold([started("t1", 0), toolCall("t1", 1000, "a", { kind: "execute", title: "Bash", rawInput: { command: "ls -la\necho two" } }), toolUpdate("t1", 2000, "a", { status: "completed" })]);
  assert.equal(agentStats(state, AGENT, { now: NOON + MIN }).commands, 1);
  assert.deepEqual({ title: live[AGENT].task.title, detail: live[AGENT].task.detail, status: live[AGENT].task.status }, { title: "Bash", detail: "ls", status: "completed" });
});

test("the current task is the newest tool call, and an older frame arriving late does not replace it", () => {
  const { live } = fold([started("t1", 0), toolCall("t1", 5000, "new", { title: "Edit file", rawInput: { path: "/work/src/app.js" } }), toolCall("t1", 1000, "old", { title: "Read file" })]);
  assert.equal(live[AGENT].task.id, "new");
  assert.equal(live[AGENT].task.detail, "app.js");
});

test("the task shown is one of a running turn, not a leftover of the turn before", () => {
  const { state, live } = fold([started("t1", 0), toolCall("t1", 1000, "a", { title: "Old work" }), finished("t1", 2000), started("t2", 3000)]);
  const stats = agentStats(state, AGENT, { now: NOON + MIN, working: new Set([`${AGENT}:t2`]), live });
  assert.equal(stats.working, true);
  assert.equal(stats.task, undefined);
  foldItem(state, live, AGENT, toolCall("t2", 4000, "b", { title: "New work" }), NOON + MIN);
  assert.equal(agentStats(state, AGENT, { now: NOON + MIN, working: new Set([`${AGENT}:t2`]), live }).task.title, "New work");
  assert.equal(agentStats(state, AGENT, { now: NOON + MIN, working: new Set(), live }).task, undefined, "not shown for an agent that is idle");
});

test("the model comes from the config options, flat or grouped, and the newest report wins", () => {
  const flat = { category: "model", id: "m", name: "Model", currentValue: "fast", options: [{ value: "fast", name: "Fast one" }, { value: "slow", name: "Slow one" }] };
  const grouped = { id: "model", name: "Model", currentValue: "x-1", options: [{ group: "g", name: "G", options: [{ value: "x-1", name: "X One" }] }] };
  assert.equal(modelLabel([{ id: "mode", currentValue: "plan" }, flat]), "Fast one");
  assert.equal(modelLabel([grouped]), "X One");
  assert.equal(modelLabel([{ name: "Model", currentValue: "raw-id", options: [] }]), "raw-id", "no label: the value itself");
  assert.equal(modelLabel([{ id: "mode", currentValue: "plan" }]), undefined);
  assert.equal(modelLabel("nope"), undefined);
  assert.equal(modelLabel([{ id: "model", currentValue: 7 }]), undefined);
  assert.equal(modelLabel([{ id: "model", currentValue: "y".repeat(500) }]).length, 80);
  const { state } = fold([
    event("session_config_captured", "t1", 0, { payload: { configOptions: [flat] } }),
    update("t1", 1000, { sessionUpdate: "config_option_update", configOptions: [{ ...flat, currentValue: "slow" }] }),
  ]);
  assert.equal(agentStats(state, AGENT, { now: NOON + MIN }).model, "Slow one");
});

test("the context window is shown as used and size, and a missing or empty size is ignored", () => {
  const { live } = fold([update("t1", 0, { sessionUpdate: "usage_update", used: 50, size: 200 })]);
  assert.deepEqual(live[AGENT].context, { used: 50, size: 200, at: NOON });
  const none = fold([update("t1", 0, { sessionUpdate: "usage_update", used: 50, size: 0 }), update("t1", 1, { sessionUpdate: "usage_update", used: "x", size: 5 })]);
  assert.equal(none.live[AGENT], undefined);
});

test("only today's turns are counted, by the day each began; last active and model outlive the day", () => {
  const yesterday = new Date(NOON - 24 * 3600_000 - 3600_000).getTime();
  const state = emptyState();
  const live = {};
  const old = { ...started("old", 0), timestamp: new Date(yesterday + MIN).toISOString(), startedAt: new Date(yesterday).toISOString() };
  foldItem(state, live, AGENT, old, NOON);
  foldItem(state, live, AGENT, { ...finished("old", 0), timestamp: new Date(yesterday + 2 * MIN).toISOString() }, NOON);
  foldItem(state, live, AGENT, started("new", 0), NOON + 3600_000);
  const stats = agentStats(state, AGENT, { now: NOON + 3600_000 });
  assert.equal(stats.turns, 1);
  assert.equal(stats.workingMs, 0);
  const idleToday = agentStats(state, AGENT, { now: NOON + 25 * 3600_000 });
  assert.equal(idleToday.turns, 0, "the next day starts again from zero");
  assert.equal(idleToday.lastActive, NOON, "but last active remains");
  assert.equal(TODAY.length, 10);
});

test("a turn that began before midnight counts on the day it began", () => {
  const before = new Date(2026, 10, 8, 23, 50, 0).getTime();
  const after = new Date(2026, 10, 9, 0, 20, 0).getTime();
  const state = emptyState();
  foldItem(state, {}, AGENT, { kind: "turn_started", turnId: "late", timestamp: new Date(before).toISOString(), startedAt: new Date(before).toISOString() }, after);
  foldItem(state, {}, AGENT, { kind: "turn_completed", turnId: "late", timestamp: new Date(after).toISOString() }, after);
  assert.equal(agentStats(state, AGENT, { now: before + 1000 }).turns, 1);
  assert.equal(agentStats(state, AGENT, { now: after }).turns, 0);
  assert.equal(agentStats(state, AGENT, { now: before + 1000 }).workingMs, 30 * MIN);
});

test("events that are malformed, from the future, or for a bad key change nothing", () => {
  const now = NOON + 3600_000;
  const bad = [
    { turnId: "t", timestamp: new Date(NOON).toISOString() },
    { kind: "turn_started", timestamp: new Date(NOON).toISOString() },
    { kind: "turn_started", turnId: "t" },
    { kind: "turn_started", turnId: "t", timestamp: "yesterday-ish" },
    { kind: "turn_started", turnId: "t", timestamp: new Date(now + 60_000).toISOString() },
    { kind: "turn_started", turnId: "t".repeat(257), timestamp: new Date(NOON).toISOString() },
    { kind: "k".repeat(65), turnId: "t", timestamp: new Date(NOON).toISOString() },
    { kind: 5, turnId: "t", timestamp: new Date(NOON).toISOString() },
  ];
  for (const item of bad) {
    const state = emptyState();
    assert.equal(foldItem(state, {}, AGENT, item, now), false, JSON.stringify(item));
    assert.deepEqual(Object.keys(state.agents), []);
  }
  for (const key of ["", "AB".repeat(32), "ab".repeat(31), "__proto__", "constructor"]) {
    const state = emptyState();
    assert.equal(foldItem(state, {}, key, started("t", 0), now), false, key);
    assert.deepEqual(Object.keys(state.agents), []);
  }
  // Slightly ahead is a clock a little fast, and is kept.
  assert.equal(foldItem(emptyState(), {}, AGENT, { kind: "turn_started", turnId: "t", timestamp: new Date(now + 4000).toISOString() }, now), true);
});

test("a turn id that is an object property name is only a key", () => {
  const { state } = fold([started("__proto__", 0), finished("__proto__", MIN), started("constructor", 0), started("toString", 0)]);
  assert.equal(agentStats(state, AGENT, { now: NOON + 2 * MIN }).turns, 3);
  assert.equal(Object.getPrototypeOf(state.agents[AGENT].turns), null);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.keys(state.agents[AGENT].turns).includes("__proto__"), true);
});

test("a tool call's id, title and input are bounded, and commands per turn are capped", () => {
  const items = [started("t1", 0)];
  for (let i = 0; i < 600; i++) items.push(toolCall("t1", 1000 + i, `c${i}`, { kind: "execute", title: "T".repeat(500) }));
  const { state, live } = fold(items);
  assert.equal(agentStats(state, AGENT, { now: NOON + MIN }).commands, 500);
  assert.equal(live[AGENT].task.title.length, 120);
  const { live: none } = fold([toolCall("t1", 0, "x".repeat(300))]);
  assert.equal(none[AGENT], undefined, "an id too long to be one is not a tool call");
});

test("frameItems reads one event, a batch, and nothing for garbage, management requests or non-objects", () => {
  const one = event("turn_started", "t1", 0);
  assert.deepEqual(frameItems(JSON.stringify(one)), [one]);
  assert.deepEqual(frameItems(JSON.stringify(batch(one, "nope", [1], event("turn_completed", "t1", 5)))).map((entry) => entry.kind), ["turn_started", "turn_completed"]);
  assert.deepEqual(frameItems(JSON.stringify({ kind: "batch", payload: { events: "x" } })), []);
  assert.deepEqual(frameItems(JSON.stringify({ kind: "batch" })), []);
  assert.deepEqual(frameItems(JSON.stringify({ kind: "agent_management_request", turnId: "t" })), []);
  for (const raw of ["{", "", "null", "7", '"str"', "[]", "[1,2]"]) assert.deepEqual(frameItems(raw), [], raw);
});

test("isCommand and toolDetail", () => {
  assert.equal(isCommand("execute", undefined), true);
  assert.equal(isCommand("other", SHELL_TOOL), true);
  assert.equal(SHELL_TOOL, "buzz-dev-mcp__shell");
  assert.equal(isCommand("other", "Run command"), false);
  assert.equal(isCommand("other", "x__shell"), false);
  assert.equal(isCommand("other", `${SHELL_TOOL}2`), false);
  assert.equal(isCommand("read", "Read file"), false);
  assert.equal(isCommand(undefined, undefined), false);
  assert.equal(toolDetail({ command: "\n  \nnpm test --token=secret\nsecond" }), "npm", "a command shows its program and never its arguments");
  assert.equal(toolDetail('{"command":"echo hi"}'), "echo");
  assert.equal(toolDetail({ path: "/a/b/c.txt" }), "c.txt");
  assert.equal(toolDetail({ file_path: "C:\\dir\\file.rs" }), "file.rs");
  assert.equal(toolDetail({ path: "/a/b/" }), "b");
  for (const input of ["not json", 5, null, undefined, [], {}, { path: ".." }, { path: "a\nb" }]) assert.equal(toolDetail(input), undefined, JSON.stringify(input));
});

test("programName keeps the program and nothing after it", () => {
  assert.equal(programName("npm test"), "npm");
  assert.equal(programName("  \n\n git   push origin main\nrm -rf /"), "git");
  assert.equal(programName("/usr/local/bin/node script.js"), "node");
  assert.equal(programName("./run.sh --fast"), "run.sh");
  assert.equal(programName("~/bin/tool x"), "tool");
  assert.equal(programName("C:\\tools\\run.exe --flag"), "run.exe");
  assert.equal(programName("API_KEY=abc123 TOKEN=x make build"), "make", "plain settings before the program are skipped, and never shown");
  assert.equal(programName("(cd /tmp && ls)"), "cd");
  assert.equal(programName("ls;"), "ls");
  assert.equal(programName("curl -H 'Authorization: Bearer abc' https://example.com"), "curl");
  assert.equal(programName("a".repeat(100)), "a".repeat(40));
  assert.equal(programName("x\u0007y z"), "x", "control characters are blanked first");
});

test("programName says nothing when it cannot be sure, so it never shows a piece of a secret", () => {
  const unsure = [
    'API_KEY="s3cr3t value" make test', // a quoted value runs past its word
    'FOO="a b c" npm test',
    "FOO='a b c' npm test",
    "A=$(cat /etc/secret) go test", // a substituted value
    "A=`cat /etc/secret` go test",
    "A=b;C=d make",
    "A=x\\ y make",
    "--token=abc", // a first word that is an option
    "-x run",
    "TOKEN=abc", // only a setting
    "API_KEY=abc123",
    '"my tool" --x', // a program in quotes
    "'my tool' --x",
    "$HOME/bin/x y", // a program that is substituted
    "$(whoami) y",
    "`x` y",
    "ls|grep x",
    "ls&&x",
    "",
    "   ",
    "\n\n",
    "/",
    "///",
  ];
  for (const command of unsure) assert.equal(programName(command), undefined, `${JSON.stringify(command)} gave ${JSON.stringify(programName(command))}`);
  // An option with an = after the program is not the program, and is not shown; a plain setting holding an = is still only a setting.
  assert.equal(programName("make -j=4"), "make");
  assert.equal(programName("a=b=c d"), "d");
  for (const command of ['API_KEY="s3cr3t value" make test', 'FOO="a b c" npm test', "A=$(cat /etc/secret) go test", "--token=abc"]) {
    assert.doesNotMatch(String(toolDetail({ command })), /s3cr3t|value|\bb\b|secret|token|abc/, command);
  }
  assert.doesNotMatch(String(toolDetail({ command: "deploy --password hunter2" })), /hunter2|password/);
});

test("turns of one agent that overlap are counted once, so time working never passes the clock", () => {
  const MIN = 60_000;
  // Two channels at once: 0-10 and 5-15 minutes is fifteen minutes of working, not twenty.
  const overlapping = fold([started("a", 0), finished("a", 10 * MIN), started("b", 5 * MIN), finished("b", 15 * MIN)]).state;
  assert.equal(agentStats(overlapping, AGENT, { now: NOON + 20 * MIN }).workingMs, 15 * MIN);
  assert.equal(agentStats(overlapping, AGENT, { now: NOON + 20 * MIN }).turns, 2, "both turns still count as turns");
  // One inside another, one touching, and one apart.
  const shapes = fold([started("a", 0), finished("a", 10 * MIN), started("b", 2 * MIN), finished("b", 4 * MIN), started("c", 10 * MIN), finished("c", 12 * MIN), started("d", 20 * MIN), finished("d", 21 * MIN)]).state;
  assert.equal(agentStats(shapes, AGENT, { now: NOON + 30 * MIN }).workingMs, 13 * MIN);
  // Order of arrival does not matter, and a running turn is merged with a finished one up to now.
  const running = fold([started("late", 8 * MIN), started("early", 0), finished("early", 10 * MIN)]).state;
  assert.equal(agentStats(running, AGENT, { now: NOON + 12 * MIN, working: new Set([`${AGENT}:late`]) }).workingMs, 12 * MIN);
  assert.equal(agentStats(running, AGENT, { now: NOON + 12 * MIN, working: new Set([`${AGENT}:late`]) }).turns, 2);
});
