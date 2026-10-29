// Shared by the tests: a localStorage stand-in, the parts of Buzz's plugin host that the pins lean on, and a small stand-in for
// React that keeps the state of function components, so a click can be followed by what the page shows next.
import { apply, STORAGE_KEY, DEFAULT_KEY, PINNED_KEY } from "../plugin.js";

export const memory = (seed, savedDefault, savedPinned) => {
  const map = new Map(seed ? [[STORAGE_KEY, seed]] : []);
  if (savedDefault !== undefined) map.set(DEFAULT_KEY, savedDefault);
  if (savedPinned !== undefined) map.set(PINNED_KEY, savedPinned);
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), raw: () => map.get(STORAGE_KEY), rawDefault: () => map.get(DEFAULT_KEY), rawPinned: () => map.get(PINNED_KEY) };
};

export const row = (id) => ({ id, name: `page ${id}`, url: `https://example.org/${id}` });
export const seeded = (ids, savedDefault, savedPinned) => memory(JSON.stringify(ids.map(row)), savedDefault, savedPinned);
export const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * The parts of Buzz's plugin host that pinning leans on, as block/buzz-app d92bfb2c has them: a page stays listed until the
 * scope that registered it ends (src/plugins/contributions.ts), `pages.register` returns nothing, a page id must match
 * [a-z0-9][a-z0-9._-]* and be unique (src/features/pages/service.ts, contributions.ts), and `ctx.plugin` opens a child scope
 * whose `dispose()` is asynchronous. `listed` is what the shell would list.
 */
export function fakeHost({ failFor } = {}) {
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
 * A stand-in for the part of React the plugin uses. Function components keep their `useState` and `useRef` slots by their place
 * in the tree, so the same card is the same card from one `render` to the next. Components named in `keep` (the browser view)
 * are left as elements. Nothing re-renders by itself: a test presses something and calls `render` again.
 */
export function createReact() {
  const instances = new Map();
  let current;
  let index;
  const slot = (make) => {
    const i = index++;
    if (!(i in current.hooks)) current.hooks[i] = make();
    return current.hooks[i];
  };
  const React = {
    Fragment: Symbol.for("react.fragment"),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const state = slot(() => ({ value: typeof initial === "function" ? initial() : initial }));
      return [state.value, (next) => void (state.value = typeof next === "function" ? next(state.value) : next)];
    },
    useRef: (initial) => slot(() => ({ current: initial })),
    useSyncExternalStore: (_subscribe, get) => get(),
  };
  function expand(node, path, keep) {
    if (Array.isArray(node)) return node.map((child, i) => expand(child, `${path}.${i}`, keep));
    if (!node || typeof node !== "object") return node;
    if (node.type === React.Fragment) return { type: "fragment", props: {}, children: expand(node.children, path, keep) };
    if (typeof node.type === "function" && !keep.includes(node.type)) {
      const key = `${path}/${node.props.key ?? ""}/${node.type.name}`;
      if (!instances.has(key)) instances.set(key, { hooks: [] });
      const saved = [current, index];
      current = instances.get(key);
      index = 0;
      try {
        return expand(node.type({ ...node.props, children: node.children }), key, keep);
      } finally {
        [current, index] = saved;
      }
    }
    return { ...node, children: expand(node.children, path, keep) };
  }
  return { React, render: (component, props, root, keep = []) => expand(React.createElement(component, props), root, keep) };
}

/** Mounts the plugin on the stand-ins above. `page()`, `settings()` and `pinned(id)` render what Buzz would show right now. */
export function mount({ rows = [], savedDefault, savedPinned, available = true, storage: kept, failFor } = {}) {
  const cards = [];
  const View = () => null;
  const { React, render } = createReact();
  const storage = kept ?? (rows.length || savedDefault !== undefined || savedPinned !== undefined ? memory(JSON.stringify(rows.map(row)), savedDefault, savedPinned) : memory());
  const styles = [];
  globalThis.window = { localStorage: storage };
  globalThis.document = { createElement: () => ({ dataset: {}, remove() {} }), head: { append: (element) => styles.push(element) } };
  const { listed, root } = fakeHost({ failFor });
  apply({ ...root.ctx, react: React, browser: { available, View }, settingsCards: { register: (card) => cards.push(card) } });
  return {
    storage,
    View,
    listed,
    styles,
    unmount: () => root.dispose(),
    /** The pages listed in the top bar, by page id. */
    topbar: () => Object.fromEntries([...listed].filter(([, page]) => page.placement === "topbar").map(([id, page]) => [id, page.title])),
    page: () => render(listed.get("artifacts").component, {}, "page", [View]),
    settings: () => render(cards[0].component, {}, "settings", [View]),
    pinned: (id) => render(listed.get(id).component, {}, `pin:${id}`, [View]),
  };
}

// ---- Looking at a rendered tree, and pressing things in it ----

/** Every element in a rendered tree. */
export function flat(node, found = []) {
  if (Array.isArray(node)) node.forEach((child) => flat(child, found));
  else if (node && typeof node === "object") {
    found.push(node);
    flat(node.children, found);
  }
  return found;
}
export const textOf = (node) => (Array.isArray(node) ? node.map(textOf).join("") : node && typeof node === "object" ? textOf(node.children) : String(node ?? ""));
export const buttons = (tree) => flat(tree).filter((n) => n.type === "button");
export const hasClass = (node, name) => String(node.props?.className ?? "").split(/\s+/).includes(name);
export const byClass = (tree, name) => flat(tree).filter((n) => hasClass(n, name));
/** The Settings card's cards, in order. */
export const cardsOf = (tree) => byClass(tree, "megatech-artifacts-set__card").filter((n) => n.type === "li");
export const buttonNamed = (tree, label) => buttons(tree).find((b) => textOf(b) === label);
const event = (extra = {}) => ({ preventDefault() {}, stopPropagation() {}, ...extra });
/** Presses the button with this visible text; fails the test if there is none. */
export function press(tree, label) {
  const button = buttonNamed(tree, label);
  if (!button) throw new Error(`no button "${label}" in ${buttons(tree).map(textOf).join(" | ")}`);
  button.props.onClick(event({ currentTarget: button }));
}
/** Types into the input with this accessible label or placeholder. */
export function typeInto(tree, labelOrPlaceholder, value) {
  const input = flat(tree).find((n) => n.type === "input" && (n.props["aria-label"] === labelOrPlaceholder || n.props.placeholder === labelOrPlaceholder));
  if (!input) throw new Error(`no input "${labelOrPlaceholder}"`);
  input.props.onChange({ target: { value } });
}
export const submit = (form) => form.props.onSubmit(event());
export const formWith = (tree, className) => flat(tree).find((n) => n.type === "form" && hasClass(n, className));
