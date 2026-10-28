// Run with: node --test plugins/artifacts/test  (Node 22+, no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLinkStore, checkUrl, inject, apply, STORAGE_KEY, DEFAULT_KEY, PLUGIN_ID } from "../plugin.js";

const memory = (seed, savedDefault) => {
  const map = new Map(seed ? [[STORAGE_KEY, seed]] : []);
  if (savedDefault !== undefined) map.set(DEFAULT_KEY, savedDefault);
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), raw: () => map.get(STORAGE_KEY), rawDefault: () => map.get(DEFAULT_KEY) };
};

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
  assert.doesNotMatch(source, /https:\/\/(?!claude\.ai\/artifact\/\.\.\.)[a-z0-9.-]+\.[a-z]{2,}/i, "no address is hard-coded");
});

test("apply registers a sidebar page and a settings card, and opens the browser with storage", () => {
  const pages = [], cards = [];
  const React = { createElement: (type, props, ...children) => ({ type, props, children }), useState: (v) => [v, () => {}], useSyncExternalStore: (_s, get) => get() };
  const View = () => null;
  globalThis.window = { localStorage: memory(JSON.stringify([{ id: "1", name: "n", url: "https://claude.ai/artifact/x" }])) };
  globalThis.document = { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} } };
  const cleanups = [];
  apply({ react: React, browser: { available: true, View }, pages: { register: (p) => pages.push(p) }, settingsCards: { register: (c) => cards.push(c) }, effect: (f) => cleanups.push(f()) });
  assert.equal(pages[0].title, "Artifacts");
  assert.equal(pages[0].primary, true);
  assert.match(pages[0].icon, /^data:image\/svg\+xml/);
  assert.equal(cards[0].title, "Artifacts");
  cleanups.forEach((c) => c());
  // Open the saved page: render with a stubbed useState holding the chosen id.
  const open = { ...React, useState: () => ["1", () => {}] };
  pages.length = 0;
  apply({ react: open, browser: { available: true, View }, pages: { register: (p) => pages.push(p) }, settingsCards: { register() {} }, effect: () => {} });
  const tree = pages[0].component({});
  const view = JSON.stringify(tree, (k, v) => (typeof v === "function" ? "fn" : v));
  assert.match(view, /"storage":"claude"/);
  assert.match(view, /https:\/\/claude\.ai\/artifact\/x/);
});

// ---- The default page ----

const row = (id) => ({ id, name: `page ${id}`, url: `https://example.org/${id}` });
const seeded = (ids, savedDefault) => memory(JSON.stringify(ids.map(row)), savedDefault);

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

// ---- The default page in the page and the settings card ----

/** Mounts the plugin on a fake React and storage. `openId` is what the page's useState holds; `typed` feeds the settings card's useState calls in order. */
function mount({ rows = [], savedDefault, openId, available = true, typed = [] } = {}) {
  const pages = [], cards = [];
  const View = () => null;
  let typedAt = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => (initial === undefined ? [openId, () => {}] : [typedAt < typed.length ? typed[typedAt++] : initial, () => {}]),
    useSyncExternalStore: (_subscribe, get) => get(),
  };
  const storage = rows.length || savedDefault !== undefined ? memory(JSON.stringify(rows.map(row)), savedDefault) : memory();
  globalThis.window = { localStorage: storage };
  globalThis.document = { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} } };
  apply({ react: React, browser: { available, View }, pages: { register: (p) => pages.push(p) }, settingsCards: { register: (c) => cards.push(c) }, effect: () => {} });
  return { storage, View, page: () => pages[0].component({}), settings: () => cards[0].component({}) };
}

/** Every element in a tree, with function components (other than `skip`) rendered where they stand. */
function elements(node, skip, found = []) {
  if (Array.isArray(node)) node.forEach((child) => elements(child, skip, found));
  else if (node && typeof node === "object") {
    found.push(node);
    const rendered = typeof node.type === "function" && node.type !== skip ? node.type(node.props) : undefined;
    elements(rendered ?? node.children, skip, found);
  }
  return found;
}
const textOf = (node) => (Array.isArray(node) ? node.map(textOf).join("") : node && typeof node === "object" ? textOf(node.children) : String(node ?? ""));
const buttons = (tree, skip) => elements(tree, skip).filter((n) => n.type === "button");

test("opening the page loads the default at once, with no click", () => {
  const { page, View } = mount({ rows: ["1", "2", "3"], savedDefault: "2" });
  const view = elements(page(), View).find((n) => n.type === View);
  assert.ok(view, "the browser view is rendered on the first render");
  assert.equal(view.props.url, "https://example.org/2");
  assert.equal(view.props.storage, "claude");
  assert.equal(view.props.key, "2");
});

test("an old list with no saved default opens on its first page", () => {
  const { page, View } = mount({ rows: ["1", "2"] });
  assert.equal(elements(page(), View).find((n) => n.type === View).props.url, "https://example.org/1");
});

test("the default chip is marked, the open chip is current, and only the default is marked", () => {
  const { page, View } = mount({ rows: ["1", "2", "3"], savedDefault: "2" });
  const chips = buttons(page(), View).filter((b) => b.props.className.includes("megatech-artifacts__chip") && !b.props.className.includes("megatech-artifacts__default"));
  assert.equal(chips.length, 3);
  assert.deepEqual(chips.map((b) => b.props["data-default"]), ["false", "true", "false"]);
  assert.deepEqual(chips.map((b) => b.props["aria-label"]), [undefined, "page 2 (default)", undefined]);
  assert.deepEqual(chips.map((b) => b.props["aria-current"]), ["false", "true", "false"]);
});

test("a page chosen by hand is shown, with a Make default control; choosing the default has none", () => {
  const onDefault = mount({ rows: ["1", "2"], savedDefault: "1", openId: "1" });
  assert.equal(buttons(onDefault.page(), onDefault.View).some((b) => textOf(b) === "Make default"), false);
  const other = mount({ rows: ["1", "2"], savedDefault: "1", openId: "2" });
  const tree = other.page();
  assert.equal(elements(tree, other.View).find((n) => n.type === other.View).props.url, "https://example.org/2");
  const make = buttons(tree, other.View).find((b) => textOf(b) === "Make default");
  assert.ok(make, "the bar offers to make the open page the default");
  make.props.onClick();
  assert.equal(other.storage.rawDefault(), "2");
  const after = other.page();
  assert.equal(buttons(after, other.View).some((b) => textOf(b) === "Make default"), false, "now it is the default, the control goes");
  assert.equal(elements(after, other.View).find((n) => n.type === other.View).props.url, "https://example.org/2");
});

test("if the open page is removed the page falls back to the default", () => {
  const m = mount({ rows: ["1", "2", "3"], savedDefault: "1", openId: "3" });
  const remove = buttons(elements(m.settings()).find((n) => n.props?.className === "megatech-artifacts__row" && textOf(n).includes("/3")) ?? m.settings()).find((b) => textOf(b) === "Remove");
  remove.props.onClick();
  assert.equal(elements(m.page(), m.View).find((n) => n.type === m.View).props.url, "https://example.org/1");
});

test("the first page added while the page is open opens at once; with no pages the empty state shows", () => {
  const m = mount({ typed: ["", "https://example.org/new", ""] });
  const empty = m.page();
  assert.equal(elements(empty, m.View).some((n) => n.type === m.View), false);
  assert.match(textOf(empty), /No saved pages yet/);
  const form = elements(m.settings()).find((n) => n.type === "form");
  form.props.onSubmit({ preventDefault() {} });
  assert.equal(elements(m.page(), m.View).find((n) => n.type === m.View).props.url, "https://example.org/new");
});

test("the settings card marks the default row and gives every other row a Make default button", () => {
  const m = mount({ rows: ["1", "2", "3"], savedDefault: "2" });
  const rows = elements(m.settings()).filter((n) => n.props?.className === "megatech-artifacts__row" && n.type === "div");
  assert.equal(rows.length, 3);
  const make = rows.map((r) => buttons(r).filter((b) => textOf(b) === "Make default"));
  assert.deepEqual(make.map((list) => list.length), [1, 0, 1]);
  assert.match(textOf(rows[1]), /Default/);
  assert.doesNotMatch(textOf(rows[0]), /Default/);
  for (const button of [...make[0], ...make[2]]) assert.equal(button.props.className, "ui-button");
  make[0][0].props.onClick();
  assert.equal(m.storage.rawDefault(), "1");
  const after = elements(m.settings()).filter((n) => n.props?.className === "megatech-artifacts__row" && n.type === "div");
  assert.deepEqual(after.map((r) => /Default/.test(textOf(r))), [true, false, false]);
});

test("on a host without the browser, the chip bar still shows the default as current", () => {
  const m = mount({ rows: ["1", "2"], savedDefault: "2", available: false });
  const tree = m.page();
  assert.match(textOf(tree), /only available in the macOS desktop app/);
  const chips = buttons(tree, m.View);
  assert.equal(chips.find((b) => b.props["aria-current"] === "true").props.title, "https://example.org/2");
});
