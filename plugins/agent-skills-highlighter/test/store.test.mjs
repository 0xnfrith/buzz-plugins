// The skill store, the settings and the signal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSkillStore, checkExtraFolder, loadSettings, saveSettings, signalFor, SIGNAL, ditherTile } from "../plugin.js";

const skills = (...names) => new Map(names.map((name) => [name, { name, description: `about ${name}`, source: "your skills folder" }]));

test("refresh fills the store and says the names changed; the same names again do not", async () => {
  let next = skills("a", "b");
  const store = createSkillStore({ load: async () => next });
  assert.deepEqual(store.snapshot(), { status: "idle", count: 0, error: "" });
  assert.equal(await store.refresh(), true);
  assert.equal(store.snapshot().count, 2);
  assert.deepEqual([...store.names()].sort(), ["a", "b"]);
  const names = store.names();
  assert.equal(await store.refresh(), false);
  assert.equal(store.names(), names, "the set the matcher holds is kept while the names are the same");
  next = skills("a", "c");
  assert.equal(await store.refresh(), true);
  assert.deepEqual([...store.names()].sort(), ["a", "c"]);
  assert.equal(store.skill("c").description, "about c");
  assert.equal(store.skill("b"), undefined);
});
test("a description that changes under the same names is picked up without a new name set", async () => {
  let next = skills("a");
  const store = createSkillStore({ load: async () => next });
  await store.refresh();
  next = new Map([["a", { name: "a", description: "new", source: "x" }]]);
  assert.equal(await store.refresh(), false);
  assert.equal(store.skill("a").description, "new");
});
test("a failed read keeps the last good list and says so", async () => {
  let fail = false;
  const store = createSkillStore({ load: async () => { if (fail) throw new Error("The skill files could not be read."); return skills("a"); } });
  await store.refresh();
  fail = true;
  assert.equal(await store.refresh(), false);
  assert.equal(store.snapshot().status, "error");
  assert.equal(store.snapshot().count, 1);
  assert.match(store.snapshot().error, /could not be read/);
  assert.deepEqual([...store.names()], ["a"]);
});
test("an empty machine gives an empty set and status ready", async () => {
  const store = createSkillStore({ load: async () => new Map() });
  assert.equal(await store.refresh(), false);
  assert.deepEqual(store.snapshot(), { status: "ready", count: 0, error: "" });
});
test("subscribers hear every change and can leave", async () => {
  const store = createSkillStore({ load: async () => skills("a") });
  let heard = 0;
  const off = store.subscribe(() => heard++);
  await store.refresh();
  assert.equal(heard, 2, "loading, then ready");
  off();
  await store.refresh();
  assert.equal(heard, 2);
});

test("the extra folder: empty, absolute, ~/, drive paths; not relative, not multi-line, not too long", () => {
  assert.deepEqual(checkExtraFolder(""), { ok: true, value: "" });
  assert.deepEqual(checkExtraFolder("   "), { ok: true, value: "" });
  assert.deepEqual(checkExtraFolder(" /srv/skills "), { ok: true, value: "/srv/skills" });
  assert.deepEqual(checkExtraFolder("~/skills"), { ok: true, value: "~/skills" });
  assert.deepEqual(checkExtraFolder("C:\\skills"), { ok: true, value: "C:\\skills" });
  assert.equal(checkExtraFolder("skills").ok, false);
  assert.equal(checkExtraFolder("../skills").ok, false);
  assert.equal(checkExtraFolder("/a\n/b").ok, false);
  assert.equal(checkExtraFolder("/a\0b").ok, false);
  assert.equal(checkExtraFolder(`/${"x".repeat(1100)}`).ok, false);
  assert.equal(checkExtraFolder(`/${"é".repeat(600)}`).ok, false, "1,201 bytes in 601 characters");
  assert.equal(checkExtraFolder(`/${"x".repeat(1023)}`).ok, true, "1,024 bytes is the longest");
  assert.equal(checkExtraFolder(undefined).value, "");
});
const memory = (seed) => {
  const map = new Map(seed === undefined ? [] : [["megatech.agent-skills-highlighter.settings.v1", seed]]);
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value), raw: () => map.get("megatech.agent-skills-highlighter.settings.v1") };
};
test("settings load from storage and survive bad data", () => {
  assert.deepEqual(loadSettings(memory()), { extraFolder: "" });
  assert.deepEqual(loadSettings(memory('{"extraFolder":"~/s"}')), { extraFolder: "~/s" });
  assert.deepEqual(loadSettings(memory("not json")), { extraFolder: "" });
  assert.deepEqual(loadSettings(memory('{"extraFolder":"relative"}')), { extraFolder: "" });
  assert.deepEqual(loadSettings(memory('{"extraFolder":42}')), { extraFolder: "" });
  assert.deepEqual(loadSettings(memory("null")), { extraFolder: "" });
});
test("settings save as one small JSON value, and a full storage says so", () => {
  const storage = memory();
  assert.equal(saveSettings(storage, { extraFolder: "~/s" }), true);
  assert.equal(storage.raw(), '{"extraFolder":"~/s"}');
  assert.equal(saveSettings({ setItem() { throw new Error("full"); } }, { extraFolder: "" }), false);
});

test("the signal: the six lines, short and plain, and the rotation wraps", () => {
  assert.deepEqual(SIGNAL, [
    "The net is vast and infinite.",
    "And where does the newborn go from here?",
    "Your effort to remain is what limits you.",
    "Believe in yourself. Choose what to leave.",
    "Ghost line stable.",
    "If a feat is possible, man will do it.",
  ]);
  for (const line of SIGNAL) {
    assert.ok(line.length <= 100, line);
    assert.ok(/^[\x20-\x7e]+$/.test(line), `plain ASCII: ${line}`);
  }
  assert.equal(signalFor(0), SIGNAL[0]);
  assert.equal(signalFor(6), SIGNAL[0]);
  assert.equal(signalFor(9), SIGNAL[3]);
  assert.equal(signalFor(-1), SIGNAL[5]);
});
test("the dither tile is a 4x4 ordered pattern: sixteen cells of rising alpha", () => {
  const tile = decodeURIComponent(ditherTile("#00d4ff", 0.3).slice('url("data:image/svg+xml,'.length, -2));
  const alphas = [...tile.matchAll(/fill-opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(alphas.length, 16);
  assert.equal(new Set(alphas).size, 16, "no two cells share a level");
  assert.equal(Math.max(...alphas), 0.3);
  assert.ok(Math.min(...alphas) > 0);
});
