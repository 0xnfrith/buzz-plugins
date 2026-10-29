// Run with: node --test plugins/artifacts/test  (Node 22+, no dependencies)
// The plugin mounted on stand-ins for Buzz and React (harness.mjs): the sidebar page, the pages in the top bar, the Settings card.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mount, memory, settle, flat, textOf, buttons, hasClass, byClass, cardsOf, buttonNamed, press, typeInto, submit, formWith } from "./harness.mjs";

const view = (m, tree) => flat(tree).find((n) => n.type === m.View);
const chips = (tree) => buttons(tree).filter((b) => hasClass(b, "megatech-artifacts__chip") && !hasClass(b, "megatech-artifacts__action"));
/** Opens the page, then picks a chip by its saved name. */
const pick = (m, name) => press(m.page(), name);

// ---- The sidebar page and the Artifacts card exist; the page opens on the default ----

test("apply registers a sidebar page and a settings card, with no icon, and the page opens the browser with storage", () => {
  const m = mount({ rows: ["1"], savedDefault: "1" });
  const sidebar = m.listed.get("artifacts");
  assert.equal(sidebar.title, "Artifacts");
  assert.equal(sidebar.primary, true);
  assert.equal(sidebar.icon, undefined, "no icon, so the host draws its own in the theme colour");
  assert.equal(sidebar.placement, undefined, "the sidebar entry keeps the host's default placement");
  const shown = view(m, m.page());
  assert.equal(shown.props.storage, "claude");
  assert.equal(shown.props.url, "https://example.org/1");
});

test("opening the page loads the default at once, with no click", () => {
  const m = mount({ rows: ["1", "2", "3"], savedDefault: "2" });
  const shown = view(m, m.page());
  assert.ok(shown, "the browser view is rendered on the first render");
  assert.equal(shown.props.url, "https://example.org/2");
  assert.equal(shown.props.storage, "claude");
  assert.equal(shown.props.key, "2");
});

test("an old list with no saved default opens on its first page", () => {
  const m = mount({ rows: ["1", "2"] });
  assert.equal(view(m, m.page()).props.url, "https://example.org/1");
});

test("the default chip is marked, the open chip is current, and only the default is marked", () => {
  const m = mount({ rows: ["1", "2", "3"], savedDefault: "2" });
  const bar = chips(m.page());
  assert.equal(bar.length, 3);
  assert.deepEqual(bar.map((b) => b.props["data-default"]), ["false", "true", "false"]);
  assert.deepEqual(bar.map((b) => b.props["aria-label"]), [undefined, "page 2 (default)", undefined]);
  assert.deepEqual(bar.map((b) => b.props["aria-current"]), ["false", "true", "false"]);
});

test("a page chosen by hand is shown, with a Make default control; choosing the default has none", () => {
  const m = mount({ rows: ["1", "2"], savedDefault: "1" });
  assert.equal(buttonNamed(m.page(), "Make default"), undefined);
  pick(m, "page 2");
  const tree = m.page();
  assert.equal(view(m, tree).props.url, "https://example.org/2");
  press(tree, "Make default");
  assert.equal(m.storage.rawDefault(), "2");
  const after = m.page();
  assert.equal(buttonNamed(after, "Make default"), undefined, "now it is the default, the control goes");
  assert.equal(view(m, after).props.url, "https://example.org/2");
});

test("pressing Make default on the page puts the focus on that page's chip, since the button it was on goes away", () => {
  const m = mount({ rows: ["1", "2"], savedDefault: "1" });
  pick(m, "page 2");
  const tree = m.page();
  let focused = 0;
  const chip = chips(tree).find((b) => textOf(b) === "page 2");
  chip.props.ref({ focus: () => focused++ });
  press(tree, "Make default");
  assert.equal(focused, 1);
});

test("if the open page is removed the page falls back to the default", () => {
  const m = mount({ rows: ["1", "2", "3"], savedDefault: "1" });
  pick(m, "page 3");
  const card = cardsOf(m.settings()).find((c) => textOf(c).includes("page 3"));
  press(card, "Remove");
  press(cardsOf(m.settings()).find((c) => textOf(c).includes("page 3")), "Remove");
  assert.deepEqual(JSON.parse(m.storage.raw()).map((l) => l.id), ["1", "2"]);
  assert.equal(view(m, m.page()).props.url, "https://example.org/1");
});

test("the first page added while the page is open opens at once; with no pages the empty message shows", () => {
  const m = mount();
  const empty = m.page();
  assert.equal(view(m, empty), undefined);
  assert.match(textOf(empty), /No saved pages yet/);
  const tree = m.settings();
  typeInto(tree, "https://claude.ai/artifact/…", "https://example.org/new");
  submit(formWith(m.settings(), "megatech-artifacts-set__add"));
  assert.equal(view(m, m.page()).props.url, "https://example.org/new");
});

test("on a host without the browser, the chip bar still shows the default as current", () => {
  const m = mount({ rows: ["1", "2"], savedDefault: "2", available: false });
  const tree = m.page();
  assert.match(textOf(tree), /only available in the macOS desktop app/);
  assert.equal(chips(tree).find((b) => b.props["aria-current"] === "true").props.title, "https://example.org/2");
});

test("a saved name that is only blanks reads as the page's address on the chip, the card, the view label and the top-bar entry", async () => {
  const blank = JSON.stringify([{ id: "1", name: "   ", url: "https://example.org/blank" }]);
  const m = mount({ storage: memory(blank, undefined, JSON.stringify(["1"])) });
  const page = m.page();
  assert.equal(textOf(chips(page)[0]), "https://example.org/blank");
  assert.equal(view(m, page).props.label, "https://example.org/blank");
  assert.equal(textOf(byClass(m.settings(), "megatech-artifacts-set__name")[0]), "https://example.org/blank");
  assert.deepEqual(m.topbar(), { "pin-1": "https://example.org/blank" });
  assert.equal(view(m, m.pinned("pin-1")).props.label, "https://example.org/blank");
  const nobrowser = mount({ storage: memory(blank, undefined, JSON.stringify(["1"])), available: false });
  assert.match(textOf(nobrowser.pinned("pin-1")), /so https:\/\/example\.org\/blank cannot be opened here/);
});

// ---- The Settings card ----

test("the card has a heading, a one-line lede and an add form, and counts what is saved and what is in the top bar", () => {
  const m = mount({ rows: ["1", "2", "3"], savedPinned: JSON.stringify(["2"]) });
  const tree = m.settings();
  assert.equal(textOf(byClass(tree, "megatech-artifacts-set__title")[0]), "Saved pages");
  assert.match(textOf(byClass(tree, "megatech-artifacts-set__lede")[0]), /open in Buzz's browser/);
  const count = byClass(tree, "megatech-artifacts-set__count")[0];
  assert.equal(textOf(count), "3 saved1 in the top bar");
  assert.equal(count.props.role, "status", "a change in the numbers is announced");
  assert.equal(cardsOf(tree).length, 3);
});

test("each card shows the name, the address and what the page is: default, in the top bar, both or neither", () => {
  const m = mount({ rows: ["1", "2", "3"], savedDefault: "2", savedPinned: JSON.stringify(["2", "3"]) });
  const cards = cardsOf(m.settings());
  assert.deepEqual(cards.map((c) => c.props["data-default"]), ["false", "true", "false"]);
  assert.deepEqual(cards.map((c) => c.props["data-pinned"]), ["false", "true", "true"]);
  assert.match(textOf(cards[1]), /page 2.*Default.*Top bar.*https:\/\/example\.org\/2/);
  assert.doesNotMatch(textOf(cards[0]), /Default|Top bar/);
  assert.match(textOf(cards[2]), /Top bar/);
  assert.doesNotMatch(textOf(cards[2]), /Default/);
});

test("every card but the default one has Make default, and pressing it moves the default", () => {
  const m = mount({ rows: ["1", "2", "3"], savedDefault: "2" });
  const cards = cardsOf(m.settings());
  assert.deepEqual(cards.map((c) => Boolean(buttonNamed(c, "Make default"))), [true, false, true]);
  press(cards[0], "Make default");
  assert.equal(m.storage.rawDefault(), "1");
  assert.deepEqual(cardsOf(m.settings()).map((c) => c.props["data-default"]), ["true", "false", "false"]);
});

test("adding a page: the fields clear and the card appears; the empty state goes", () => {
  const m = mount();
  assert.ok(byClass(m.settings(), "megatech-artifacts-set__empty").length, "the empty state shows with no pages");
  assert.equal(cardsOf(m.settings()).length, 0);
  typeInto(m.settings(), "Quarterly report", "Report");
  typeInto(m.settings(), "https://claude.ai/artifact/…", "https://example.org/report");
  submit(formWith(m.settings(), "megatech-artifacts-set__add"));
  const tree = m.settings();
  assert.equal(cardsOf(tree).length, 1);
  assert.match(textOf(cardsOf(tree)[0]), /Report/);
  assert.equal(byClass(tree, "megatech-artifacts-set__empty").length, 0);
  const inputs = flat(tree).filter((n) => n.type === "input");
  assert.deepEqual(inputs.map((i) => i.props.value), ["", ""]);
  assert.equal(inputs[0].props.maxLength, 80, "the name field has the store's limit");
});

test("a bad address is not saved: an alert says why, the field is marked invalid and points at the message, and typing again clears it", () => {
  const m = mount({ rows: ["1"] });
  typeInto(m.settings(), "https://claude.ai/artifact/…", "claude.ai/x");
  submit(formWith(m.settings(), "megatech-artifacts-set__add"));
  let tree = m.settings();
  const alert = flat(tree).find((n) => n.props?.role === "alert");
  assert.ok(alert);
  assert.match(textOf(alert), /Not saved.*Start it with https:\/\//);
  const input = flat(tree).find((n) => n.type === "input" && n.props.placeholder === "https://claude.ai/artifact/…");
  assert.equal(input.props["aria-invalid"], "true");
  assert.equal(input.props["aria-describedby"], alert.props.id);
  assert.equal(cardsOf(tree).length, 1, "nothing was added");
  typeInto(tree, "https://claude.ai/artifact/…", "https://example.org/2");
  tree = m.settings();
  assert.equal(flat(tree).find((n) => n.props?.role === "alert"), undefined);
  assert.equal(flat(tree).find((n) => n.type === "input" && n.props.placeholder === "https://claude.ai/artifact/…").props["aria-invalid"], "false");
});

test("Rename turns the name into a field in place; Save keeps the new name and puts the focus back on Rename", async () => {
  const m = mount({ rows: ["1", "2"] });
  const before = cardsOf(m.settings())[0];
  const renameButton = buttonNamed(before, "Rename");
  let focused = 0;
  renameButton.props.ref.current = { focus: () => focused++ };
  press(before, "Rename");
  const editing = cardsOf(m.settings())[0];
  const field = flat(editing).find((n) => n.type === "input");
  assert.equal(field.props.value, "page 1");
  assert.equal(field.props.autoFocus, true);
  assert.equal(field.props.maxLength, 80, "the same limit as the store");
  assert.ok(buttonNamed(editing, "Save") && buttonNamed(editing, "Cancel"));
  assert.equal(buttonNamed(editing, "Remove"), undefined, "the other actions wait while the name is edited");
  assert.equal(buttonNamed(editing, "Pin to top bar"), undefined);
  typeInto(editing, `Name for https://example.org/1`, "Renamed");
  assert.equal(JSON.parse(m.storage.raw())[0].name, "page 1", "nothing is saved until Save");
  submit(formWith(cardsOf(m.settings())[0], "megatech-artifacts-set__edit"));
  assert.equal(JSON.parse(m.storage.raw())[0].name, "Renamed");
  assert.match(textOf(cardsOf(m.settings())[0]), /Renamed/);
  await settle();
  assert.equal(focused, 1);
});

test("Cancel and Esc leave the rename as it was; Esc does not reach Settings, which would close", async () => {
  const m = mount({ rows: ["1"] });
  const rename = buttonNamed(cardsOf(m.settings())[0], "Rename");
  let focused = 0;
  rename.props.ref.current = { focus: () => focused++ };
  press(cardsOf(m.settings())[0], "Rename");
  typeInto(cardsOf(m.settings())[0], "Name for https://example.org/1", "Changed");
  press(cardsOf(m.settings())[0], "Cancel");
  assert.equal(JSON.parse(m.storage.raw())[0].name, "page 1");
  assert.match(textOf(cardsOf(m.settings())[0]), /page 1/);
  // and again with Esc
  press(cardsOf(m.settings())[0], "Rename");
  assert.equal(flat(cardsOf(m.settings())[0]).find((n) => n.type === "input").props.value, "page 1", "a cancelled edit starts over from the saved name");
  typeInto(cardsOf(m.settings())[0], "Name for https://example.org/1", "Changed again");
  let stopped = 0;
  // the form hears Esc from the field and from Save and Cancel alike
  formWith(cardsOf(m.settings())[0], "megatech-artifacts-set__edit").props.onKeyDown({ key: "Escape", stopPropagation: () => stopped++ });
  assert.equal(stopped, 1);
  assert.equal(JSON.parse(m.storage.raw())[0].name, "page 1");
  assert.equal(buttonNamed(cardsOf(m.settings())[0], "Save"), undefined);
  // any other key is left alone
  press(cardsOf(m.settings())[0], "Rename");
  formWith(cardsOf(m.settings())[0], "megatech-artifacts-set__edit").props.onKeyDown({ key: "a", stopPropagation: () => stopped++ });
  assert.equal(stopped, 1);
  await settle();
  assert.equal(focused, 2, "Cancel and Esc each put the focus back on Rename");
});

test("Remove asks once: Keep leaves the page and the focus on Remove; only the second Remove deletes", async () => {
  const m = mount({ rows: ["1", "2"], savedPinned: JSON.stringify(["1"]) });
  const remove = buttonNamed(cardsOf(m.settings())[0], "Remove");
  let focused = 0;
  remove.props.ref.current = { focus: () => focused++ };
  press(cardsOf(m.settings())[0], "Remove");
  let card = cardsOf(m.settings())[0];
  assert.match(textOf(card), /Remove this page\?/);
  assert.equal(JSON.parse(m.storage.raw()).length, 2, "asking deletes nothing");
  assert.equal(buttonNamed(card, "Keep").props.autoFocus, true, "the safe answer has the focus");
  assert.equal(flat(card).find((n) => n.props?.role === "group").props["aria-label"], "Remove page 1?", "the question names the page");
  assert.equal(buttonNamed(card, "Rename"), undefined, "the other actions wait for the answer");
  press(card, "Keep");
  assert.equal(JSON.parse(m.storage.raw()).length, 2);
  assert.ok(buttonNamed(cardsOf(m.settings())[0], "Rename"), "the actions are back");
  await settle();
  assert.equal(focused, 1);
  // Esc is a No as well, and does not close Settings
  press(cardsOf(m.settings())[0], "Remove");
  let stopped = 0;
  const group = flat(cardsOf(m.settings())[0]).find((n) => hasClass(n, "megatech-artifacts-set__actions"));
  group.props.onKeyDown({ key: "Escape", stopPropagation: () => stopped++ });
  assert.equal(stopped, 1);
  assert.equal(JSON.parse(m.storage.raw()).length, 2);
  // yes
  press(cardsOf(m.settings())[0], "Remove");
  press(cardsOf(m.settings())[0], "Remove");
  assert.deepEqual(JSON.parse(m.storage.raw()).map((l) => l.id), ["2"]);
  assert.deepEqual(JSON.parse(m.storage.rawPinned()), [], "a removed page is unpinned");
});

test("the card's buttons say which page they act on, for a screen reader", () => {
  const m = mount({ rows: ["1", "2"], savedDefault: "1", savedPinned: JSON.stringify(["2"]) });
  const [one, two] = cardsOf(m.settings());
  const labels = (card) => buttons(card).map((b) => b.props["aria-label"]);
  assert.deepEqual(labels(one), ["Rename page 1", "Pin to the top bar: page 1", "Remove page 1"]);
  assert.deepEqual(labels(two), ["Rename page 2", "Make default: page 2", "Unpin from the top bar: page 2", "Remove page 2"]);
});

test("a saved page whose id could not make a page id (a hand-edited list) has no Pin button, on the card or on the chip bar", () => {
  const odd = JSON.stringify([{ id: "Odd Id", name: "odd", url: "https://example.org/odd" }, { id: "2", name: "two", url: "https://example.org/2" }]);
  const m = mount({ storage: memory(odd, "Odd Id") });
  const [first, second] = cardsOf(m.settings());
  assert.equal(buttonNamed(first, "Pin to top bar"), undefined);
  assert.ok(buttonNamed(second, "Pin to top bar"));
  assert.equal(buttonNamed(m.page(), "Pin to top bar"), undefined, "the open page is the odd one");
  pick(m, "two");
  assert.ok(buttonNamed(m.page(), "Pin to top bar"));
});

// ---- Fonts and the stylesheet ----

test("the stylesheet carries two embedded fonts, as data, and nothing is fetched for them", () => {
  const m = mount({ rows: ["1"] });
  const css = m.styles[0].textContent;
  assert.match(css, /@font-face\{font-family:"Chakra Petch";[^}]*src:url\(data:font\/woff2;base64,/);
  assert.match(css, /@font-face\{font-family:"Share Tech Mono";[^}]*src:url\(data:font\/woff2;base64,/);
  assert.doesNotMatch(css, /url\((?!data:)/, "every url() is inline data");
  assert.doesNotMatch(css, /@import|https?:\/\//);
  assert.match(css, /--megatech-artifacts-display:"Chakra Petch",ui-sans-serif/, "system fonts follow in the stack");
  assert.match(css, /--megatech-artifacts-mono:"Share Tech Mono",ui-monospace/);
});

test("the card's colours: the brand accents are variables on its own root, never on the page's root, and the host's tokens come first", () => {
  const css = mount({ rows: ["1"] }).styles[0].textContent;
  assert.doesNotMatch(css, /(^|\n)(:root|html|body)\s*\{/, "no rule styles the whole page");
  assert.match(css, /\.megatech-artifacts-set\{--megatech-artifacts-cyan:#00d4ff;/);
  for (const token of ["--text-standard", "--text-subtle", "--text-metadata", "--surface-panel", "--border-standard"]) assert.match(css, new RegExp(`var\\(${token},#`), `${token} has a fallback`);
  // in light, the darker inks carry text and the lines that mean something
  assert.match(css, /:root\[data-color-mode="light"\] \.megatech-artifacts-set\{[^}]*--megatech-artifacts-accent:#00708f;[^}]*--megatech-artifacts-pin:#c4009f;[^}]*--megatech-artifacts-bad:#c2362b/);
  assert.match(css, /--megatech-artifacts-edge:#00708f;/);
  // the default star on the chip bar takes the chip's own text colour
  assert.match(css, /data-default="true"\]::before\{content:"\\2605\\00a0"\}/);
});

test("the classes and variables are named after the plugin", () => {
  const source = readFileSync(new URL("../plugin.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  const css = source.slice(source.indexOf("const CSS = `"), source.indexOf("export function apply"));
  assert.doesNotMatch(css, /\.mt-|--mt-/);
  for (const name of css.match(/\.[a-z][a-z0-9_-]*/g)) {
    if (/^\.\d/.test(name)) continue;
    assert.match(name, /^\.megatech-artifacts/, `${name} is named after the plugin`);
  }
});

// ---- The narrow window ----

test("the card adapts to a narrow Settings window with container queries on its own root", () => {
  const css = mount({ rows: ["1"] }).styles[0].textContent;
  assert.match(css, /\.megatech-artifacts-set\{[^}]*container-type:inline-size/);
  assert.match(css, /@container \(max-width: 600px\)\{[^@]*\.megatech-artifacts-set__add\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /@container \(max-width: 420px\)\{/);
});

// ---- Pinning a page to the top bar ----

test("the sidebar page is unchanged and no top-bar page exists until one is pinned", async () => {
  const m = mount({ rows: ["1", "2"] });
  await settle();
  const sidebar = m.listed.get("artifacts");
  assert.equal(sidebar.title, "Artifacts");
  assert.equal(sidebar.primary, true);
  assert.deepEqual(m.topbar(), {});
});

test("each pinned page registers as its own primary top-bar page, named for the saved page, with no icon", async () => {
  const m = mount({ rows: ["1", "2", "3"], savedPinned: JSON.stringify(["3", "1"]) });
  assert.deepEqual(m.topbar(), { "pin-3": "page 3", "pin-1": "page 1" }, "registered during activation, before any await");
  for (const id of ["pin-1", "pin-3"]) {
    const page = m.listed.get(id);
    assert.equal(page.primary, true);
    assert.equal(page.placement, "topbar");
    assert.equal(page.layout, "workspace");
    assert.equal(page.icon, undefined, "no icon, so the host draws its own in the theme colour");
    assert.equal(typeof page.component, "function");
  }
  await settle();
  assert.deepEqual(Object.keys(m.topbar()).sort(), ["pin-1", "pin-3"], "nothing registered twice");
});

test("pinning from the Settings card adds a top-bar page without a restart; unpinning removes it", async () => {
  const m = mount({ rows: ["1", "2"] });
  const second = () => cardsOf(m.settings())[1];
  assert.ok(buttonNamed(second(), "Pin to top bar"));
  press(second(), "Pin to top bar");
  await settle();
  assert.deepEqual(m.topbar(), { "pin-2": "page 2" });
  assert.ok(buttonNamed(second(), "Unpin"));
  assert.match(textOf(second()), /Top bar/);
  assert.equal(buttonNamed(cardsOf(m.settings())[0], "Unpin"), undefined);
  assert.deepEqual(JSON.parse(m.storage.rawPinned()), ["2"]);
  press(second(), "Unpin");
  await settle();
  assert.deepEqual(m.topbar(), {});
  assert.deepEqual(JSON.parse(m.storage.rawPinned()), []);
  assert.ok(m.listed.has("artifacts"), "the sidebar entry stays");
});

test("the Artifacts page offers Pin to top bar for the open page and Unpin once it is pinned", async () => {
  const m = mount({ rows: ["1", "2"], savedDefault: "1" });
  pick(m, "page 2");
  assert.equal(buttonNamed(m.page(), "Unpin"), undefined);
  press(m.page(), "Pin to top bar");
  await settle();
  assert.deepEqual(m.topbar(), { "pin-2": "page 2" });
  const after = m.page();
  assert.equal(buttonNamed(after, "Pin to top bar"), undefined);
  assert.ok(buttonNamed(after, "Make default"), "the default control is still there beside it");
  press(after, "Unpin");
  await settle();
  assert.deepEqual(m.topbar(), {});
  assert.ok(buttonNamed(m.page(), "Pin to top bar"));
});

test("the pin control follows the open page, including the default page, and is absent with no pages", () => {
  const onDefault = mount({ rows: ["1", "2"], savedDefault: "1" });
  assert.ok(buttonNamed(onDefault.page(), "Pin to top bar"));
  const empty = mount();
  assert.equal(buttons(empty.page()).some((b) => /Pin|Unpin/.test(textOf(b))), false);
});

test("renaming a pinned page renames its top-bar entry; renaming an unpinned one adds none", async () => {
  const m = mount({ rows: ["1", "2"], savedPinned: JSON.stringify(["2"]) });
  assert.deepEqual(m.topbar(), { "pin-2": "page 2" });
  const rename = (index, name) => {
    press(cardsOf(m.settings())[index], "Rename");
    typeInto(cardsOf(m.settings())[index], `Name for https://example.org/${index + 1}`, name);
    submit(formWith(cardsOf(m.settings())[index], "megatech-artifacts-set__edit"));
  };
  rename(1, "renamed");
  await settle();
  assert.deepEqual(m.topbar(), { "pin-2": "renamed" });
  rename(0, "unpinned one");
  await settle();
  assert.deepEqual(m.topbar(), { "pin-2": "renamed" });
  assert.equal(m.listed.get("artifacts").title, "Artifacts", "the sidebar title does not follow a rename");
});

test("removing a pinned page removes its top-bar entry and its pin", async () => {
  const m = mount({ rows: ["1", "2"], savedPinned: JSON.stringify(["1", "2"]) });
  const gone = m.listed.get("pin-1");
  press(cardsOf(m.settings())[0], "Remove");
  press(cardsOf(m.settings())[0], "Remove");
  await settle();
  assert.deepEqual(m.topbar(), { "pin-2": "page 2" });
  assert.deepEqual(JSON.parse(m.storage.rawPinned()), ["2"]);
  assert.equal(gone.component({}), null, "a page that is going away renders nothing");
});

test("pins survive a restart: the same storage mounted again registers the same top-bar pages", async () => {
  const first = mount({ rows: ["1", "2", "3"] });
  press(cardsOf(first.settings())[2], "Pin to top bar");
  press(cardsOf(first.settings())[0], "Pin to top bar");
  await settle();
  assert.deepEqual(Object.keys(first.topbar()).sort(), ["pin-1", "pin-3"]);
  await first.unmount();
  assert.deepEqual(first.topbar(), {});
  const restarted = mount({ storage: first.storage });
  assert.deepEqual(restarted.topbar(), { "pin-1": "page 1", "pin-3": "page 3" });
});

test("a pinned page shows its own address in the browser at once, with no chip bar", () => {
  const m = mount({ rows: ["1", "2"], savedPinned: JSON.stringify(["2"]) });
  const tree = m.pinned("pin-2");
  const shown = view(m, tree);
  assert.ok(shown, "the browser view is rendered on the first render");
  assert.equal(shown.props.url, "https://example.org/2");
  assert.equal(shown.props.storage, "claude");
  assert.equal(shown.props.label, "page 2");
  assert.equal(shown.props.key, "2");
  assert.equal(buttons(tree).length, 0, "no chip bar to pick from");
  assert.equal(flat(tree).some((n) => n.props?.role === "toolbar"), false);
});

test("on a host without the browser a pinned page says so and names the page", () => {
  const m = mount({ rows: ["1", "2"], savedPinned: JSON.stringify(["2"]), available: false });
  const text = textOf(m.pinned("pin-2"));
  assert.match(text, /only available in the macOS desktop app/);
  assert.match(text, /page 2/);
});

test("a change that arrives while the last one is still being applied ends in the last state, with no double registration", async () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const m = mount({ rows: ["1", "2"] });
    const card = (i) => cardsOf(m.settings())[i];
    const rename = (i, from, name) => {
      press(card(i), "Rename");
      typeInto(card(i), `Name for https://example.org/${i + 1}`, name);
      submit(formWith(card(i), "megatech-artifacts-set__edit"));
    };
    press(card(0), "Pin to top bar");
    press(card(0), "Unpin");
    press(card(0), "Pin to top bar");
    await settle();
    assert.deepEqual(m.topbar(), { "pin-1": "page 1" });
    // Unpin and pin again before the old entry has finished going away: the new one must wait for it.
    press(card(0), "Unpin");
    assert.deepEqual(m.topbar(), { "pin-1": "page 1" }, "disposal is asynchronous, so the entry is still listed");
    press(card(0), "Pin to top bar");
    await settle();
    assert.deepEqual(m.topbar(), { "pin-1": "page 1" });
    // Rename twice in a row, the second while the first is still going.
    rename(0, "page 1", "second");
    rename(0, "second", "third");
    await settle();
    assert.deepEqual(m.topbar(), { "pin-1": "third" });
    // Swap which page is pinned in one go.
    press(card(0), "Unpin");
    press(card(1), "Pin to top bar");
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
  press(cardsOf(m.settings())[1], "Pin to top bar");
  await settle();
  assert.deepEqual([...m.listed.keys()], []);
});
