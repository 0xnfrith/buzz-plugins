// Run with: node --test plugins/artifacts/test  (Node 22+, no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLinkStore, checkUrl, pinPageId, inject, apply, STORAGE_KEY, DEFAULT_KEY, PINNED_KEY, PLUGIN_ID } from "../plugin.js";

const memory = (seed, savedDefault, savedPinned) => {
  const map = new Map(seed ? [[STORAGE_KEY, seed]] : []);
  if (savedDefault !== undefined) map.set(DEFAULT_KEY, savedDefault);
  if (savedPinned !== undefined) map.set(PINNED_KEY, savedPinned);
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), raw: () => map.get(STORAGE_KEY), rawDefault: () => map.get(DEFAULT_KEY), rawPinned: () => map.get(PINNED_KEY) };
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
const seeded = (ids, savedDefault, savedPinned) => memory(JSON.stringify(ids.map(row)), savedDefault, savedPinned);

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

const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * The parts of Buzz's plugin host that pinning leans on, as block/buzz-app d92bfb2c has them: a page stays listed until the
 * scope that registered it ends (src/plugins/contributions.ts), `pages.register` returns nothing, a page id must match
 * [a-z0-9][a-z0-9._-]* and be unique (src/features/pages/service.ts, contributions.ts), and `ctx.plugin` opens a child scope
 * whose `dispose()` is asynchronous. `listed` is what the shell would list.
 */
function fakeHost({ failFor } = {}) {
  const listed = new Map();
  const scope = () => {
    const cleanups = [], children = [];
    const ctx = {
      effect(run) {
        const off = run();
        cleanups.push(off);
        return off;
      },
      pages: {
        register(page) {
          if (!/^[a-z0-9][a-z0-9._-]*$/.test(page.id) || !String(page.title).trim() || typeof page.component !== "function") throw new Error("A page needs an id, a title, and a React component function");
          if (listed.has(page.id)) throw new Error(`Contribution already registered: ${page.id}`);
          listed.set(page.id, page);
          cleanups.push(() => listed.delete(page.id));
        },
      },
      plugin(definition) {
        if (failFor?.(definition)) throw new Error("cannot create effect on inactive context");
        const child = scope();
        definition.apply(child.ctx);
        children.push(child);
        return { dispose: child.dispose };
      },
    };
    const dispose = async () => {
      await Promise.resolve();
      for (const child of children.splice(0)) await child.dispose();
      for (const off of cleanups.splice(0).reverse()) off?.();
    };
    return { ctx, dispose };
  };
  return { listed, root: scope() };
}

/**
 * Mounts the plugin on a fake React, storage and host. `openId` is what the page's useState holds; `typed` feeds the settings
 * card's useState calls in order; `edits` maps a text field's starting value to what has been typed into it; `storage` reuses
 * storage from an earlier mount, as a restart does.
 */
function mount({ rows = [], savedDefault, savedPinned, openId, available = true, typed = [], edits = {}, storage: kept, failFor } = {}) {
  const cards = [];
  const View = () => null;
  let typedAt = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => (initial === undefined ? [openId, () => {}] : [typedAt < typed.length ? typed[typedAt++] : typeof initial === "string" && Object.hasOwn(edits, initial) ? edits[initial] : initial, () => {}]),
    useSyncExternalStore: (_subscribe, get) => get(),
  };
  const storage = kept ?? (rows.length || savedDefault !== undefined || savedPinned !== undefined ? memory(JSON.stringify(rows.map(row)), savedDefault, savedPinned) : memory());
  globalThis.window = { localStorage: storage };
  globalThis.document = { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} } };
  const { listed, root } = fakeHost({ failFor });
  apply({ ...root.ctx, react: React, browser: { available, View }, settingsCards: { register: (c) => cards.push(c) } });
  return {
    storage,
    View,
    listed,
    unmount: () => root.dispose(),
    /** The pages listed in the top bar, by page id. */
    topbar: () => Object.fromEntries([...listed].filter(([, page]) => page.placement === "topbar").map(([id, page]) => [id, page.title])),
    page: () => listed.get("artifacts").component({}),
    settings: () => cards[0].component({}),
  };
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
  const chips = buttons(page(), View).filter((b) => b.props.className.includes("megatech-artifacts__chip") && !b.props.className.includes("megatech-artifacts__action"));
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

// ---- Pinning a page to the top bar: the top bar, the page, the settings card ----

const rowsOf = (tree) => elements(tree).filter((n) => n.props?.className === "megatech-artifacts__row" && n.type === "div");
const press = (node, label) => buttons(node).find((b) => textOf(b) === label).props.onClick();

test("the sidebar page is unchanged and no top-bar page exists until one is pinned", async () => {
  const m = mount({ rows: ["1", "2"] });
  await settle();
  const sidebar = m.listed.get("artifacts");
  assert.equal(sidebar.title, "Artifacts");
  assert.equal(sidebar.primary, true);
  assert.equal(sidebar.placement, undefined, "the sidebar entry keeps the host's default placement");
  assert.deepEqual(m.topbar(), {});
});

test("each pinned page registers as its own primary top-bar page, named for the saved page", async () => {
  const m = mount({ rows: ["1", "2", "3"], savedPinned: JSON.stringify(["3", "1"]) });
  assert.deepEqual(m.topbar(), { "pin-3": "page 3", "pin-1": "page 1" }, "registered during activation, before any await");
  for (const id of ["pin-1", "pin-3"]) {
    const page = m.listed.get(id);
    assert.equal(page.primary, true);
    assert.equal(page.placement, "topbar");
    assert.equal(page.layout, "workspace");
    assert.match(page.icon, /^data:image\/svg\+xml/);
    assert.equal(typeof page.component, "function");
  }
  await settle();
  assert.deepEqual(Object.keys(m.topbar()).sort(), ["pin-1", "pin-3"], "nothing registered twice");
});

test("pinning from the settings card adds a top-bar page without a restart; unpinning removes it", async () => {
  const m = mount({ rows: ["1", "2"] });
  assert.match(textOf(rowsOf(m.settings())[1]), /Pin to top bar/);
  press(rowsOf(m.settings())[1], "Pin to top bar");
  await settle();
  assert.deepEqual(m.topbar(), { "pin-2": "page 2" });
  assert.match(textOf(rowsOf(m.settings())[1]), /Unpin/);
  assert.doesNotMatch(textOf(rowsOf(m.settings())[0]), /Unpin/);
  assert.deepEqual(JSON.parse(m.storage.rawPinned()), ["2"]);
  press(rowsOf(m.settings())[1], "Unpin");
  await settle();
  assert.deepEqual(m.topbar(), {});
  assert.deepEqual(JSON.parse(m.storage.rawPinned()), []);
  assert.ok(m.listed.has("artifacts"), "the sidebar entry stays");
});

test("the Artifacts page offers Pin to top bar for the open page and Unpin once it is pinned", async () => {
  const m = mount({ rows: ["1", "2"], savedDefault: "1", openId: "2" });
  assert.equal(buttons(m.page(), m.View).some((b) => textOf(b) === "Unpin"), false);
  press(m.page(), "Pin to top bar");
  await settle();
  assert.deepEqual(m.topbar(), { "pin-2": "page 2" });
  const after = m.page();
  assert.equal(buttons(after, m.View).some((b) => textOf(b) === "Pin to top bar"), false);
  assert.ok(buttons(after, m.View).some((b) => textOf(b) === "Make default"), "the default control is still there beside it");
  press(after, "Unpin");
  await settle();
  assert.deepEqual(m.topbar(), {});
  assert.equal(buttons(m.page(), m.View).some((b) => textOf(b) === "Pin to top bar"), true);
});

test("the pin control follows the open page, including the default page, and is absent with no pages", () => {
  const onDefault = mount({ rows: ["1", "2"], savedDefault: "1" });
  assert.ok(buttons(onDefault.page(), onDefault.View).some((b) => textOf(b) === "Pin to top bar"));
  const empty = mount();
  assert.equal(buttons(empty.page(), empty.View).some((b) => /Pin|Unpin/.test(textOf(b))), false);
});

test("renaming a pinned page renames its top-bar entry; renaming an unpinned one adds none", async () => {
  const m = mount({ rows: ["1", "2"], savedPinned: JSON.stringify(["2"]), edits: { "page 1": "unpinned one", "page 2": "renamed" } });
  assert.deepEqual(m.topbar(), { "pin-2": "page 2" });
  press(rowsOf(m.settings())[1], "Rename");
  await settle();
  assert.deepEqual(m.topbar(), { "pin-2": "renamed" });
  press(rowsOf(m.settings())[0], "Rename");
  await settle();
  assert.deepEqual(m.topbar(), { "pin-2": "renamed" });
  assert.equal(m.listed.get("artifacts").title, "Artifacts", "the sidebar title does not follow a rename");
});

test("removing a pinned page removes its top-bar entry and its pin", async () => {
  const m = mount({ rows: ["1", "2"], savedPinned: JSON.stringify(["1", "2"]) });
  const gone = m.listed.get("pin-1");
  press(rowsOf(m.settings())[0], "Remove");
  await settle();
  assert.deepEqual(m.topbar(), { "pin-2": "page 2" });
  assert.deepEqual(JSON.parse(m.storage.rawPinned()), ["2"]);
  assert.equal(gone.component({}), null, "a page that is going away renders nothing");
});

test("pins survive a restart: the same storage mounted again registers the same top-bar pages", async () => {
  const first = mount({ rows: ["1", "2", "3"] });
  press(rowsOf(first.settings())[2], "Pin to top bar");
  press(rowsOf(first.settings())[0], "Pin to top bar");
  await settle();
  assert.deepEqual(Object.keys(first.topbar()).sort(), ["pin-1", "pin-3"]);
  await first.unmount();
  assert.deepEqual(first.topbar(), {});
  const restarted = mount({ storage: first.storage });
  assert.deepEqual(restarted.topbar(), { "pin-1": "page 1", "pin-3": "page 3" });
});

test("a pinned page shows its own address in the browser at once, with no chip bar, and nothing else is pinned into it", () => {
  const m = mount({ rows: ["1", "2"], savedPinned: JSON.stringify(["2"]) });
  const tree = m.listed.get("pin-2").component({});
  const view = elements(tree, m.View).find((n) => n.type === m.View);
  assert.ok(view, "the browser view is rendered on the first render");
  assert.equal(view.props.url, "https://example.org/2");
  assert.equal(view.props.storage, "claude");
  assert.equal(view.props.label, "page 2");
  assert.equal(view.props.key, "2");
  assert.equal(buttons(tree, m.View).length, 0, "no chip bar to pick from");
  assert.equal(elements(tree, m.View).some((n) => n.props?.role === "toolbar"), false);
});

test("on a host without the browser a pinned page says so and names the page", () => {
  const m = mount({ rows: ["1", "2"], savedPinned: JSON.stringify(["2"]), available: false });
  const text = textOf(m.listed.get("pin-2").component({}));
  assert.match(text, /only available in the macOS desktop app/);
  assert.match(text, /page 2/);
});

test("a change that arrives while the last one is still being applied ends in the last state, with no double registration", async () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const m = mount({ rows: ["1", "2"], edits: { "page 1": "second", second: "third" } });
    press(rowsOf(m.settings())[0], "Pin to top bar");
    press(rowsOf(m.settings())[0], "Unpin");
    press(rowsOf(m.settings())[0], "Pin to top bar");
    await settle();
    assert.deepEqual(m.topbar(), { "pin-1": "page 1" });
    // Unpin and pin again before the old entry has finished going away: the new one must wait for it.
    press(rowsOf(m.settings())[0], "Unpin");
    assert.deepEqual(m.topbar(), { "pin-1": "page 1" }, "disposal is asynchronous, so the entry is still listed");
    press(rowsOf(m.settings())[0], "Pin to top bar");
    await settle();
    assert.deepEqual(m.topbar(), { "pin-1": "page 1" });
    // Rename twice in a row, the second while the first is still going.
    press(rowsOf(m.settings())[0], "Rename");
    press(rowsOf(m.settings())[0], "Rename");
    await settle();
    assert.deepEqual(m.topbar(), { "pin-1": "third" });
    // Swap which page is pinned in one go.
    press(rowsOf(m.settings())[0], "Unpin");
    press(rowsOf(m.settings())[1], "Pin to top bar");
    await settle();
    assert.deepEqual(m.topbar(), { "pin-2": "page 2" });
    assert.deepEqual(warnings, [], "no failed registration along the way");
  } finally {
    console.warn = warn;
  }
});

test("one page that cannot be pinned is logged and the others still are; nothing throws", async () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const m = mount({ rows: ["1", "2", "3"], savedPinned: JSON.stringify(["1", "2", "3"]), failFor: (definition) => definition.name === "pin-2" });
    await settle();
    assert.deepEqual(Object.keys(m.topbar()).sort(), ["pin-1", "pin-3"]);
    assert.ok(warnings.some((line) => line.includes("pin-2")));
  } finally {
    console.warn = warn;
  }
});

test("when the plugin's scope ends every top-bar page goes with it, and a later change registers nothing", async () => {
  const m = mount({ rows: ["1", "2"], savedPinned: JSON.stringify(["1"]) });
  assert.deepEqual(Object.keys(m.topbar()), ["pin-1"]);
  await m.unmount();
  assert.deepEqual([...m.listed.keys()], []);
  press(rowsOf(m.settings())[1], "Pin to top bar");
  await settle();
  assert.deepEqual([...m.listed.keys()], []);
});

test("the plugin asks for no more services than it uses", () => {
  assert.deepEqual(inject, ["react", "pages", "settingsCards", "browser"]);
});
