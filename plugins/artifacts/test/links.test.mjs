// Run with: node --test plugins/artifacts/test  (Node 22+, no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLinkStore, checkUrl, inject, apply, STORAGE_KEY, PLUGIN_ID } from "../plugin.js";

const memory = (seed) => {
  const map = new Map(seed ? [[STORAGE_KEY, seed]] : []);
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), raw: () => map.get(STORAGE_KEY) };
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
