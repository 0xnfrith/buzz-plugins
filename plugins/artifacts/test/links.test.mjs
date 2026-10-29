// Run with: node --test plugins/artifacts/test  (Node 22+, no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLinkStore, checkUrl, pinPageId, displayName, inject, STORAGE_KEY, DEFAULT_KEY, PINNED_KEY, PLUGIN_ID } from "../plugin.js";
import { memory, row, seeded } from "./harness.mjs";

test("add keeps the link, normalized, with a default name", () => {
  const store = createLinkStore(memory());
  const r = store.add("", " https://claude.ai/artifact/abc123 ");
  assert.equal(r.ok, true);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].url, "https://claude.ai/artifact/abc123");
  assert.equal(store.list()[0].name, "claude.ai / abc123");
});

test("rejects non-https, credentials, garbage, empty and over-long addresses", () => {
  for (const bad of ["http://example.org/", "javascript:alert(1)", "ftp://example.org", "https://u:p@example.org/", "not a url", "", "   ", "https://example.org/" + "a".repeat(2100)]) {
    assert.equal(checkUrl(bad).ok, false, bad);
  }
  const store = createLinkStore(memory());
  assert.equal(store.add("x", "http://example.org").ok, false);
  assert.equal(store.list().length, 0);
});

test("rejects a duplicate address", () => {
  const store = createLinkStore(memory());
  store.add("a", "https://example.org/a");
  assert.equal(store.add("b", "https://example.org/a").ok, false);
  assert.equal(store.list().length, 1);
});

test("rename changes the name only; a blank name keeps the old one", () => {
  const store = createLinkStore(memory());
  const { value } = store.add("old", "https://example.org/a");
  store.rename(value.id, "new");
  assert.equal(store.list()[0].name, "new");
  assert.equal(store.list()[0].url, "https://example.org/a");
  store.rename(value.id, "   ");
  assert.equal(store.list()[0].name, "new");
  assert.equal(store.rename("missing", "x").ok, false);
});

test("remove deletes one link", () => {
  const store = createLinkStore(memory());
  const a = store.add("a", "https://example.org/a").value;
  store.add("b", "https://example.org/b");
  assert.equal(store.remove(a.id).ok, true);
  assert.deepEqual(store.list().map((l) => l.name), ["b"]);
  assert.equal(store.remove(a.id).ok, false);
});

test("persists across stores and survives bad stored data", () => {
  const storage = memory();
  const first = createLinkStore(storage);
  first.add("a", "https://example.org/a");
  const second = createLinkStore(storage);
  assert.deepEqual(second.list().map((l) => l.url), ["https://example.org/a"]);
  assert.deepEqual(createLinkStore(memory("not json")).list(), []);
  assert.deepEqual(createLinkStore(memory('{"a":1}')).list(), []);
  const mixed = JSON.stringify([{ id: "1", name: "ok", url: "https://example.org/" }, { id: "2", name: "bad", url: "http://example.org/" }, null]);
  assert.equal(createLinkStore(memory(mixed)).list().length, 1);
});

test("subscribers hear changes and list() returns a new array each time", () => {
  const store = createLinkStore(memory());
  let heard = 0;
  const off = store.subscribe(() => heard++);
  const before = store.list();
  store.add("a", "https://example.org/a");
  assert.equal(heard, 1);
  assert.notEqual(store.list(), before);
  off();
  store.add("b", "https://example.org/b");
  assert.equal(heard, 1);
});

test("a full or blocked storage does not throw", () => {
  const store = createLinkStore({ getItem: () => null, setItem: () => { throw new Error("full"); } });
  assert.equal(store.add("a", "https://example.org/a").ok, true);
});

test("plugin contract: manifest, inject, no network or eval, no hard-coded page", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.id, PLUGIN_ID);
  assert.equal(manifest.apiVersion, 1);
  assert.equal(manifest.host, undefined, "no network or command access declared");
  assert.deepEqual(inject, ["react", "pages", "settingsCards", "browser"]);
  const source = readFileSync(new URL("../plugin.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|\beval\s*\(|new Function|runCommand|\.request\(/);
  assert.doesNotMatch(source, /https:\/\/(?!claude\.ai\/artifact\/(?:\.\.\.|\u2026))[a-z0-9.-]+\.[a-z]{2,}/i, "no address is hard-coded");
});

// ---- The default page ----

test("the first page ever added becomes the default; later ones do not take it", () => {
  const storage = memory();
  const store = createLinkStore(storage);
  assert.equal(store.defaultId(), undefined);
  const a = store.add("a", "https://example.org/a").value;
  assert.equal(store.defaultId(), a.id);
  assert.equal(storage.rawDefault(), a.id);
  store.add("b", "https://example.org/b");
  store.add("c", "https://example.org/c");
  assert.equal(store.defaultId(), a.id);
});

test("setDefault changes the default and saves it; an unknown id changes nothing", () => {
  const storage = memory();
  const store = createLinkStore(storage);
  store.add("a", "https://example.org/a");
  const b = store.add("b", "https://example.org/b").value;
  const result = store.setDefault(b.id);
  assert.equal(result.ok, true);
  assert.equal(result.value.id, b.id);
  assert.equal(store.defaultId(), b.id);
  assert.equal(storage.rawDefault(), b.id);
  const gone = store.setDefault("missing");
  assert.equal(gone.ok, false);
  assert.ok(gone.message);
  assert.equal(store.defaultId(), b.id);
  assert.equal(storage.rawDefault(), b.id);
});

test("removing the default makes the first remaining page the default; removing another page keeps it", () => {
  const storage = memory();
  const store = createLinkStore(storage);
  const a = store.add("a", "https://example.org/a").value;
  const b = store.add("b", "https://example.org/b").value;
  const c = store.add("c", "https://example.org/c").value;
  store.setDefault(c.id);
  store.remove(b.id);
  assert.equal(store.defaultId(), c.id, "removing a page that is not the default leaves it alone");
  store.remove(c.id);
  assert.equal(store.defaultId(), a.id, "the first remaining page");
  assert.equal(storage.rawDefault(), a.id);
  store.remove(a.id);
  assert.equal(store.defaultId(), undefined, "no pages, no default");
  assert.equal(storage.rawDefault(), "");
  const d = store.add("d", "https://example.org/d").value;
  assert.equal(store.defaultId(), d.id, "the first page added to an empty list is the default again");
});

test("removing the first page while a later one is the default keeps the later one", () => {
  const store = createLinkStore(memory());
  const a = store.add("a", "https://example.org/a").value;
  const b = store.add("b", "https://example.org/b").value;
  store.setDefault(b.id);
  store.remove(a.id);
  assert.equal(store.defaultId(), b.id);
});

test("a list saved before defaults existed upgrades: the first page is the default and the list is read unchanged", () => {
  const storage = seeded(["1", "2", "3"]);
  assert.equal(storage.rawDefault(), undefined);
  const store = createLinkStore(storage);
  assert.deepEqual(store.list().map((l) => l.id), ["1", "2", "3"]);
  assert.equal(store.defaultId(), "1");
  store.setDefault("3");
  assert.equal(createLinkStore(storage).defaultId(), "3");
});

test("a saved default that is not in the list (stale, empty or garbage) falls back to the first page", () => {
  for (const bad of ["gone", "", "   ", "null", "{\"a\":1}"]) {
    assert.equal(createLinkStore(seeded(["1", "2"], bad)).defaultId(), "1", JSON.stringify(bad));
  }
  const storage = seeded(["1", "2"], "gone");
  const store = createLinkStore(storage);
  store.rename("2", "renamed");
  assert.equal(storage.rawDefault(), "1", "the next save repairs the stale id");
  assert.equal(createLinkStore(memory(JSON.stringify([row("1")]), undefined)).defaultId(), "1");
  assert.equal(createLinkStore(memory("[]", "1")).defaultId(), undefined);
});

test("the default survives a reload, and the list keeps its old shape", () => {
  const storage = memory();
  const first = createLinkStore(storage);
  first.add("a", "https://example.org/a");
  const b = first.add("b", "https://example.org/b").value;
  first.setDefault(b.id);
  const second = createLinkStore(storage);
  assert.equal(second.defaultId(), b.id);
  for (const saved of JSON.parse(storage.raw())) assert.deepEqual(Object.keys(saved).sort(), ["id", "name", "url"]);
});

test("subscribers hear a change of default, not a repeat of the current one or an unknown id", () => {
  const store = createLinkStore(memory());
  const a = store.add("a", "https://example.org/a").value;
  const b = store.add("b", "https://example.org/b").value;
  let heard = 0;
  store.subscribe(() => heard++);
  store.setDefault(b.id);
  assert.equal(heard, 1);
  store.setDefault(b.id);
  store.setDefault("missing");
  assert.equal(heard, 1);
  store.setDefault(a.id);
  assert.equal(heard, 2);
  store.remove(a.id);
  assert.equal(heard, 3);
  assert.equal(store.defaultId(), b.id);
});

test("a full or blocked storage still changes the default in memory", () => {
  const store = createLinkStore({ getItem: () => null, setItem: () => { throw new Error("full"); } });
  store.add("a", "https://example.org/a");
  const b = store.add("b", "https://example.org/b").value;
  assert.equal(store.setDefault(b.id).ok, true);
  assert.equal(store.defaultId(), b.id);
  assert.equal(createLinkStore({ getItem: () => { throw new Error("blocked"); }, setItem() {} }).defaultId(), undefined);
});

// ---- Pinning a page to the top bar: the store ----

test("pin and unpin keep the pinned ids in the order pinned, save them beside the list, and the list keeps its shape", () => {
  const storage = seeded(["1", "2", "3"]);
  const store = createLinkStore(storage);
  assert.deepEqual(store.pinnedIds(), []);
  assert.equal(store.pin("3").ok, true);
  assert.equal(store.pin("1").ok, true);
  assert.deepEqual(store.pinnedIds(), ["3", "1"]);
  assert.equal(store.isPinned("3"), true);
  assert.equal(store.isPinned("2"), false);
  assert.deepEqual(JSON.parse(storage.rawPinned()), ["3", "1"]);
  for (const saved of JSON.parse(storage.raw())) assert.deepEqual(Object.keys(saved).sort(), ["id", "name", "url"]);
  assert.equal(store.unpin("3").ok, true);
  assert.deepEqual(store.pinnedIds(), ["1"]);
  assert.deepEqual(JSON.parse(storage.rawPinned()), ["1"]);
  assert.deepEqual(createLinkStore(storage).pinnedIds(), ["1"], "pins survive a reload");
});

test("a list saved before pins existed has none", () => {
  const storage = seeded(["1", "2"]);
  assert.equal(storage.rawPinned(), undefined);
  assert.deepEqual(createLinkStore(storage).pinnedIds(), []);
});

test("an unknown id is refused for pin and for unpin, and changes nothing", () => {
  const storage = seeded(["1"]);
  const store = createLinkStore(storage);
  let heard = 0;
  store.subscribe(() => heard++);
  assert.equal(store.pin("missing").ok, false);
  assert.equal(store.unpin("missing").ok, false);
  assert.equal(store.pin("").ok, false);
  assert.deepEqual(store.pinnedIds(), []);
  assert.equal(storage.rawPinned(), undefined);
  assert.equal(heard, 0);
});

test("a saved page whose id could not make a valid top-bar page cannot be pinned", () => {
  const invalid = ["Upper", "has space", "slash/x", "\u00fcn\u00ef"];
  const valid = ["ld3k-0-ab12", "1", "a.b_c"];
  const storage = memory(JSON.stringify([...invalid, ...valid].map((id) => ({ id, name: id, url: `https://example.org/${encodeURIComponent(id)}` }))));
  const store = createLinkStore(storage);
  for (const id of invalid) {
    assert.equal(pinPageId(id), undefined, id);
    assert.equal(store.pin(id).ok, false, id);
  }
  for (const id of valid) assert.equal(store.pin(id).ok, true, id);
  assert.deepEqual(store.pinnedIds(), valid);
  assert.equal(pinPageId("ld3k-0-ab12"), "pin-ld3k-0-ab12");
  // A hand-edited pin list naming an unusable id drops it on load.
  assert.deepEqual(createLinkStore(memory(storage.raw(), undefined, JSON.stringify(["Upper", "1"]))).pinnedIds(), ["1"]);
});

test("pinning twice, or unpinning a page that is not pinned, changes nothing and tells nobody", () => {
  const store = createLinkStore(seeded(["1", "2"]));
  let heard = 0;
  store.subscribe(() => heard++);
  store.pin("1");
  const after = store.pinnedIds();
  assert.equal(heard, 1);
  assert.equal(store.pin("1").ok, true);
  assert.equal(store.unpin("2").ok, true);
  assert.equal(heard, 1);
  assert.equal(store.pinnedIds(), after, "the same array until a pin is added or dropped");
  store.rename("2", "renamed");
  assert.equal(store.pinnedIds(), after, "a save that changes no pin keeps it too");
  store.unpin("1");
  assert.equal(heard, 3);
});

test("removing a page unpins it, and the pin is gone from storage too", () => {
  const storage = seeded(["1", "2"], undefined, JSON.stringify(["1", "2"]));
  const store = createLinkStore(storage);
  let heard = 0;
  store.subscribe(() => heard++);
  store.remove("1");
  assert.deepEqual(store.pinnedIds(), ["2"]);
  assert.deepEqual(JSON.parse(storage.rawPinned()), ["2"]);
  assert.equal(heard, 1);
  store.add("again", "https://example.org/1");
  assert.deepEqual(store.pinnedIds(), ["2"], "a page added later never inherits a pin");
});

test("stale or garbage saved pins are dropped without throwing", () => {
  for (const bad of ["not json", "{\"a\":1}", "\"x\"", "null", "7", "", "[1,null,{},[]]", "[\"gone\"]"]) {
    assert.deepEqual(createLinkStore(seeded(["1", "2"], undefined, bad)).pinnedIds(), [], JSON.stringify(bad));
  }
  const storage = seeded(["1", "2"], undefined, JSON.stringify(["2", 5, "gone", "2", null, "1", "2"]));
  const store = createLinkStore(storage);
  assert.deepEqual(store.pinnedIds(), ["2", "1"], "only saved pages, once each, in saved order");
  store.rename("1", "renamed");
  assert.deepEqual(JSON.parse(storage.rawPinned()), ["2", "1"]);
  assert.deepEqual(createLinkStore({ getItem: (k) => (k === PINNED_KEY ? (() => { throw new Error("blocked"); })() : null), setItem() {} }).pinnedIds(), []);
});

test("a full or blocked storage still pins in memory", () => {
  const store = createLinkStore({ getItem: () => null, setItem: () => { throw new Error("full"); } });
  const a = store.add("a", "https://example.org/a").value;
  assert.equal(store.pin(a.id).ok, true);
  assert.deepEqual(store.pinnedIds(), [a.id]);
});

test("a page is shown by its name, trimmed, or by its address when the saved name is only blanks", () => {
  assert.equal(displayName({ name: "  Report ", url: "https://example.org/a" }), "Report");
  assert.equal(displayName({ name: "   ", url: "https://example.org/a" }), "https://example.org/a");
  assert.equal(displayName({ name: "", url: "https://example.org/a" }), "https://example.org/a");
});
