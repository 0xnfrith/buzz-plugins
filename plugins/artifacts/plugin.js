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
/** A page as the person sees it: its name, or its address when the saved name is only blanks. */
export function displayName(link) {
  return link.name.trim() || link.url;
}

const ERROR_ID = `${PLUGIN_ID}-address-error`;
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

// Colours come from the host's theme tokens, each with a fallback; the Settings card adds its own accents (see its comment).
const CSS = `
.megatech-artifacts{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--text-standard,inherit)}
.megatech-artifacts__bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 12px;border-bottom:1px solid color-mix(in srgb,currentColor 15%,transparent)}
.megatech-artifacts__chip{cursor:pointer;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:999px;padding:4px 12px;background:transparent;color:inherit;font:inherit}
.megatech-artifacts__chip:hover{background:var(--affordance-backdrop-pressed,color-mix(in srgb,currentColor 10%,transparent))}
.megatech-artifacts__chip[aria-current="true"]{outline:2px solid var(--accent-9,currentColor)}
.megatech-artifacts__chip[data-default="true"]::before{content:"\\2605\\00a0"}
.megatech-artifacts__actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.megatech-artifacts__action{font-size:.9em}
.megatech-artifacts__view{flex:1;min-height:0;display:flex;flex-direction:column}
.megatech-artifacts__empty{padding:24px 16px;opacity:.8;line-height:1.5}
.megatech-artifacts__chip:focus-visible,.megatech-artifacts button:focus-visible{outline:2px solid var(--border-focus,var(--accent-9,currentColor));outline-offset:1px}

/* ---- The Settings card ---------------------------------------------------------------------------------------------
   Surfaces, text and borders come from the host's tokens, so light and dark follow Settings > Appearance. The card's own
   look sits on top as named custom properties on its root (never on <html>): cyan, magenta, hairlines, square corners and
   type. Every host token has a fallback. In light the accents used as text or as a line that means something are the
   darker inks (at least 3:1 on white); the bright cyan only fills the Add button and decorates. */
.megatech-artifacts-set{--megatech-artifacts-cyan:#00d4ff;--megatech-artifacts-cyan-bright:#4aeaff;--megatech-artifacts-on-cyan:#02222c;--megatech-artifacts-cyan-wash:rgba(0,212,255,.07);--megatech-artifacts-cyan-line:rgba(0,212,255,.32);--megatech-artifacts-hair:rgba(0,212,255,.16);
  --megatech-artifacts-magenta-line:rgba(255,43,214,.32);--megatech-artifacts-accent:#00d4ff;--megatech-artifacts-pin:#ff2bd6;--megatech-artifacts-bad:#ff6b5e;
  --megatech-artifacts-edge:rgba(0,212,255,.55);--megatech-artifacts-ctl:rgba(0,212,255,.5);--megatech-artifacts-pin-edge:rgba(255,43,214,.7);--megatech-artifacts-bar:#00d4ff;--megatech-artifacts-bad-edge:color-mix(in srgb,#ff6b5e 75%,transparent);
  --megatech-artifacts-ink:var(--text-standard,#e9eef4);--megatech-artifacts-muted:var(--text-subtle,#a7b2be);--megatech-artifacts-faint:var(--text-metadata,#8290a0);
  --megatech-artifacts-ground:var(--surface-panel,#12161c);--megatech-artifacts-line:var(--border-standard,#2b333d);--megatech-artifacts-field:color-mix(in srgb,var(--megatech-artifacts-ink) 5%,transparent);--megatech-artifacts-input-edge:color-mix(in srgb,var(--megatech-artifacts-ink) 55%,transparent);
  --megatech-artifacts-display:"Chakra Petch",ui-sans-serif,system-ui,"Helvetica Neue",Arial,sans-serif;
  --megatech-artifacts-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  display:flex;flex-direction:column;gap:22px;max-width:760px;container-type:inline-size;color:var(--megatech-artifacts-ink);font:400 12.5px/1.6 var(--megatech-artifacts-mono)}
:root[data-color-mode="light"] .megatech-artifacts-set{--megatech-artifacts-cyan-wash:rgba(0,212,255,.09);--megatech-artifacts-hair:rgba(0,150,190,.22);--megatech-artifacts-cyan-line:rgba(0,150,190,.42);--megatech-artifacts-magenta-line:rgba(196,0,159,.38);
  --megatech-artifacts-accent:#00708f;--megatech-artifacts-pin:#c4009f;--megatech-artifacts-bad:#c2362b;
  /* Lines that carry meaning (default, focus, an input's edge, a control's edge) use the darker inks, at least 3:1 on white; the bright cyan stays on fills and decoration */
  --megatech-artifacts-edge:#00708f;--megatech-artifacts-ctl:color-mix(in srgb,#00708f 75%,transparent);--megatech-artifacts-pin-edge:#c4009f;--megatech-artifacts-bar:#00708f;--megatech-artifacts-bad-edge:color-mix(in srgb,#c2362b 80%,transparent)}
.megatech-artifacts-set *{box-sizing:border-box}
.megatech-artifacts-set :where(button,input){font:inherit;color:inherit;border-radius:0;margin:0}
.megatech-artifacts-set :focus-visible{outline:2px solid var(--megatech-artifacts-accent);outline-offset:2px}

.megatech-artifacts-set__head{display:flex;flex-direction:column;gap:6px}
.megatech-artifacts-set__eyebrow{display:flex;align-items:center;gap:14px;font:700 16px/1.35 var(--megatech-artifacts-display);letter-spacing:.1em;text-transform:uppercase;color:var(--megatech-artifacts-accent)}
.megatech-artifacts-set__eyebrow::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--megatech-artifacts-cyan-line),transparent)}
.megatech-artifacts-set__title{margin:0;font:700 24px/1.25 var(--megatech-artifacts-display);letter-spacing:.02em;color:var(--megatech-artifacts-ink)}
.megatech-artifacts-set__lede{margin:0;max-width:62ch;color:var(--megatech-artifacts-muted)}

.megatech-artifacts-set__add{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.8fr) auto;gap:14px;align-items:end;padding:22px 24px;border:1px solid var(--megatech-artifacts-hair);
  background:linear-gradient(180deg,var(--megatech-artifacts-cyan-wash),transparent 78%),var(--megatech-artifacts-ground)}
.megatech-artifacts-set__add::before,.megatech-artifacts-set__add::after{content:"";position:absolute;width:12px;height:12px;border:2px solid var(--megatech-artifacts-accent);pointer-events:none}
.megatech-artifacts-set__add::before{top:-1px;left:-1px;border-right:0;border-bottom:0}
.megatech-artifacts-set__add::after{bottom:-1px;right:-1px;border-left:0;border-top:0}
.megatech-artifacts-set__field{display:flex;flex-direction:column;gap:7px;min-width:0}
.megatech-artifacts-set__label{font:400 10px/1.5 var(--megatech-artifacts-mono);letter-spacing:.26em;text-transform:uppercase;color:var(--megatech-artifacts-faint)}
.megatech-artifacts-set__input{width:100%;min-width:0;padding:11px 12px;border:1px solid var(--megatech-artifacts-input-edge);background:var(--megatech-artifacts-field);font:400 14px/1.3 var(--megatech-artifacts-mono);letter-spacing:.01em}
.megatech-artifacts-set__input::placeholder{color:var(--megatech-artifacts-faint);opacity:.85}
.megatech-artifacts-set__input:hover{border-color:var(--megatech-artifacts-edge)}
.megatech-artifacts-set__input:focus{outline:none;border-color:var(--megatech-artifacts-accent);box-shadow:0 0 0 1px var(--megatech-artifacts-edge)}
.megatech-artifacts-set__input[aria-invalid="true"]{border-color:var(--megatech-artifacts-bad);box-shadow:0 0 0 1px color-mix(in srgb,var(--megatech-artifacts-bad) 35%,transparent)}
.megatech-artifacts-set__error{grid-column:1 / -1;display:flex;gap:10px;align-items:baseline;margin:0;color:var(--megatech-artifacts-bad);font:400 12px/1.55 var(--megatech-artifacts-mono);letter-spacing:.06em}
.megatech-artifacts-set__error b{font:700 11px/1 var(--megatech-artifacts-display);letter-spacing:.14em;text-transform:uppercase;padding:3px 6px;border:1px solid currentColor}

.megatech-artifacts-set__btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;border:1px solid var(--megatech-artifacts-ctl);background:transparent;color:var(--megatech-artifacts-ink);
  font:700 12px/1 var(--megatech-artifacts-display);letter-spacing:.12em;text-transform:uppercase;padding:9px 13px;transition:background .12s,border-color .12s,color .12s,box-shadow .12s}
.megatech-artifacts-set__btn:hover{background:var(--megatech-artifacts-cyan-wash);border-color:var(--megatech-artifacts-accent);color:var(--megatech-artifacts-accent)}
.megatech-artifacts-set__btn:active{background:color-mix(in srgb,var(--megatech-artifacts-cyan) 18%,transparent)}
.megatech-artifacts-set__btn--charged{padding:12px 24px;font-size:13px;background:var(--megatech-artifacts-cyan);border-color:var(--megatech-artifacts-cyan-bright);color:var(--megatech-artifacts-on-cyan)}
.megatech-artifacts-set__btn--charged:hover{background:var(--megatech-artifacts-cyan-bright);color:var(--megatech-artifacts-on-cyan);border-color:var(--megatech-artifacts-cyan-bright)}
:root:not([data-color-mode="light"]) .megatech-artifacts-set__btn--charged{box-shadow:0 0 0 1px rgba(74,234,255,.35),0 0 26px rgba(0,212,255,.42)}
.megatech-artifacts-set__btn--danger{border-color:var(--megatech-artifacts-bad-edge);color:var(--megatech-artifacts-bad)}
.megatech-artifacts-set__btn--danger:hover{background:color-mix(in srgb,var(--megatech-artifacts-bad) 12%,transparent);border-color:var(--megatech-artifacts-bad);color:var(--megatech-artifacts-bad)}
.megatech-artifacts-set__btn--danger-solid{background:var(--megatech-artifacts-bad);border-color:var(--megatech-artifacts-bad);color:#14090a}
.megatech-artifacts-set__btn--danger-solid:hover{background:var(--megatech-artifacts-bad);color:#14090a;filter:brightness(1.1)}

.megatech-artifacts-set__count{display:flex;align-items:center;gap:12px;font:400 12px/1.5 var(--megatech-artifacts-mono);letter-spacing:.16em;text-transform:uppercase;color:var(--megatech-artifacts-faint)}
.megatech-artifacts-set__count i{width:4px;height:4px;background:var(--megatech-artifacts-cyan-line);transform:rotate(45deg)}
.megatech-artifacts-set__count b{font-weight:400;color:var(--megatech-artifacts-muted)}

.megatech-artifacts-set__list{display:flex;flex-direction:column;gap:14px;margin:0;padding:0;list-style:none}
.megatech-artifacts-set__card{position:relative;display:flex;flex-direction:column;gap:9px;padding:18px 22px 16px 26px;border:1px solid var(--megatech-artifacts-line);background:var(--megatech-artifacts-ground);transition:border-color .12s,background .12s}
.megatech-artifacts-set__card::before{content:"";position:absolute;left:-1px;top:-1px;bottom:-1px;width:3px;background:transparent}
.megatech-artifacts-set__card[data-default="true"]{border-color:var(--megatech-artifacts-edge)}
.megatech-artifacts-set__card[data-default="true"]::before{background:var(--megatech-artifacts-bar)}
:root:not([data-color-mode="light"]) .megatech-artifacts-set__card[data-default="true"]::before{box-shadow:0 0 14px rgba(0,212,255,.5)}
.megatech-artifacts-set__card:hover{border-color:var(--megatech-artifacts-edge);background:linear-gradient(90deg,var(--megatech-artifacts-cyan-wash),transparent 70%),var(--megatech-artifacts-ground)}
.megatech-artifacts-set__top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-height:34px}
.megatech-artifacts-set__name{margin:0;font:700 20px/1.2 var(--megatech-artifacts-display);letter-spacing:.02em;overflow-wrap:anywhere}
.megatech-artifacts-set__url{margin:0;color:var(--megatech-artifacts-muted);word-break:break-all}
.megatech-artifacts-set__chips{display:flex;gap:8px;flex-wrap:wrap}
.megatech-artifacts-set__chip{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid;font:400 10px/1 var(--megatech-artifacts-mono);letter-spacing:.22em;text-transform:uppercase}
.megatech-artifacts-set__chip--default{color:var(--megatech-artifacts-accent);border-color:var(--megatech-artifacts-edge);background:var(--megatech-artifacts-cyan-wash)}
.megatech-artifacts-set__chip--pinned{color:var(--megatech-artifacts-pin);border-color:var(--megatech-artifacts-pin-edge)}
.megatech-artifacts-set__actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:5px;padding-top:12px;border-top:1px solid var(--megatech-artifacts-hair)}
.megatech-artifacts-set__spacer{flex:1}
.megatech-artifacts-set__confirm{display:flex;flex-wrap:wrap;align-items:center;gap:10px;width:100%;color:var(--megatech-artifacts-bad);font:400 12px/1.4 var(--megatech-artifacts-mono);letter-spacing:.14em;text-transform:uppercase}
.megatech-artifacts-set__edit{display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%}
.megatech-artifacts-set__edit .megatech-artifacts-set__input{flex:1;min-width:200px;font:700 18px/1.2 var(--megatech-artifacts-display);letter-spacing:.02em;padding:8px 12px}

.megatech-artifacts-set__empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:46px 24px 42px;text-align:center;border:1px dashed var(--megatech-artifacts-cyan-line);background:linear-gradient(180deg,var(--megatech-artifacts-cyan-wash),transparent)}
.megatech-artifacts-set__empty svg{width:56px;height:56px;color:var(--megatech-artifacts-accent)}
.megatech-artifacts-set__empty-title{margin:0;font:700 16px/1.35 var(--megatech-artifacts-display);letter-spacing:.1em;text-transform:uppercase}
.megatech-artifacts-set__empty-text{margin:0;max-width:52ch;color:var(--megatech-artifacts-muted)}
.megatech-artifacts-set__empty code{font:inherit;color:var(--megatech-artifacts-accent)}
.megatech-artifacts-set__foot{margin:0;color:var(--megatech-artifacts-faint);font:400 10px/1.6 var(--megatech-artifacts-mono);letter-spacing:.2em;text-transform:uppercase}
:root[data-color-mode="light"] .megatech-artifacts-set__btn--danger-solid,:root[data-color-mode="light"] .megatech-artifacts-set__btn--danger-solid:hover{color:#fff}
.megatech-artifacts-set__btn--small{padding:10px 18px}
/* A narrow Settings window: the add row stacks, the cards tighten, the buttons may wrap */
@container (max-width: 600px){
  .megatech-artifacts-set__add{grid-template-columns:minmax(0,1fr);padding:18px 18px 20px}
  .megatech-artifacts-set__add .megatech-artifacts-set__btn--charged{justify-self:stretch}
  .megatech-artifacts-set__spacer{display:none}
  .megatech-artifacts-set__actions .megatech-artifacts-set__btn--danger{margin-left:auto}
  .megatech-artifacts-set__edit .megatech-artifacts-set__input{min-width:0;flex-basis:100%}
}
@container (max-width: 420px){
  .megatech-artifacts-set{gap:18px}
  .megatech-artifacts-set__card{padding:14px 14px 12px 18px}
  .megatech-artifacts-set__name{font-size:18px}
  .megatech-artifacts-set__lede{max-width:none}
  .megatech-artifacts-set__btn{padding:8px 10px;letter-spacing:.08em}
}
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
    style.textContent = FONT_CSS + CSS;
    document.head.append(style);
    return () => style.remove();
  });

  function ArtifactsPage() {
    const links = useLinks();
    const defaultId = useDefaultId();
    const pinnedIds = usePinnedIds();
    const [openId, setOpenId] = React.useState(undefined);
    const chips = React.useRef(new Map()); // the chip buttons by saved id, so focus can go to one
    // Open on the default until a chip is clicked; if the chosen page is removed, fall back to the default.
    const current = links.find((link) => link.id === openId) ?? links.find((link) => link.id === defaultId);
    const body = !ctx.browser.available
      ? unavailable("these pages")
      : links.length === 0
        ? h("div", { className: "megatech-artifacts__empty" }, "No saved pages yet. Add one in Settings, in the Artifacts card.")
        : current
          ? // `key` gives each page its own browser session; the named storage keeps the sign-in.
            h(ctx.browser.View, { key: current.id, url: current.url, storage: BROWSER_STORAGE, label: displayName(current) })
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
              "aria-label": link.id === defaultId ? `${displayName(link)} (default)` : undefined,
              "data-default": link.id === defaultId ? "true" : "false",
              title: link.url,
              ref: (element) => (element ? chips.current.set(link.id, element) : chips.current.delete(link.id)),
              onClick: () => setOpenId(link.id),
            },
            displayName(link),
          ),
        ),
        current
          ? h(
              "span",
              { className: "megatech-artifacts__actions" },
              current.id !== defaultId
                ? h("button", { type: "button", className: "megatech-artifacts__chip megatech-artifacts__action", title: `Open ${displayName(current)} first each time`, onClick: () => { store.setDefault(current.id); chips.current.get(current.id)?.focus(); } }, "Make default") // this button goes once pressed: keep the focus on the page's chip
                : null,
              pinnedIds.includes(current.id)
                ? h("button", { type: "button", className: "megatech-artifacts__chip megatech-artifacts__action", title: `Take ${displayName(current)} off the top bar`, onClick: () => store.unpin(current.id) }, "Unpin")
                : // A saved id that could not make a page id (a hand-edited list) cannot be pinned, so there is no button to press.
                  pinPageId(current.id)
                  ? h("button", { type: "button", className: "megatech-artifacts__chip megatech-artifacts__action", title: `Show ${displayName(current)} in the top bar`, onClick: () => store.pin(current.id) }, "Pin to top bar")
                  : null,
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
        h("div", { className: "megatech-artifacts__view" }, ctx.browser.available ? h(ctx.browser.View, { key: link.id, url: link.url, storage: BROWSER_STORAGE, label: displayName(link) }) : unavailable(displayName(link))),
      );
    };
  }

  const PIN_MARK = "◆"; // a diamond, in the brand's second colour

  function WindowGlyph() {
    return h("svg", { viewBox: "0 0 56 56", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": "true" }, h("rect", { x: 6, y: 10, width: 44, height: 36 }), h("path", { d: "M6 20h44" }), h("path", { d: "M12 15h.01M17 15h.01M22 15h.01", strokeWidth: 3 }), h("path", { d: "M16 30h24M16 37h14", strokeOpacity: 0.55 }));
  }

  /** One saved page in the Settings card: its name and address, what it is (default, in the top bar), and what can be done to it. */
  function SavedPage({ link, isDefault, isPinned }) {
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState(link.name);
    const [confirming, setConfirming] = React.useState(false);
    const renameButton = React.useRef(null);
    const removeButton = React.useRef(null);
    // A button that was not on screen a moment ago takes the focus back once it is.
    const focusLater = (ref) => queueMicrotask(() => ref.current?.focus());
    const label = displayName(link);
    const save = (event) => {
      event.preventDefault();
      store.rename(link.id, draft);
      setEditing(false);
      focusLater(renameButton);
    };
    const cancelRename = () => {
      setDraft(link.name);
      setEditing(false);
      focusLater(renameButton);
    };
    const keep = () => {
      setConfirming(false);
      focusLater(removeButton);
    };
    // Esc leaves the editor or the question; it must not also close Settings.
    const escapeWith = (leave) => (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      leave();
    };
    return h(
      "li",
      { className: "megatech-artifacts-set__card", "data-default": isDefault ? "true" : "false", "data-pinned": isPinned ? "true" : "false" },
      editing
        ? h(
            "form",
            { className: "megatech-artifacts-set__edit", onSubmit: save, onKeyDown: escapeWith(cancelRename) },
            h("input", { className: "megatech-artifacts-set__input", value: draft, maxLength: MAX_NAME, autoFocus: true, "aria-label": `Name for ${link.url}`, onChange: (event) => setDraft(event.target.value) }),
            h("button", { type: "submit", className: "megatech-artifacts-set__btn megatech-artifacts-set__btn--charged megatech-artifacts-set__btn--small" }, "Save"),
            h("button", { type: "button", className: "megatech-artifacts-set__btn", onClick: cancelRename }, "Cancel"),
          )
        : h(
            "div",
            { className: "megatech-artifacts-set__top" },
            h("h3", { className: "megatech-artifacts-set__name" }, label),
            h(
              "div",
              { className: "megatech-artifacts-set__chips" },
              isDefault ? h("span", { className: "megatech-artifacts-set__chip megatech-artifacts-set__chip--default" }, h("span", { "aria-hidden": "true" }, "★"), "Default") : null,
              isPinned ? h("span", { className: "megatech-artifacts-set__chip megatech-artifacts-set__chip--pinned" }, h("span", { "aria-hidden": "true" }, PIN_MARK), "Top bar") : null,
            ),
          ),
      h("p", { className: "megatech-artifacts-set__url" }, link.url),
      editing
        ? null
        : confirming
          ? h(
              "div",
              { className: "megatech-artifacts-set__actions", onKeyDown: escapeWith(keep) },
              h(
                "div",
                { className: "megatech-artifacts-set__confirm", role: "group", "aria-label": `Remove ${label}?` },
                h("span", null, "Remove this page?"),
                h("button", { type: "button", className: "megatech-artifacts-set__btn megatech-artifacts-set__btn--danger-solid", onClick: () => store.remove(link.id) }, "Remove"),
                h("button", { type: "button", className: "megatech-artifacts-set__btn", autoFocus: true, onClick: keep }, "Keep"),
              ),
            )
          : h(
              "div",
              { className: "megatech-artifacts-set__actions" },
              h("button", { type: "button", ref: renameButton, className: "megatech-artifacts-set__btn", "aria-label": `Rename ${label}`, onClick: () => setEditing(true) }, "Rename"),
              isDefault ? null : h("button", { type: "button", className: "megatech-artifacts-set__btn", "aria-label": `Make default: ${label}`, onClick: () => store.setDefault(link.id) }, "Make default"),
              isPinned
                ? h("button", { type: "button", className: "megatech-artifacts-set__btn", "aria-label": `Unpin from the top bar: ${label}`, onClick: () => store.unpin(link.id) }, "Unpin")
                : // A saved id that could not make a page id (a hand-edited list) cannot be pinned, so there is no button to press.
                  pinPageId(link.id)
                  ? h("button", { type: "button", className: "megatech-artifacts-set__btn", "aria-label": `Pin to the top bar: ${label}`, onClick: () => store.pin(link.id) }, "Pin to top bar")
                  : null,
              h("span", { className: "megatech-artifacts-set__spacer" }),
              h("button", { type: "button", ref: removeButton, className: "megatech-artifacts-set__btn megatech-artifacts-set__btn--danger", "aria-label": `Remove ${label}`, onClick: () => setConfirming(true) }, "Remove"),
            ),
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
      { className: "megatech-artifacts-set" },
      h(
        "header",
        { className: "megatech-artifacts-set__head" },
        h("div", { className: "megatech-artifacts-set__eyebrow" }, "Artifacts"),
        h("h2", { className: "megatech-artifacts-set__title" }, "Saved pages"),
        h("p", { className: "megatech-artifacts-set__lede" }, "Pages you save here open in Buzz's browser, from the Artifacts entry in the sidebar or from their own entry in the top bar."),
      ),
      h(
        "form",
        { className: "megatech-artifacts-set__add", onSubmit: add, noValidate: true },
        h("label", { className: "megatech-artifacts-set__field" }, h("span", { className: "megatech-artifacts-set__label" }, "Name (optional)"), h("input", { className: "megatech-artifacts-set__input", value: name, maxLength: MAX_NAME, placeholder: "Quarterly report", onChange: (event) => setName(event.target.value) })),
        h(
          "label",
          { className: "megatech-artifacts-set__field" },
          h("span", { className: "megatech-artifacts-set__label" }, "Web address"),
          h("input", {
            className: "megatech-artifacts-set__input",
            value: address,
            placeholder: "https://claude.ai/artifact/…",
            "aria-invalid": error ? "true" : "false",
            "aria-describedby": error ? ERROR_ID : undefined,
            onChange: (event) => {
              setAddress(event.target.value);
              if (error) setError("");
            },
          }),
        ),
        h("button", { type: "submit", className: "megatech-artifacts-set__btn megatech-artifacts-set__btn--charged" }, "Add page"),
        error ? h("p", { id: ERROR_ID, className: "megatech-artifacts-set__error", role: "alert" }, h("b", null, "Not saved"), error) : null,
      ),
      links.length
        ? h(
            React.Fragment,
            null,
            h("div", { className: "megatech-artifacts-set__count", role: "status" }, h("b", null, `${links.length} saved`), h("i", { "aria-hidden": "true" }), h("span", null, `${pinnedIds.length} in the top bar`)),
            h("ul", { className: "megatech-artifacts-set__list" }, links.map((link) => h(SavedPage, { key: link.id, link, isDefault: link.id === defaultId, isPinned: pinnedIds.includes(link.id) }))),
          )
        : h("div", { className: "megatech-artifacts-set__empty" }, h(WindowGlyph), h("p", { className: "megatech-artifacts-set__empty-title" }, "No saved pages yet"), h("p", { className: "megatech-artifacts-set__empty-text" }, "Add one above. A Claude artifact link works well: ", h("code", null, "https://claude.ai/artifact/…"))),
      h("p", { className: "megatech-artifacts-set__foot" }, "Kept on this computer · never sent anywhere"),
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
    for (const link of store.list()) if (store.isPinned(link.id)) titles.set(link.id, displayName(link));
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

// The headings of the Settings card use Chakra Petch (Bold), embedded because a plugin may not load anything: its latin subset, under the SIL
// Open Font License 1.1 (notice in licenses/ and the README). Addresses and labels use the system monospace. Without the font, the heading
// stack falls back to the system's sans.
const FONT_CSS = `
@font-face{font-family:"Chakra Petch";font-style:normal;font-weight:700;font-display:swap;src:url(data:font/woff2;base64,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) format("woff2")}
`;
