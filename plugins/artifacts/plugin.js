// Artifacts: a sidebar page that lists your saved web pages and opens each in Buzz's built-in browser, and a top-bar entry for each page you pin.
// No build step: this file is the plugin. The links are kept in localStorage under the plugin's id; nothing is fetched.

export const inject = ["react", "pages", "settingsCards", "browser"];

export const PLUGIN_ID = "megatech.artifacts";
export const STORAGE_KEY = PLUGIN_ID;
/** The id of the default page, kept beside the list so the list's own format is unchanged. */
export const DEFAULT_KEY = `${PLUGIN_ID}.default`;
/** The ids of the pages pinned to the top bar, as a JSON array, kept beside the list so the list's own format is unchanged. */
export const PINNED_KEY = `${PLUGIN_ID}.pinned`;
/** The named website storage the browser keeps between opens and restarts (macOS 14+), so a sign-in survives. */
export const BROWSER_STORAGE = "claude";
const MAX_URL_BYTES = 2048; // Buzz's browser limit, after normalization
const MAX_NAME = 80;

/** Checks an address the way Buzz's browser will: https only, no credentials, 2,048 bytes at most. */
export function checkUrl(input) {
  const text = String(input ?? "").trim();
  if (!text) return { ok: false, message: "Enter a web address." };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: "That is not a web address. Start it with https://" };
  }
  if (url.protocol !== "https:") return { ok: false, message: "Only https:// addresses can be saved." };
  if (url.username || url.password) return { ok: false, message: "Leave the user name and password out of the address." };
  if (new TextEncoder().encode(url.href).length > MAX_URL_BYTES) return { ok: false, message: "That address is too long (2,048 bytes at most)." };
  return { ok: true, value: url.href };
}

function defaultName(href) {
  const url = new URL(href);
  const tail = url.pathname.split("/").filter(Boolean).pop();
  return tail ? `${url.hostname} / ${tail}` : url.hostname;
}

function checkName(input, fallback) {
  const name = String(input ?? "").trim().slice(0, MAX_NAME);
  return name || fallback;
}

function readSaved(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    // Keep only well-formed rows; a hand-edited or old value never breaks the page.
    return parsed.flatMap((row) => {
      if (!row || typeof row.id !== "string" || typeof row.name !== "string") return [];
      const checked = checkUrl(row.url);
      return checked.ok ? [{ id: row.id, name: row.name, url: checked.value }] : [];
    });
  } catch {
    return [];
  }
}

function readDefault(storage) {
  try {
    const saved = storage.getItem(DEFAULT_KEY);
    return typeof saved === "string" ? saved : "";
  } catch {
    return "";
  }
}

function readPinned(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(PINNED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Buzz's rule for a page id (`src/features/pages/service.ts`): it starts with a lowercase letter or digit, then letters, digits, `.`, `_` or `-`. */
const PAGE_ID = /^[a-z0-9][a-z0-9._-]*$/;

/** The id of the top-bar page for a saved page, or `undefined` when the saved id could not make a valid one. */
export function pinPageId(linkId) {
  const id = `pin-${linkId}`;
  return PAGE_ID.test(id) ? id : undefined;
}

/**
 * The saved list, which page is the default, and which pages are pinned to the top bar. `storage` is a localStorage-shaped object; every call that changes
 * either saves it and tells subscribers. The default is the saved id when that page exists, otherwise the first
 * page, so a list saved before defaults existed, or a stale id, still has one. The pinned ids are only ever ones
 * that name a saved page and could make a valid top-bar page, without repeats; anything else saved is dropped.
 */
export function createLinkStore(storage) {
  let links = readSaved(storage);
  let savedDefault = readDefault(storage);
  const keepPinned = (ids) => [...new Set(ids)].filter((id) => pinPageId(id) && links.some((link) => link.id === id));
  let pinned = keepPinned(readPinned(storage));
  let counter = 0;
  const listeners = new Set();
  const defaultId = () => (links.some((link) => link.id === savedDefault) ? savedDefault : links[0]?.id);
  const save = () => {
    links = [...links]; // a new array each time, so a React snapshot sees the change
    savedDefault = defaultId() ?? ""; // write the default that applies now, so a stale id is repaired and the first page added sticks
    const kept = keepPinned(pinned); // a removed page is unpinned
    if (kept.length !== pinned.length) pinned = kept;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(links));
      storage.setItem(DEFAULT_KEY, savedDefault);
      storage.setItem(PINNED_KEY, JSON.stringify(pinned));
    } catch {
      // Storage full or blocked: the list still works until the page is closed.
    }
    for (const listener of [...listeners]) listener();
  };
  const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    list: () => links,
    /** The id of the default page, or `undefined` while the list is empty. A string, so a React snapshot compares it by value. */
    defaultId,
    /** The ids of the pinned pages, in the order they were pinned. The same array until a pin is added or dropped, so a React snapshot compares it by identity. */
    pinnedIds: () => pinned,
    isPinned: (id) => pinned.includes(id),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(name, address) {
      const checked = checkUrl(address);
      if (!checked.ok) return checked;
      if (links.some((link) => link.url === checked.value)) return { ok: false, message: "That address is already in the list." };
      const link = { id: newId(), name: checkName(name, defaultName(checked.value)), url: checked.value };
      links = [...links, link];
      save();
      return { ok: true, value: link };
    },
    rename(id, name) {
      const link = links.find((entry) => entry.id === id);
      if (!link) return { ok: false, message: "That link is gone." };
      links = links.map((entry) => (entry.id === id ? { ...entry, name: checkName(name, entry.name) } : entry));
      save();
      return { ok: true, value: links.find((entry) => entry.id === id) };
    },
    remove(id) {
      if (!links.some((entry) => entry.id === id)) return { ok: false, message: "That link is gone." };
      links = links.filter((entry) => entry.id !== id);
      save(); // if the default was removed, the first page left becomes it
      return { ok: true };
    },
    setDefault(id) {
      const link = links.find((entry) => entry.id === id);
      if (!link) return { ok: false, message: "That link is gone." };
      if (id !== defaultId()) {
        savedDefault = id;
        save();
      }
      return { ok: true, value: link };
    },
    pin(id) {
      const link = links.find((entry) => entry.id === id);
      if (!link) return { ok: false, message: "That link is gone." };
      if (!pinPageId(id)) return { ok: false, message: "That link cannot be pinned." };
      if (!pinned.includes(id)) {
        pinned = [...pinned, id];
        save();
      }
      return { ok: true, value: link };
    },
    unpin(id) {
      const link = links.find((entry) => entry.id === id);
      if (!link) return { ok: false, message: "That link is gone." };
      if (pinned.includes(id)) {
        pinned = pinned.filter((entry) => entry !== id);
        save();
      }
      return { ok: true, value: link };
    },
  };
}

// Colours come from the host's theme tokens, each with a fallback.
const CSS = `
.megatech-artifacts{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--text-standard,inherit)}
.megatech-artifacts__bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 12px;border-bottom:1px solid color-mix(in srgb,currentColor 15%,transparent)}
.megatech-artifacts__chip{cursor:pointer;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:999px;padding:4px 12px;background:transparent;color:inherit;font:inherit}
.megatech-artifacts__chip:hover{background:var(--affordance-backdrop-pressed,color-mix(in srgb,currentColor 10%,transparent))}
.megatech-artifacts__chip[aria-current="true"]{outline:2px solid var(--accent-9,currentColor)}
.megatech-artifacts__chip[data-default="true"]::before{content:"\\2605\\00a0";color:var(--accent-9,currentColor)}
.megatech-artifacts__actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.megatech-artifacts__action{font-size:.9em}
.megatech-artifacts__mark{opacity:.85;white-space:nowrap}
.megatech-artifacts__view{flex:1;min-height:0;display:flex;flex-direction:column}
.megatech-artifacts__empty{padding:24px 16px;opacity:.8;line-height:1.5}
.megatech-artifacts__card{display:flex;flex-direction:column;gap:12px}
.megatech-artifacts__row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.megatech-artifacts__row input{flex:1;min-width:140px;padding:6px 8px;border-radius:6px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);background:transparent;color:inherit;font:inherit}
.megatech-artifacts__row input:focus-visible,.megatech-artifacts__chip:focus-visible,.megatech-artifacts button:focus-visible{outline:2px solid var(--border-focus,var(--accent-9,currentColor));outline-offset:1px}
.megatech-artifacts__error{color:var(--text-danger,#c0392b)}
.megatech-artifacts__url{opacity:.7;font-size:.85em;word-break:break-all}
`;

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const store = createLinkStore(window.localStorage);
  const useLinks = () => React.useSyncExternalStore(store.subscribe, store.list);
  const useDefaultId = () => React.useSyncExternalStore(store.subscribe, store.defaultId);
  const usePinnedIds = () => React.useSyncExternalStore(store.subscribe, store.pinnedIds);
  const unavailable = (what) => h("div", { className: "megatech-artifacts__empty" }, `Buzz's built-in browser is only available in the macOS desktop app, so ${what} cannot be opened here.`);

  ctx.effect(() => {
    // [DOM] No style service in API v1: one <style> element, removed when the plugin's scope ends.
    const style = document.createElement("style");
    style.dataset.megatechArtifacts = "";
    style.textContent = CSS;
    document.head.append(style);
    return () => style.remove();
  });

  function ArtifactsPage() {
    const links = useLinks();
    const defaultId = useDefaultId();
    const pinnedIds = usePinnedIds();
    const [openId, setOpenId] = React.useState(undefined);
    // Open on the default until a chip is clicked; if the chosen page is removed, fall back to the default.
    const current = links.find((link) => link.id === openId) ?? links.find((link) => link.id === defaultId);
    const body = !ctx.browser.available
      ? unavailable("these pages")
      : links.length === 0
        ? h("div", { className: "megatech-artifacts__empty" }, "No saved pages yet. Add one in Settings, in the Artifacts card.")
        : current
          ? // `key` gives each page its own browser session; the named storage keeps the sign-in.
            h(ctx.browser.View, { key: current.id, url: current.url, storage: BROWSER_STORAGE, label: current.name })
          : null;
    return h(
      "div",
      { className: "megatech-artifacts" },
      h(
        "div",
        { className: "megatech-artifacts__bar", role: "toolbar", "aria-label": "Saved pages" },
        links.map((link) =>
          h(
            "button",
            {
              key: link.id,
              type: "button",
              className: "megatech-artifacts__chip",
              "aria-current": link.id === current?.id ? "true" : "false",
              "aria-label": link.id === defaultId ? `${link.name} (default)` : undefined,
              "data-default": link.id === defaultId ? "true" : "false",
              title: link.url,
              onClick: () => setOpenId(link.id),
            },
            link.name,
          ),
        ),
        current
          ? h(
              "span",
              { className: "megatech-artifacts__actions" },
              current.id !== defaultId
                ? h("button", { type: "button", className: "megatech-artifacts__chip megatech-artifacts__action", title: `Open ${current.name} first each time`, onClick: () => store.setDefault(current.id) }, "Make default")
                : null,
              pinnedIds.includes(current.id)
                ? h("button", { type: "button", className: "megatech-artifacts__chip megatech-artifacts__action", title: `Take ${current.name} off the top bar`, onClick: () => store.unpin(current.id) }, "Unpin")
                : h("button", { type: "button", className: "megatech-artifacts__chip megatech-artifacts__action", title: `Show ${current.name} in the top bar`, onClick: () => store.pin(current.id) }, "Pin to top bar"),
            )
          : null,
      ),
      h("div", { className: "megatech-artifacts__view" }, body),
    );
  }

  /** The page behind a top-bar entry: one saved page, straight in the browser, with no chip bar. */
  function pinnedPage(linkId) {
    return function PinnedPage() {
      const link = useLinks().find((entry) => entry.id === linkId);
      // A page removed while its entry is still going away has nothing to show.
      if (!link) return null;
      return h(
        "div",
        { className: "megatech-artifacts" },
        h("div", { className: "megatech-artifacts__view" }, ctx.browser.available ? h(ctx.browser.View, { key: link.id, url: link.url, storage: BROWSER_STORAGE, label: link.name }) : unavailable(link.name)),
      );
    };
  }

  function LinkRow({ link, isDefault, isPinned }) {
    const [name, setName] = React.useState(link.name);
    return h(
      "div",
      { className: "megatech-artifacts__row" },
      h("input", { value: name, "aria-label": `Name for ${link.url}`, onChange: (event) => setName(event.target.value) }),
      h("button", { type: "button", className: "ui-button", onClick: () => store.rename(link.id, name) }, "Rename"),
      h("button", { type: "button", className: "ui-button", onClick: () => store.remove(link.id) }, "Remove"),
      isDefault
        ? h("span", { className: "megatech-artifacts__mark" }, h("span", { "aria-hidden": "true" }, "\u2605 "), "Default")
        : h("button", { type: "button", className: "ui-button", "aria-label": `Make default: ${link.name}`, onClick: () => store.setDefault(link.id) }, "Make default"),
      isPinned
        ? h("button", { type: "button", className: "ui-button", "aria-label": `Unpin from the top bar: ${link.name}`, onClick: () => store.unpin(link.id) }, "Unpin")
        : h("button", { type: "button", className: "ui-button", "aria-label": `Pin to the top bar: ${link.name}`, onClick: () => store.pin(link.id) }, "Pin to top bar"),
      h("div", { className: "megatech-artifacts__url", style: { flexBasis: "100%" } }, link.url),
    );
  }

  function ArtifactsSettings() {
    const links = useLinks();
    const defaultId = useDefaultId();
    const pinnedIds = usePinnedIds();
    const [name, setName] = React.useState("");
    const [address, setAddress] = React.useState("");
    const [error, setError] = React.useState("");
    const add = (event) => {
      event.preventDefault();
      const result = store.add(name, address);
      if (result.ok) {
        setName("");
        setAddress("");
        setError("");
      } else setError(result.message);
    };
    return h(
      "div",
      { className: "megatech-artifacts megatech-artifacts__card", style: { height: "auto" } },
      h("p", null, "Saved pages show in the Artifacts page in the sidebar, which opens on the default page (the first one you add, until you pick another). Pin a page to give it its own entry in the top bar, next to Messages, which opens it at once; pinning and unpinning take effect straight away. They are kept on this computer, in this app's storage. Pages open in Buzz's built-in browser (macOS 14 or later keeps the sign-in between restarts)."),
      h(
        "form",
        { className: "megatech-artifacts__row", onSubmit: add },
        h("input", { value: name, placeholder: "Name (optional)", "aria-label": "Name", onChange: (event) => setName(event.target.value) }),
        h("input", { value: address, placeholder: "https://claude.ai/artifact/...", "aria-label": "Web address", onChange: (event) => setAddress(event.target.value) }),
        h("button", { type: "submit", className: "ui-button" }, "Add"),
      ),
      error ? h("div", { className: "megatech-artifacts__error", role: "alert" }, error) : null,
      links.map((link) => h(LinkRow, { key: link.id, link, isDefault: link.id === defaultId, isPinned: pinnedIds.includes(link.id) })),
    );
  }

  // No `icon` on any page: the host draws an `icon` as an <img>, which cannot take the theme's colour, and with none it draws its own
  // icon in the theme colour, like its other entries.
  ctx.pages.register({ id: "artifacts", title: "Artifacts", primary: true, layout: "workspace", component: ArtifactsPage });
  ctx.settingsCards.register({ id: "settings", title: "Artifacts", group: "Plugins", component: ArtifactsSettings });

  // One top-bar page per pinned saved page. `pages.register` returns no disposer and a registration lasts as long as its
  // scope, so each lives in a child scope (`ctx.plugin`) that is disposed to unpin. A title cannot change in place, so a
  // rename disposes the entry and registers it again. Disposal is asynchronous and the same id cannot be registered twice,
  // so changes are applied one round at a time, and a change that arrives during a round is applied in the next.
  const live = new Map(); // saved page id -> { title, fiber }
  let busy = false;
  let again = false;
  const wanted = () => {
    const titles = new Map();
    for (const link of store.list()) if (store.isPinned(link.id)) titles.set(link.id, link.name.trim() || link.url);
    return titles;
  };
  const register = (linkId, title) => {
    const id = pinPageId(linkId);
    if (!id) return;
    try {
      const fiber = ctx.plugin({
        name: id,
        inject: ["pages"],
        apply: (scope) => scope.pages.register({ id, title, primary: true, placement: "topbar", layout: "workspace", component: pinnedPage(linkId) }),
      });
      live.set(linkId, { title, fiber });
    } catch (error) {
      console.warn(`Artifacts: could not pin ${id}`, error); // a failed pin never breaks the others
    }
  };
  async function reconcile() {
    const keep = wanted();
    const stale = [...live].filter(([linkId, entry]) => keep.get(linkId) !== entry.title);
    for (const [linkId] of stale) live.delete(linkId);
    if (stale.length) {
      await Promise.all(stale.map(([, entry]) => Promise.resolve(entry.fiber.dispose()).catch((error) => console.warn("Artifacts: could not unpin", error))));
    }
    for (const [linkId, title] of wanted()) if (!live.has(linkId)) register(linkId, title);
  }
  async function sync() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        await reconcile();
      } while (again);
    } catch (error) {
      console.warn("Artifacts: could not update the top bar", error);
    } finally {
      busy = false;
    }
  }
  ctx.effect(() => {
    sync();
    return store.subscribe(sync); // the scope's end stops listening; its child scopes end with it
  });
}
