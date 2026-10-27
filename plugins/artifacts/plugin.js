// Artifacts: a sidebar page that lists your saved web pages and opens each in Buzz's built-in browser.
// No build step: this file is the plugin. The links are kept in localStorage under the plugin's id; nothing is fetched.

export const inject = ["react", "pages", "settingsCards", "browser"];

export const PLUGIN_ID = "megatech.artifacts";
export const STORAGE_KEY = PLUGIN_ID;
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

/** The saved list. `storage` is a localStorage-shaped object; every call that changes the list saves it and tells subscribers. */
export function createLinkStore(storage) {
  let links = readSaved(storage);
  let counter = 0;
  const listeners = new Set();
  const save = () => {
    links = [...links]; // a new array each time, so a React snapshot sees the change
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(links));
    } catch {
      // Storage full or blocked: the list still works until the page is closed.
    }
    for (const listener of [...listeners]) listener();
  };
  const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    list: () => links,
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
      save();
      return { ok: true };
    },
  };
}

const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 6.5h.01M10 6.5h.01"/></svg>',
  );

// Colours come from the host's theme tokens, each with a fallback.
const CSS = `
.megatech-artifacts{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--text-standard,inherit)}
.megatech-artifacts__bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 12px;border-bottom:1px solid color-mix(in srgb,currentColor 15%,transparent)}
.megatech-artifacts__chip{cursor:pointer;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:999px;padding:4px 12px;background:transparent;color:inherit;font:inherit}
.megatech-artifacts__chip:hover{background:var(--affordance-backdrop-pressed,color-mix(in srgb,currentColor 10%,transparent))}
.megatech-artifacts__chip[aria-current="true"]{outline:2px solid var(--accent-9,currentColor)}
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
    const [openId, setOpenId] = React.useState(undefined);
    const current = links.find((link) => link.id === openId);
    const body = !ctx.browser.available
      ? h("div", { className: "megatech-artifacts__empty" }, "Buzz's built-in browser is only available in the macOS desktop app, so these pages cannot be opened here.")
      : links.length === 0
        ? h("div", { className: "megatech-artifacts__empty" }, "No saved pages yet. Add one in Settings, in the Artifacts card.")
        : current
          ? // `key` gives each page its own browser session; the named storage keeps the sign-in.
            h(ctx.browser.View, { key: current.id, url: current.url, storage: BROWSER_STORAGE, label: current.name })
          : h("div", { className: "megatech-artifacts__empty" }, "Choose a page above.");
    return h(
      "div",
      { className: "megatech-artifacts" },
      h(
        "div",
        { className: "megatech-artifacts__bar", role: "toolbar", "aria-label": "Saved pages" },
        links.map((link) =>
          h("button", { key: link.id, type: "button", className: "megatech-artifacts__chip", "aria-current": link.id === openId ? "true" : "false", title: link.url, onClick: () => setOpenId(link.id) }, link.name),
        ),
      ),
      h("div", { className: "megatech-artifacts__view" }, body),
    );
  }

  function LinkRow({ link }) {
    const [name, setName] = React.useState(link.name);
    return h(
      "div",
      { className: "megatech-artifacts__row" },
      h("input", { value: name, "aria-label": `Name for ${link.url}`, onChange: (event) => setName(event.target.value) }),
      h("button", { type: "button", className: "ui-button", onClick: () => store.rename(link.id, name) }, "Rename"),
      h("button", { type: "button", className: "ui-button", onClick: () => store.remove(link.id) }, "Remove"),
      h("div", { className: "megatech-artifacts__url", style: { flexBasis: "100%" } }, link.url),
    );
  }

  function ArtifactsSettings() {
    const links = useLinks();
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
      h("p", null, "Saved pages show in the Artifacts page in the sidebar. They are kept on this computer, in this app's storage. Pages open in Buzz's built-in browser (macOS 14 or later keeps the sign-in between restarts)."),
      h(
        "form",
        { className: "megatech-artifacts__row", onSubmit: add },
        h("input", { value: name, placeholder: "Name (optional)", "aria-label": "Name", onChange: (event) => setName(event.target.value) }),
        h("input", { value: address, placeholder: "https://claude.ai/artifact/...", "aria-label": "Web address", onChange: (event) => setAddress(event.target.value) }),
        h("button", { type: "submit", className: "ui-button" }, "Add"),
      ),
      error ? h("div", { className: "megatech-artifacts__error", role: "alert" }, error) : null,
      links.map((link) => h(LinkRow, { key: link.id, link })),
    );
  }

  ctx.pages.register({ id: "artifacts", title: "Artifacts", primary: true, layout: "workspace", icon: ICON, component: ArtifactsPage });
  ctx.settingsCards.register({ id: "settings", title: "Artifacts", group: "Plugins", component: ArtifactsSettings });
}
