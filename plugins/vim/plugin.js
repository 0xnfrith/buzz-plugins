// Vim mode for Buzz. A concept, built to learn what the plugin API reaches. Prebuilt API v1 module: no build, no imports.
//
// Every behaviour is tagged by how it reaches the app:
//   [API] the documented plugin surface (ctx.shortcuts, ctx.pages, ctx.navigation, ctx.relay, ctx.conversation).
//   [DOM] reaches into the host's markup (querySelector, focus(), a capture listener).
//         Plugins run unsandboxed in the app's own page, so this works, but it is
//         unsupported and breaks when the host's markup changes.
// NOTES.md explains what each tag means and where the API stops.
export const inject = ["react", "pages", "shortcuts", "navigation", "relay", "conversation"];

const PLUGIN_ID = "megatech.vim-mode";
const STORAGE_KEY = "megatech.vim-mode.settings.v2";
// v1 saved all three switches on any change, so its composerNormal=false cannot be told from a
// choice. v2 saves only what the user switched. A v1 record still supplies the other two.
const OLD_STORAGE_KEY = "megatech.vim-mode.settings.v1";
const SETTING_KEYS = ["enabled", "statusLine", "composerNormal", "leader", "perf"];
const PERF_LEVELS = [{ id: "", label: "Off" }, { id: "paint", label: "Key to paint" }, { id: "full", label: "Full (every handler and DOM call)" }];
const PENDING_MS = 1500;
// The leader key is a prefix for pane commands that work from anywhere, even in the message box,
// where every plain key is a text command. A chord (Ctrl-...) also works while typing; a plain key
// (Space, comma) only outside INSERT. The Vim mode page offers these; the default is Space, or
// Ctrl-w on a Mac, where the host does not use it (on Windows and Linux it closes the tab).
const LEADERS = {
  space: { label: "Space", key: " " },
  "ctrl-w": { label: "Ctrl-w", key: "w", ctrl: true, mac: true },
  "ctrl-b": { label: "Ctrl-b", key: "b", ctrl: true },
  "ctrl-space": { label: "Ctrl-Space", key: " ", ctrl: true },
  comma: { label: "Comma ( , )", key: ",", show: "," },
  backslash: { label: "Backslash ( \\ )", key: "\\", show: "\\" },
};
// Colours come from the host's own theme tokens ([DOM]: custom properties on <html>, set from
// Settings → Appearance), so they follow the accent colour and light or dark mode live. The fallback
// is only for a host that stops defining the token. See "Theme" in plugins/vim/NOTES.md for the list.
const ACCENT = "var(--accent-9, #e5a50a)"; // the accent's strong fill
const FOCUS_RING = "var(--border-focus, #1d1d1f)"; // on the channel list: the selected row is itself an accent fill
const mix = (colour, percent) => `color-mix(in srgb, ${colour} ${percent}%, transparent)`;

// Hooks into the host's Channels markup. All of these are [DOM] and found by reading the source.
const MAIN = "[data-main-workspace], [data-solo-focus-pane]";
const SIDE = "[data-panel-workspace]";
const SIDEBAR_ROW = "[data-sidebar-section] button[data-channel-id]";
const SCROLLER = "[data-message-scroller]";
const MESSAGE = "[data-message-id]";
const COMPOSER = '[data-tab-focus]:is([role="textbox"], input, textarea)';
const NOT_WRITABLE =
  '[aria-disabled="true"], [disabled], [readonly], [contenteditable="false"]';
// A key typed here belongs to a menu or dialog, not to us.
const POPUP = '[role="menu"], [role="listbox"], [role="combobox"], [role="dialog"], [aria-modal="true"], .xterm';
// The community switcher and the message action bar, both [DOM] and read from the source.
const COMMUNITY_TRIGGER = 'nav[aria-label="Communities"] button[aria-label^="Community switcher"]';
const COMMUNITY_POPUP = '[role="dialog"][aria-label="Switch community"]';
// The thread pane's split handle (a focusable ARIA separator) and the button that hides or shows the pane.
const PANE_HANDLE = 'hr[aria-label="Resize main and secondary panels"]';
const PANE_TOGGLE = "[data-tab-pane-toggle]";

// ---- Performance trace ---------------------------------------------------------------------------
// Off by default (a select on the Vim mode page). Two levels:
//   paint  for every key, the time from the keydown reaching the window to the frame after it (a message
//          posted after requestAnimationFrame arrives once the frame is on screen), and the page's event-loop
//          lag once a second
//   full   also the time spent in each of the plugin's own handlers (inclusive of the handlers they call),
//          how often each called querySelectorAll, closest, getBoundingClientRect, getClientRects and
//          Selection.modify (the page's own calls are counted apart), and named event counters
// Ctrl+Alt+Shift+P copies the numbers as JSON to the clipboard, Ctrl+Alt+Shift+R starts over; window.__vimPerf
// has the same for a test. Nothing is kept, sent or written anywhere else.
function makePerf(doc) {
  const win = doc.defaultView;
  const RING = 5000;
  const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);
  const APIS = [
    ["Element", "querySelectorAll"],
    ["Document", "querySelectorAll"],
    ["Element", "closest"],
    ["Element", "getBoundingClientRect"],
    ["Element", "getClientRects"],
    ["Selection", "modify"],
    ["Selection", "toString"],
    ["Element", "scrollIntoView"],
    ["HTMLElement", "focus"],
  ];
  let level = "";
  let current = ""; // the plugin handler running now, for attributing DOM calls
  let cleanup = [];
  let paint = []; // [key, ms]
  let lag = [];
  let handlers = {}; // name -> { n, ms, max, api: { Element.closest: n } }
  let counters = {};
  let host = {}; // DOM calls made outside any plugin handler
  const keep = (list, entry) => {
    list.push(entry);
    if (list.length > RING) list.shift();
  };
  const round = (x) => Math.round(x * 100) / 100;
  const stat = (name) => (handlers[name] ??= { n: 0, ms: 0, max: 0, api: {}, apiMs: {} });
  const hostMs = {};
  // A function that reports how long it ran and which DOM calls it made, when the level is "full".
  const timed = (name, fn) =>
    function (...args) {
      if (level !== "full") return fn.apply(this, args);
      const outer = current;
      current = name;
      const t0 = performance.now();
      try {
        return fn.apply(this, args);
      } finally {
        const ms = performance.now() - t0;
        current = outer;
        const entry = stat(name);
        entry.n++;
        entry.ms += ms;
        if (ms > entry.max) entry.max = ms;
      }
    };
  const count = (name, n = 1) => {
    if (level) counters[name] = (counters[name] ?? 0) + n;
  };
  const quantiles = (values) => {
    if (!values.length) return { n: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    return { n: sorted.length, median: round(at(0.5)), p95: round(at(0.95)), max: round(sorted.at(-1)), mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length) };
  };
  // What the page holds right now, so two dumps minutes apart show whether the page itself grows (not the plugin).
  const pageCounts = () => ({
    nodes: doc.getElementsByTagName("*").length,
    messageRows: doc.querySelectorAll(MESSAGE).length,
    images: doc.images.length,
    styleSheets: doc.styleSheets.length,
    iframes: doc.querySelectorAll("iframe").length,
    canvases: doc.querySelectorAll("canvas").length,
    media: doc.querySelectorAll("video, audio").length,
    threadTabs: doc.querySelectorAll('[data-panel-workspace] [role="tab"]').length,
    jsHeapMB: win.performance.memory ? round(win.performance.memory.usedJSHeapSize / 1048576) : null, // Chromium only
  });
  const summary = () => {
    const byKey = {};
    for (const [key, ms] of paint) (byKey[key] ??= []).push(ms);
    return {
      level,
      at: new Date().toISOString(),
      agent: navigator.userAgent,
      paint: quantiles(paint.map(([, ms]) => ms)),
      paintByKey: Object.fromEntries(Object.entries(byKey).map(([key, list]) => [key, quantiles(list)])),
      lag: quantiles(lag),
      handlers: Object.fromEntries(
        Object.entries(handlers)
          .sort((a, b) => b[1].ms - a[1].ms)
          .map(([name, h]) => [
            name,
            { n: h.n, ms: round(h.ms), max: round(h.max), api: h.api, apiMs: Object.fromEntries(Object.entries(h.apiMs).map(([label, ms]) => [label, round(ms)])) },
          ]),
      ),
      revisions: window.__vimRevisions,
      page: pageCounts(),
      host,
      hostMs: Object.fromEntries(Object.entries(hostMs).map(([label, ms]) => [label, round(ms)])),
      counters,
      samples: paint,
    };
  };
  const reset = () => {
    paint = [];
    lag = [];
    handlers = {};
    counters = {};
    host = {};
    for (const label of Object.keys(hostMs)) delete hostMs[label];
  };
  const copyText = (text) => {
    // A hidden text box holds the selection a copy command needs (the page's own selection may be empty).
    const box = doc.createElement("textarea");
    box.value = text;
    Object.assign(box.style, { position: "fixed", left: "-9999px", top: "0" });
    doc.body.append(box);
    const was = doc.activeElement;
    box.select();
    let ok = false;
    try {
      ok = doc.execCommand("copy");
    } catch {}
    box.remove();
    was?.focus?.({ preventScroll: true });
    return ok;
  };
  const dump = () => {
    const text = JSON.stringify(summary());
    copyText(text);
    return text;
  };
  const stop = () => {
    for (const undo of cleanup.splice(0)) undo();
    delete win.__vimPerf;
    level = "";
  };
  const start = (next) => {
    stop();
    if (!next) return;
    level = next;
    const onKey = (event) => {
      if (MODIFIERS.has(event.key)) return;
      const t0 = performance.now();
      win.requestAnimationFrame(() => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          keep(paint, [event.key, round(performance.now() - t0)]);
          channel.port1.close();
        };
        channel.port2.postMessage(0);
      });
    };
    win.addEventListener("keydown", onKey, true);
    cleanup.push(() => win.removeEventListener("keydown", onKey, true));
    const onChord = (event) => {
      if (!event.ctrlKey || !event.altKey || !event.shiftKey) return;
      if (event.code === "KeyP") dump();
      else if (event.code === "KeyR") reset();
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    doc.addEventListener("keydown", onChord, true);
    cleanup.push(() => doc.removeEventListener("keydown", onChord, true));
    let last = performance.now();
    const tick = setInterval(() => {
      const now = performance.now();
      keep(lag, round(now - last - 1000));
      last = now;
    }, 1000);
    cleanup.push(() => clearInterval(tick));
    if (next === "full") {
      for (const [owner, name] of APIS) {
        const proto = win[owner].prototype;
        const original = proto[name];
        const label = `${owner}.${name}`;
        const wrapper = function (...args) {
          const entry = current ? stat(current) : undefined;
          const bucket = entry ? entry.api : host;
          const times = entry ? entry.apiMs : hostMs;
          bucket[label] = (bucket[label] ?? 0) + 1;
          const t0 = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            times[label] = (times[label] ?? 0) + (performance.now() - t0);
          }
        };
        proto[name] = wrapper;
        cleanup.push(() => {
          if (proto[name] === wrapper) proto[name] = original;
        });
      }
    }
    win.__vimPerf = { dump: () => JSON.parse(dump()), summary, reset, level: () => level };
  };
  return { timed, count, start, stop, active: () => level !== "" };
}

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const doc = document;
  const apple = /Mac|iPhone|iPad/.test(navigator.platform);
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  let disposed = false;

  // ---- State: one immutable snapshot, replaced on every change ----------------------------
  const read = (key, names) => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "{}");
      const valid = (name) =>
        name === "leader"
          ? Object.hasOwn(LEADERS, saved.leader)
          : name === "perf"
            ? PERF_LEVELS.some((entry) => entry.id === saved.perf)
            : typeof saved[name] === "boolean";
      return Object.fromEntries(names.filter(valid).map((name) => [name, saved[name]]));
    } catch {
      return {};
    }
  };
  const load = () => ({
    ...read(OLD_STORAGE_KEY, ["enabled", "statusLine"]),
    ...read(STORAGE_KEY, SETTING_KEYS),
  });
  let state = Object.freeze({
    enabled: true, // master switch for every key below
    statusLine: true, // the -- NORMAL -- overlay
    composerNormal: true, // a normal mode (and visual mode) inside the message box; the page can switch it off
    mode: "normal", // "insert" exactly while an editable has focus (and text mode allows it)
    textMode: "insert", // inside the message box: "insert" or "normal" (only when composerNormal)
    visual: "", // inside the message box, in text normal mode: "" or "char" (v) or "line" (V)
    region: "main", // "sidebar" | "main" | "side": where j/k act
    count: 0, // pending numeric prefix
    operator: "", // pending "g", "z" (outside the message box), "d" (inside it) or "leader" (anywhere)
    prefix: "", // inside the message box: a pending "g", or the f t F T waiting for its character
    leader: apple ? "ctrl-w" : "space", // a key of LEADERS
    perf: "", // the performance trace: "", "paint" or "full" (see makePerf)
    ...load(),
  });
  const listeners = new Set();
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const perf = makePerf(doc);
  const set = (patch) => {
    if (perf.active()) {
      perf.count("set");
      if (Object.keys(patch).every((name) => state[name] === patch[name])) perf.count("set, nothing changed");
      perf.count("set, listeners called", listeners.size);
    }
    state = Object.freeze({ ...state, ...patch });
    for (const listener of [...listeners]) listener();
  };
  const setting = (patch) => {
    set(patch);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...read(STORAGE_KEY, SETTING_KEYS), ...patch }),
      );
    } catch {}
  };

  // Pending count/operator expire like vim's timeoutlen, so a stray "g" cannot linger.
  let pendingTimer;
  const armPending = () => {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(clearPending, PENDING_MS);
  };
  function clearPending() {
    clearTimeout(pendingTimer);
    if (state.count || state.operator || state.prefix) set({ count: 0, operator: "", prefix: "" });
  }
  const takeCount = () => {
    const n = Math.max(1, state.count);
    clearPending();
    return n;
  };

  // ---- DOM helpers [DOM] ------------------------------------------------------------------
  const visible = (el) =>
    !!el &&
    el.getClientRects().length > 0 &&
    !el.closest('[hidden], [inert], [aria-hidden="true"]');
  // Same test the host's dispatcher uses to refuse plain keys.
  const isEditable = (el) =>
    !!el &&
    (el.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
      el.getAttribute?.("role") === "textbox");
  const inComposer = (el) => !!el?.closest?.("[data-tab-focus]");
  const regionOf = (el) =>
    !el?.closest
      ? undefined
      : el.closest("[data-sidebar-section], [data-channel-sidebar-row]")
        ? "sidebar"
        : el.closest(SIDE)
          ? "side"
          : el.closest(MAIN)
            ? "main"
            : undefined;
  const workspaces = (region) =>
    [...doc.querySelectorAll(region === "side" ? SIDE : MAIN)].filter(visible);
  const timelineOf = (region) => {
    for (const workspace of workspaces(region)) {
      const scroller = [...workspace.querySelectorAll(SCROLLER)].find(visible);
      if (scroller) return scroller;
    }
    // Fallback if the workspace markers drift: any visible timeline counts as main.
    return region === "side"
      ? undefined
      : [...doc.querySelectorAll(SCROLLER)].find(visible);
  };
  const activeTimeline = () =>
    timelineOf(state.region === "side" ? "side" : "main") ?? timelineOf("main");
  // The pane's visible, writable message box. A pane with several thread tabs keeps every tab's box
  // in the page (the others inert), so the first one in the markup is often a hidden tab's: look
  // through them all for the one that shows.
  const composerOf = (region) => {
    for (const workspace of workspaces(region === "side" ? "side" : "main")) {
      const composer = [...workspace.querySelectorAll(COMPOSER)].find(
        (box) => visible(box) && !box.matches(NOT_WRITABLE),
      );
      if (composer) return composer;
    }
  };
  const channelRows = () => [...doc.querySelectorAll(SIDEBAR_ROW)].filter(visible);
  const selectedRow = () =>
    channelRows().find((row) => row.getAttribute("aria-current") === "page");
  // A membership row ("You were added by ...") carries a message id but is not a message: it has
  // no action bar and no thread, so the cursor never rests on it.
  let rowsOf = (scroller) =>
    [...scroller.querySelectorAll(MESSAGE)].filter(
      (row) => !row.hasAttribute("data-membership-row") && !row.parentElement.closest(MESSAGE) && visible(row),
    );
  const inView = (scroller, row) => {
    const box = scroller.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    return rect.bottom > box.top && rect.top < box.bottom;
  };
  const afterLayout = (fn) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!disposed) fn();
      }),
    );
  const focusEl = (el) => {
    if (!el) return false;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: "nearest" });
    return doc.activeElement === el;
  };
  // We are not inside a menu or dialog. Pages without a conversation count: gt and { must be
  // able to leave them.
  const contextOk = () => !doc.activeElement?.closest?.(POPUP);

  // ---- Mode follows focus [DOM] -----------------------------------------------------------
  // The host's dispatcher already refuses plain keys while an editable has focus, so "insert
  // mode" is simply "an editable is focused" and "normal mode" is everything else. Esc blurs,
  // `i` focuses the composer. The flag only drives the indicator.
  let syncFocus = () => {
    if (disposed) return; // a timer that outlived the plugin must not touch the page again
    const el = doc.activeElement;
    set({
      mode: isEditable(el) && state.textMode === "insert" ? "insert" : "normal",
      visual: isEditable(el) ? state.visual : "",
      region: regionOf(el) ?? state.region,
    });
  };
  const onFocusIn = (event) => {
    if (isEditable(event.target)) state = Object.freeze({ ...state, textMode: "insert", visual: "" });
    syncFocus();
  };
  const onFocusOut = () => setTimeout(syncFocus, 0);

  // ---- Message cursor [DOM] ---------------------------------------------------------------
  // The host has no "selected message", so the cursor is a CSS rule keyed by message id. A rule
  // survives the virtual list unmounting and remounting the row. Each message pane (the channel's
  // list and a thread's list) keeps its own cursor row: the pane that has the keys shows it
  // strongly, the other shows where it was left, faintly, and an accent line under the pane's
  // header says which pane is active whenever two are on screen.
  const cursors = { main: undefined, side: undefined };
  const cursorPane = () => (state.region === "side" ? "side" : "main");
  const cursorStyle = doc.createElement("style");
  cursorStyle.setAttribute("data-vim-cursor-style", "");
  // The channel list has real focus, so only a ring is needed; mark it while that region is active.
  // While the plugin drives the community switcher, its popover is hidden so it does not flash.
  const FOCUS_CSS =
    `html[data-vim-region="sidebar"] ${SIDEBAR_ROW}:focus{outline:2px solid ${FOCUS_RING};outline-offset:-2px}` +
    `html[data-vim-driving] ${COMMUNITY_POPUP}{opacity:0!important;transition:none!important;animation:none!important}`;
  // Put text before and after every part of a selector list.
  const around = (list, before, after = "") =>
    list
      .split(",")
      .map((part) => `${before}${part.trim()}${after}`)
      .join(",");
  const PANES = [["main", MAIN], ["side", SIDE]];
  // The active pane's header gets a 2px accent line along its bottom edge, the full width of the
  // pane. It is the header's own ::after (the host draws its 1px separator there, inset from the
  // sides), restyled, so nothing is added to the page. A frame drawn on the pane's outer box was
  // tried first: the message list inside scrolls in a layer of its own that paints over it, so
  // below the header only the corners survived. The line shows only with a thread pane beside the
  // channel (data-vim-panes): a lone pane is trivially the active one.
  const PANE_HEADER = { main: "[data-main-workspace] > header", side: "[data-panel-workspace] > header" };
  const LINE_CSS = PANES.map(
    ([pane]) =>
      `html[data-vim-on][data-vim-panes][data-vim-region="${pane}"] ${PANE_HEADER[pane]}::after` +
      `{inset-inline:0;height:2px;background:${ACCENT}}`,
  ).join("");
  // The cursor row is marked on its message bubble, not on the row: the bubble goes up a step in brightness
  // (the host's own hover treatment, `--affordance-backdrop-pressed`, laid over whatever fill the bubble has,
  // so it works for received and own bubbles, in light and dark mode, with every accent) and gets a thin
  // accent outline. The row itself keeps no tint and no bar. The bubble is the element that carries
  // `data-message-action-anchor` inside the row's `[data-bubble]` content (the host's class names are hashed).
  // A row with no bubble (a picture, a card, a huddle) gets the outline round the whole message instead.
  // The pane that has the keys shows it strongly; the other pane shows where it was left, outline only, faint.
  const BUBBLE = "[data-bubble] [data-message-action-anchor]:not([data-solo-cards])";
  const LIFT = "var(--affordance-backdrop-pressed, #80808040)";
  const MARK_ACTIVE = {
    bubble: `background-image:linear-gradient(${LIFT},${LIFT});outline:2px solid ${ACCENT}`,
    bare: `outline:2px solid ${ACCENT};outline-offset:-2px;border-radius:14px`,
  };
  const MARK_RESTING = {
    bubble: `outline:1px solid ${mix(ACCENT, 45)}`,
    bare: `outline:1px solid ${mix(ACCENT, 45)};outline-offset:-1px;border-radius:14px`,
  };
  // While a message box has the keys (INSERT, or NORMAL in the box) the focus is in the box, not on the message above
  // it: that pane's cursor row steps back like the other pane's (its place is kept, as an outline, with no lift),
  // and the box takes a much fainter version of the same lift, so it is clear where the keys are.
  const BOX_LIFT = mix(LIFT, 40);
  const BOX_FOCUS_CSS = `html[data-vim-on] form:has(${COMPOSER}:focus){background-image:linear-gradient(${BOX_LIFT},${BOX_LIFT})}`;
  const boxHasKeys = () => isEditable(doc.activeElement) && inComposer(doc.activeElement);
  let painted = "";
  let paintCursor = () => {
    const here = cursorPane();
    const inBox = boxHasKeys();
    // The cursors, for the tests to read. Written only when they change: this runs on a timer too.
    const publish = (name, value) => cursorStyle.dataset[name] !== value && (cursorStyle.dataset[name] = value);
    publish("messageId", cursors[here] ?? ""); // the active pane's cursor
    publish("mainMessageId", cursors.main ?? "");
    publish("sideMessageId", cursors.side ?? "");
    const rows = PANES.map(([pane, scope]) => {
      if (!cursors[pane]) return "";
      const row = `[data-message-id="${CSS.escape(cursors[pane])}"]`;
      const mark = pane === here && !inBox ? MARK_ACTIVE : MARK_RESTING;
      return (
        `${around(scope, "", ` ${row} ${BUBBLE}`)}{${mark.bubble}}` +
        `${around(scope, "", ` ${row}:not(:has([data-bubble])) > [data-layout]`)}{${mark.bare}}`
      );
    }).join("");
    const css = FOCUS_CSS + LINE_CSS + BOX_FOCUS_CSS + rows;
    if (css !== painted) {
      perf.count("cursor <style> rewritten");
      cursorStyle.textContent = painted = css;
    }
  };
  const clearCursors = () => {
    cursors.main = cursors.side = undefined;
    paintCursor();
  };
  const selectRow = (row) => {
    cursors[row.closest(SIDE) ? "side" : "main"] = row.dataset.messageId;
    paintCursor();
    row.scrollIntoView({ block: "nearest" });
  };
  const nearestVisible = (scroller, fromEnd) => {
    const rows = rowsOf(scroller).filter((row) => inView(scroller, row));
    return fromEnd ? rows.at(-1) : rows[0];
  };
  const atBottom = (scroller) => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
  let moveCursor = (steps) => {
    const scroller = activeTimeline();
    if (!scroller) return;
    const rows = rowsOf(scroller);
    if (!rows.length) {
      // A pane with no messages has only its box.
      if (steps > 0) enterBox(cursorPane(), "start");
      return;
    }
    const at = rows.findIndex((row) => row.dataset.messageId === cursors[cursorPane()]);
    if (at < 0) {
      // First press only places the cursor: newest visible message going up, oldest going down.
      const row = nearestVisible(scroller, steps < 0);
      if (row) selectRow(row);
      return;
    }
    const target = clamp(at + steps, 0, rows.length - 1);
    if (target === at) {
      // Past the newest message is the pane's message box: one column, messages then box.
      if (steps > 0 && atBottom(scroller) && enterBox(cursorPane(), "start")) return;
      // End of the mounted window: scroll so the virtual list mounts more rows (and, at the
      // top, loads older history). The next press moves on.
      scroller.scrollBy({ top: Math.sign(steps) * scroller.clientHeight * 0.5 });
      return;
    }
    selectRow(rows[target]);
  };
  const jumpEdge = (end) => {
    if (state.region === "sidebar") {
      const rows = channelRows();
      focusEl(end ? rows.at(-1) : rows[0]);
      return;
    }
    const scroller = activeTimeline();
    if (!scroller) return;
    scroller.scrollTop = end ? scroller.scrollHeight : 0;
    afterLayout(() => {
      const row = nearestVisible(scroller, end);
      if (row) selectRow(row);
    });
  };
  const halfPage = (direction) => {
    const scroller = activeTimeline();
    if (!scroller) return;
    scroller.scrollBy({ top: (direction * scroller.clientHeight) / 2 });
    afterLayout(() => {
      const current = rowsOf(scroller).find((row) => row.dataset.messageId === cursors[cursorPane()]);
      if (current && inView(scroller, current)) return;
      const row = nearestVisible(scroller, direction < 0);
      if (row) selectRow(row);
    });
  };

  // ---- Moving focus between regions [DOM] -------------------------------------------------
  // [API] Open a channel through ctx.navigation, asking the host not to move focus into the
  // message box. Clicking the sidebar row does the same job but the host then focuses the
  // composer, which would throw a vim user into insert mode. Resolves true once it opened.
  const openChannel = async (row) => {
    const { status, viewer, origin } = ctx.relay.snapshot();
    if (status === "ready" && viewer && origin) {
      try {
        const result = await ctx.navigation.open(
          {
            version: 1,
            kind: "conversation",
            scope: { viewer, communityOrigin: origin },
            channelId: row.dataset.channelId,
          },
          { focus: "preserve" },
        );
        if (result.status === "opened") return true;
      } catch {}
    }
    row.click(); // what a pointer does; the host may move focus
    return false;
  };
  const REGIONS = ["sidebar", "main", "side"];
  const available = (region) =>
    region === "sidebar" ? channelRows().length > 0 : !!timelineOf(region);
  // Moving into a message pane marks a row in it: the row it already had, else the oldest row on
  // screen in a thread and the newest in the channel. Without this the pane you arrive in would
  // show nothing at all until the first j or k.
  const ensureCursor = async (pane) => {
    if (cursors[pane]) return;
    const row = await settle(() => {
      const scroller = timelineOf(pane);
      return scroller && nearestVisible(scroller, pane === "main");
    }, 1000);
    if (row && !cursors[pane] && !disposed) selectRow(row);
  };
  const goRegion = (region) => {
    const was = doc.activeElement;
    if (isEditable(was) && inComposer(was)) {
      // Leaving the box by this route too: no selection may stay in it (see leaveBox).
      doc.getSelection()?.removeAllRanges();
      set({ textMode: "insert", visual: "" });
    }
    if (region === "sidebar") {
      const rows = channelRows();
      focusEl(rows.includes(doc.activeElement) ? doc.activeElement : (selectedRow() ?? rows[0]));
    } else focusEl(timelineOf(region));
    set({ region });
    if (region !== "sidebar") void ensureCursor(region);
  };
  const shiftRegion = (direction) => {
    const order = REGIONS.filter(available);
    // A region that has gone away (a closed thread) counts as the message list.
    const from = order.includes(state.region) ? order.indexOf(state.region) : order.indexOf("main");
    const next = order[clamp(from + direction, 0, order.length - 1)];
    if (!next || next === state.region) {
      // `h` at the left edge goes one further left: the community switcher.
      if (direction < 0 && from <= 0) void openCommunityPicker();
      return;
    }
    const row = doc.activeElement;
    // Leaving the sidebar with `l` opens the focused channel, like Enter would.
    if (state.region === "sidebar" && direction > 0 && row?.matches?.(SIDEBAR_ROW)) {
      const opened =
        row.getAttribute("aria-current") === "page" ? Promise.resolve() : openChannel(row);
      // The new channel's timeline mounts once navigation settles.
      void opened.then(() => afterLayout(() => goRegion("main")));
      return;
    }
    goRegion(next);
  };
  const moveSidebar = (steps) => {
    const rows = channelRows();
    if (!rows.length) return;
    const base = rows.includes(doc.activeElement)
      ? rows.indexOf(doc.activeElement)
      : rows.indexOf(selectedRow());
    focusEl(rows[clamp(base < 0 ? 0 : base + steps, 0, rows.length - 1)]);
    set({ region: "sidebar" });
  };
  const step = (direction) => {
    const n = takeCount() * direction;
    if (state.region === "sidebar") moveSidebar(n);
    else moveCursor(n);
  };
  // ]/[ switch channel without leaving the message list.
  const switchChannel = (direction) => {
    const rows = channelRows();
    const at = rows.indexOf(selectedRow());
    const row = rows[clamp(at + direction * takeCount(), 0, rows.length - 1)];
    if (!row || row === rows[at]) return;
    clearCursors();
    void openChannel(row).then(() => afterLayout(() => state.region === "main" && goRegion("main")));
  };

  // ---- Communities [DOM] ------------------------------------------------------------------
  // No plugin service reaches communities (nothing in the API lists, selects or switches them),
  // so the plugin drives the host's own switcher the way a pointer would: click the trigger,
  // read the rows, click one. While it does, CSS hides the popover so it does not flash.
  const settle = (probe, ms = 1500) =>
    new Promise((resolve) => {
      const started = performance.now();
      const tick = () => {
        const found = disposed ? undefined : probe();
        if (found || disposed || performance.now() - started > ms) resolve(found || undefined);
        else requestAnimationFrame(tick);
      };
      tick();
    });
  const communityTrigger = () => doc.querySelector(COMMUNITY_TRIGGER);
  const communityPopup = () => [...doc.querySelectorAll(COMMUNITY_POPUP)].find(visible);
  const communityRows = (popup) =>
    [...popup.querySelectorAll("button:not([disabled])")].filter(
      (row) => row.matches('[aria-label^="Switch to "]') || row.textContent.trim() === "Personal space",
    );
  // Opens the switcher and puts focus on the current community. The host's own keys then work
  // in it (arrows, Home, End, Enter, Esc) and so do j and k (see onMenuKey).
  async function openCommunityPicker() {
    const trigger = communityTrigger();
    if (!trigger) return;
    if (!communityPopup()) trigger.click();
    const popup = await settle(communityPopup);
    const rows = popup ? communityRows(popup) : [];
    focusEl(rows.find((row) => row.hasAttribute("aria-current")) ?? rows[0]);
  }
  let switching = false;
  // Counts key presses, so a landing that finishes late can tell the user has moved on.
  let keyEpoch = 0;
  const onAnyKey = () => void keyEpoch++;
  // `}` and `{` move through Personal space and the communities, in the switcher's own order.
  const switchCommunity = async (direction) => {
    const steps = takeCount() * direction;
    const trigger = communityTrigger();
    if (!trigger || switching) return;
    switching = true;
    const root = doc.documentElement;
    root.dataset.vimDriving = "";
    const region = state.region;
    const before = trigger.getAttribute("aria-label");
    const oldRows = new Set(channelRows());
    let switched = false;
    try {
      if (!communityPopup()) trigger.click();
      const popup = await settle(communityPopup);
      const rows = popup ? communityRows(popup) : [];
      const at = rows.findIndex((row) => row.hasAttribute("aria-current"));
      const target = rows[clamp(at + steps, 0, rows.length - 1)];
      if (at < 0 || !target || target === rows[at]) {
        // Already at the end of the list: put the popover away and keep the user where they were.
        if (popup) trigger.click();
        await settle(() => !communityPopup());
        if (available(region)) goRegion(region);
        return;
      }
      target.click();
      await settle(() => !communityPopup() && communityTrigger()?.getAttribute("aria-label") !== before);
      clearCursors();
      switched = true;
    } finally {
      delete root.dataset.vimDriving;
      switching = false;
    }
    if (!switched) return;
    // The new community loads its channels a moment later; land in the channel list, unless a
    // key press says the user has already gone somewhere else. The host focuses the message box
    // on its own after a switch, which is why this does not wait for a quiet focus.
    const epoch = keyEpoch;
    const loaded = await settle(() => {
      const first = channelRows()[0];
      return first && !oldRows.has(first);
    }, 5000);
    if (loaded && keyEpoch === epoch) goRegion("sidebar");
  };

  // ---- Pages [API] ------------------------------------------------------------------------
  // The pages service lists every primary page and navigation.open opens one. What the API does
  // not give is the order the app shows them in: that is shell policy (AppShell.tsx and
  // presentation.ts), copied here so gt walks the pages left to right, top bar first.
  const TOPBAR = ["buzz.channels/channels", "buzz.reminders/reminders", "buzz.agents/agents", "buzz.workflows/workflows"];
  const BUNDLED_ORDER = ["buzz.channels/channels", "buzz.inbox/inbox", "buzz.reminders/reminders", "buzz.bestie/bestie"];
  const MESSAGES = "buzz.channels/channels";
  const pageName = (page) => (page.key === MESSAGES ? "Messages" : page.title);
  const pageRank = (page) => {
    const slot = BUNDLED_ORDER.indexOf(page.key);
    return slot < 0 ? BUNDLED_ORDER.length : slot;
  };
  const byShell = (a, b) =>
    pageRank(a) - pageRank(b) || pageName(a).localeCompare(pageName(b), "en") || a.key.localeCompare(b.key, "en");
  const pageList = () => {
    const pages = ctx.pages.snapshot().filter((page) => page.primary);
    const top = (page) => TOPBAR.includes(page.key) || page.placement === "topbar";
    return [...pages.filter(top).sort(byShell), ...pages.filter((page) => !top(page)).sort(byShell)];
  };
  const openPage = (page) =>
    void ctx.navigation
      .open({ version: 1, kind: "page", pluginId: page.pluginId, pageId: page.id }, { focus: "preserve" })
      .catch(() => {});
  const cyclePage = (direction) => {
    const pages = pageList();
    if (!pages.length) return;
    const target = ctx.navigation.snapshot().entry?.target;
    // A conversation belongs to the Messages page.
    const key = target?.kind === "page" ? `${target.pluginId}/${target.pageId}` : target?.kind === "conversation" ? MESSAGES : "";
    const here = pages.findIndex((page) => page.key === key);
    const at = here < 0 ? (direction > 0 ? -1 : 0) : here;
    openPage(pages[(at + direction + pages.length) % pages.length]);
  };
  // [API] Settings is a navigation target, not a page. Like the host's own Cmd/Ctrl+, it opens
  // for the community on screen (scope null when there is none, which is Personal space).
  const openSettings = () => {
    const { status, viewer, origin } = ctx.relay.snapshot();
    const scope = status === "ready" && viewer && origin ? { viewer, communityOrigin: origin } : null;
    void ctx.navigation.open({ version: 1, kind: "settings", scope }).catch(() => {});
  };
  // The letter after a `g`: t and T walk the pages, s opens Settings, any other letter picks the page
  // whose name starts with it (gi Inbox, gm Messages). Both the lists (through the shortcut service) and
  // the message box's NORMAL mode (its own key handler) come here: one NORMAL mode, one set of g keys.
  const goPage = (letter) => {
    clearPending();
    if (letter === "t" || letter === "T") return cyclePage(letter === "t" ? 1 : -1);
    if (letter === "s") return openSettings();
    const page = pageList().find((entry) => pageName(entry).toLowerCase().startsWith(letter));
    if (page) openPage(page);
  };
  // The letters the message box takes after a g (the others are its own gg, ge and gE).
  const PAGE_KEYS = "imarwvtTs";
  // Keys already bound for something else call this first when `g` is pending.
  const afterG = (letter, run) => () => (state.operator === "g" ? goPage(letter) : run());

  // ---- Message actions [DOM] --------------------------------------------------------------
  // The host builds a row's action bar lazily: when the pointer enters the row, focus lands in
  // it, or Tab is pressed. A Tab keydown on window is the host's own "a keyboard user is here"
  // signal for every row at once. It moves no focus, so the plugin sends one, then clicks the
  // control the way a pointer would.
  const cursorRow = () => {
    const scroller = activeTimeline();
    const id = cursors[cursorPane()];
    return scroller && id ? rowsOf(scroller).find((row) => row.dataset.messageId === id) : undefined;
  };
  const rowControl = async (label) => {
    // Pin the message now: a request made without a cursor, or before the cursor moved on,
    // must not fire later on whatever message the cursor reaches.
    const id = cursorRow()?.dataset.messageId;
    if (!id) return;
    const find = () => {
      const row = cursorRow();
      return row?.dataset.messageId === id
        ? row.querySelector(`[aria-label="Message actions"] button[aria-label="${label}"]`)
        : undefined;
    };
    if (!find())
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    const control = await settle(find, 800);
    if (control && !control.disabled) control.click();
  };

  // ---- Threads and the thread pane [API + DOM] -------------------------------------------
  // Opening is API: the relay read model says which thread a message belongs to, and
  // navigation.open opens it where the user's thread placement setting puts threads (a pane
  // beside the channel, or a tab over it). Everything else is DOM, because no service reaches a
  // pane's focus, its tabs or its width: landing in the pane, closing a thread, hiding the pane
  // and resizing it all drive the host's own controls the way a pointer or its keyboard would.
  const threadRootOf = (messageId) => {
    try {
      const channelId = currentChannelId();
      const rows = channelId ? ctx.relay.snapshot().session.channels.window(channelId).rows : [];
      return rows.find((row) => row.id === messageId)?.threadRootId ?? messageId;
    } catch {
      return messageId;
    }
  };
  const openThread = async () => {
    clearPending();
    // Pin the message now, as rowControl does. Only the message list has a cursor to open.
    const messageId = state.region === "main" ? cursorRow()?.dataset.messageId : undefined;
    const channelId = currentChannelId();
    const { status, viewer, origin } = ctx.relay.snapshot();
    if (!messageId || !channelId || status !== "ready" || !viewer || !origin) return;
    const before = timelineOf("main");
    const epoch = keyEpoch;
    try {
      const result = await ctx.navigation.open(
        {
          version: 1,
          kind: "conversation",
          scope: { viewer, communityOrigin: origin },
          channelId,
          messageId,
          threadRootId: threadRootOf(messageId),
        },
        { focus: "preserve" },
      );
      if (result.status !== "opened") return;
    } catch {
      return;
    }
    // A thread opened here is a new list: whatever the pane marked before belongs to another one.
    cursors.side = undefined;
    paintCursor();
    // [DOM] Land in the thread's message list (normal mode), unless a key press says the user
    // has moved on. A thread placed over the channel replaces the main message list instead.
    const region = await settle(
      () => (timelineOf("side") ? "side" : timelineOf("main") !== before ? "main" : undefined),
      3000,
    );
    if (region && keyEpoch === epoch) goRegion(region);
  };
  // Enter is only ours while the message list itself has focus: on a button, a link or a tab it
  // keeps its native meaning.
  const enterOpens = () => {
    const el = doc.activeElement;
    return state.region === "main" && !!cursors.main && (!el || el === doc.body || el.matches(SCROLLER));
  };
  // After a close or a hide, put focus back where j and k work. The host leaves it on a header
  // button (or nowhere) once the pane it was in is gone.
  const refocusAfter = (region) => afterLayout(() => goRegion(available(region) ? region : "main"));
  // [DOM] The same window event the native Close Tab menu sends (Cmd+W). The host closes the
  // active tab of the pane that has focus, or of the thread pane when focus is in the message
  // list, and marks the event handled when it did.
  const closeThread = () => {
    clearPending();
    if (doc.querySelector('dialog[open], [aria-modal="true"]')) return;
    const request = new Event("buzz:close-active-tab", { cancelable: true });
    window.dispatchEvent(request);
    if (request.defaultPrevented) refocusAfter(state.region);
  };
  // [DOM] The pane's own toggle button: it hides the pane and keeps its threads open.
  const paneToggle = (expanded) =>
    [...doc.querySelectorAll(`${PANE_TOGGLE}[aria-expanded="${expanded}"]`)].find(visible);
  const hidePane = () => {
    clearPending();
    const toggle = paneToggle(true);
    if (!toggle) return;
    toggle.click();
    refocusAfter("main");
  };
  const showPane = () => {
    clearPending();
    paneToggle(false)?.click();
  };
  // [DOM] The split handle is a WAI-ARIA window splitter, and the host gives it keyboard control:
  // Shift+Left and Shift+Right move it 48 px, End makes the pane as wide as it can be, and a
  // double click resets it. The plugin sends those events to the handle; focus does not move.
  // Left widens the pane because the pane is on the right. Each step reads the pane's width as
  // it is now, so a count waits for the layout between steps.
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const resizePane = async (change) => {
    const steps = takeCount();
    const handle = [...doc.querySelectorAll(PANE_HANDLE)].find(visible);
    if (!handle) return;
    const send = (init) =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    if (change === "reset") handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    else if (change === "widest") send({ key: "End" });
    else
      for (let i = 0; i < steps && !disposed && handle.isConnected; i++) {
        send({ key: change === "wider" ? "ArrowLeft" : "ArrowRight", shiftKey: true });
        await nextFrame();
      }
  };

  // ---- j and k inside the host's menus and the community switcher [DOM] -------------------
  // Both are roving-focus lists that the host drives with arrow keys; this moves focus the same
  // way. Capture phase, because Base UI's menus run their own typeahead on letters.
  const onMenuKey = (event) => {
    if (!state.enabled || event.defaultPrevented || event.isComposing) return;
    if (event.key !== "j" && event.key !== "k") return;
    if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
    const list = event.target?.closest?.(`${COMMUNITY_POPUP}, [role="menu"]`);
    if (!list) return;
    const items = [
      ...list.querySelectorAll(
        list.matches('[role="menu"]') ? '[role="menuitem"]:not([aria-disabled="true"])' : "button:not([disabled])",
      ),
    ].filter(visible);
    if (!items.length) return;
    event.preventDefault();
    event.stopPropagation();
    const down = event.key === "j";
    const at = items.indexOf(doc.activeElement);
    const next = at < 0 ? (down ? 0 : items.length - 1) : (at + (down ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  // ---- Insert mode ------------------------------------------------------------------------
  // [API] The one sanctioned way to focus a composer is the focus() command a composer tool
  // receives. A tool only exists inside a mounted composer, so this one renders nothing and just
  // parks its command (with the channel and thread it belongs to) where `i` can find it.
  const bridges = new Set();
  const FocusBridge = (props) => {
    const { focus, channelId, threadRootId } = props;
    React.useEffect(() => {
      const entry = { focus, channelId, threadRootId };
      bridges.add(entry);
      return () => bridges.delete(entry);
    }, [focus, channelId, threadRootId]);
    return null;
  };
  ctx.conversation.registerTool({
    id: "focus-bridge",
    title: "Vim focus bridge",
    order: 1000,
    component: FocusBridge,
  });
  // [API] The channel on screen, from the navigation target.
  const currentChannelId = () => {
    const target = ctx.navigation.snapshot().entry?.target;
    return target?.kind === "conversation" ? target.channelId : undefined;
  };
  // Focuses a pane's message box: through the composer tool's focus() command ([API]), else by markup.
  // Returns false when the pane has no writable box on screen.
  const focusBox = (pane) => {
    const channelId = currentChannelId();
    const bridge = [...bridges]
      .reverse()
      .find((b) => (pane === "side" ? b.threadRootId : !b.threadRootId && (!channelId || b.channelId === channelId)));
    let via = "tool";
    if (bridge) bridge.focus();
    const active = doc.activeElement;
    if (!isEditable(active) || !inComposer(active) || regionOf(active) !== pane) {
      // [DOM] No matching tool (or its command was revoked): find the composer by markup.
      via = "dom";
      const composer = composerOf(pane) ?? (pane === "side" ? undefined : composerOf("main"));
      if (!composer) return false;
      composer.focus();
    }
    bar.dataset.focusVia = via; // read by the test, to tell the two paths apart
    return true;
  };
  const startInsert = (where) => {
    if (!focusBox(state.region === "side" ? "side" : "main")) return;
    if (where === "end") {
      const selection = doc.getSelection();
      selection.selectAllChildren(doc.activeElement);
      selection.collapseToEnd();
    } else if (where === "after") {
      // With composer editing on, Esc left the caret on the last character, so `a` resumes after it.
      const selection = doc.getSelection();
      if (selection.isCollapsed) stepRight(selection);
    }
    set({ textMode: "insert" });
    syncFocus();
  };
  // A pane is one column: its messages, then its message box. NORMAL mode runs in both, so the box is
  // entered in NORMAL (not INSERT) at the start or the end of the draft, and left upwards into the
  // newest message. Without composer editing the box has no NORMAL mode, so there is no crossing.
  const enterBox = (pane, at) => {
    if (!state.composerNormal || !focusBox(pane)) return false;
    const box = doc.activeElement;
    // The first or the last text position of the draft. Not "select all children, collapse": that is
    // a position on the editor's root element, which the editor does not accept as a caret and
    // answers by putting back the selection it had saved (seen in the browser test).
    const place = () => {
      const selection = doc.getSelection();
      const walker = doc.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      if (at === "end") for (let next = text; next; next = walker.nextNode()) text = next;
      if (text) selection.collapse(text, at === "end" ? text.length : 0);
      else selection.collapse(box.firstElementChild ?? box, 0); // an empty draft
      clampCursor(selection);
    };
    const put = () => {
      place();
      // Tell the editor now rather than when the browser gets round to it.
      doc.dispatchEvent(new Event("selectionchange"));
    };
    put();
    // The editor, on gaining focus, puts its own saved selection back at about 20 ms and ignores selection
    // changes for 50 ms after (seen in the browser test: the caret stayed where the editor had it). So
    // put the caret again once that is over, unless a key has come in between.
    const epoch = keyEpoch; // (+1: onAnyKey is still counting the key that brought us here)
    setTimeout(() => {
      if (!disposed && doc.activeElement === box && keyEpoch <= epoch + 1 && state.textMode === "normal" && !state.visual) put();
    }, 80);
    set({ textMode: "normal", visual: "", region: pane });
    syncFocus();
    return true;
  };
  // Out of the box into its pane's message list. blur() alone is not enough in WebKit (Linux, and most
  // likely a Mac's WKWebView): a key's text goes to the editor that holds the selection even when it
  // no longer has focus, so any plain key the plugin does not bind (x, y, 0 ...) typed into the draft
  // after Esc Esc. Chromium never did that, which is why the browser tests could not see it.
  const leaveBox = (el, pane) => {
    el.blur();
    doc.getSelection()?.removeAllRanges();
    set({ textMode: "insert", visual: "" });
    focusEl(timelineOf(pane));
    syncFocus();
  };
  // Up out of the box: the cursor lands on the newest message of the pane.
  const boxUp = (pane) => {
    leaveBox(doc.activeElement, pane);
    const scroller = timelineOf(pane);
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    afterLayout(() => {
      const row = rowsOf(scroller).at(-1);
      if (row) selectRow(row);
    });
  };
  const escape = () => {
    const el = doc.activeElement;
    // In the message box a pending d, g, f, t ... is what Esc cancels; the mode stays as it was.
    if (state.prefix || (state.operator === "d" && isEditable(el))) return clearPending();
    if (state.visual) return leaveVisual();
    if (!isEditable(el)) return clearPending();
    if (state.composerNormal && state.textMode === "insert" && inComposer(el)) {
      clearPending();
      set({ textMode: "normal" });
      // Like vim, leaving insert steps the caret back one character (never across a line).
      const selection = doc.getSelection();
      const before = selection.isCollapsed ? peek(selection, "backward") : "";
      if (before !== "" && !isBreak(before)) selection.modify("move", "backward", "character");
      return syncFocus();
    }
    // Already in NORMAL in the box: Esc stays there, as in vim. The cursor leaves the box upward (k on its
    // first row) or sideways (the leader key, or h and l at the ends of the draft), never by Esc.
    if (state.composerNormal && inComposer(el)) return clearPending();
    // Any other editable, or a message box without a NORMAL mode: Esc leaves it for the message list.
    leaveBox(el, regionOf(el) === "side" ? "side" : "main");
  };

  // ---- Indirect command bus: synthetic host chords [API-adjacent] -------------------------
  // The host's actions (search, focus message box) are not callable, but its dispatcher listens
  // to window keydown and does not check isTrusted. So a plugin can press the host's own chord.
  // It returns true when a host shortcut consumed it.
  const pressHostChord = (key) =>
    !(doc.activeElement ?? doc.body).dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        metaKey: apple,
        ctrlKey: !apple,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );

  // ---- Normal mode inside the message box [DOM] (on by default; a page switch turns it off) -----
  // The shortcut service cannot do this: it runs after the editor (bubbling phase) and never
  // sees keys the editor consumes, and a plugin has no caret or text commands. So this is a
  // capture-phase listener that swallows plain keys while the composer is in text-normal mode
  // and moves the caret with Selection.modify.
  const enterInsert = () => {
    set({ textMode: "insert" });
    syncFocus();
  };
  // ---- Motions [DOM] ----------------------------------------------------------------------
  // Positions are gaps: a caret sits between two characters, and vim's cursor is on the character
  // after the gap. Every motion leaves the caret just before the character it lands on, so a
  // motion that lands on a character (e, f, $) and one that lands before it (t) both read the same
  // way. peek() reads the adjacent character and puts the caret back: a line break reads as "\n"
  // ("\n\n" between two paragraphs), the end of the draft as "". Selection.modify's own "word"
  // granularity differs by platform, so words are walked one character at a time.
  const peek = (selection, direction) => {
    const { anchorNode, anchorOffset } = selection;
    selection.modify("extend", direction, "character");
    const adjacent = selection.toString();
    selection.collapse(anchorNode, anchorOffset);
    return adjacent;
  };
  const here = (selection) => peek(selection, "forward"); // the character under the cursor
  const prev = (selection) => peek(selection, "backward"); // the character before it
  const isBreak = (c) => /^\n+$/.test(c);
  const forward = (selection) => selection.modify("move", "forward", "character");
  const backward = (selection) => selection.modify("move", "backward", "character");
  // 0 blank (space, tab, line break), 1 a word character (letter, digit, underscore), 2 any other
  // character, -1 no character at all. A WORD (W B E) treats every non-blank character alike.
  const WORD_CHAR = /[\p{L}\p{N}_]/u;
  const kind = (c, big) => (c === "" ? -1 : /^\s+$/.test(c) ? 0 : big || WORD_CHAR.test(c) ? 1 : 2);
  // The cursor is on an empty line: nothing before it on the line and nothing under it.
  const onEmptyLine = (selection) => {
    const under = here(selection);
    const before = prev(selection);
    return (under === "" || isBreak(under)) && (before === "" || isBreak(before));
  };
  // A runaway guard for the loops below: a draft is never this long.
  const LIMIT = 5000;
  const times = (n, run) => {
    for (let i = 0; i < n; i++) run(i);
  };

  const wordForward = (selection, big, operator) => {
    const first = kind(here(selection), big);
    // Leave the word the cursor is in...
    if (first > 0) for (let i = 0; i < LIMIT && kind(here(selection), big) === first; i++) forward(selection);
    const endOfWord = gap(selection);
    // ...then cross blanks and line breaks to the next word; an empty line counts as a word.
    let crossed = false;
    for (let i = 0; i < LIMIT && kind(here(selection), big) === 0; i++) {
      crossed ||= isBreak(here(selection));
      forward(selection);
      if (onEmptyLine(selection)) break;
    }
    // vim: with an operator, the last word on a line ends the text, not the first word of the next line.
    if (operator && crossed && first > 0) goto(selection, endOfWord);
  };
  const wordBackward = (selection, big) => {
    if (!prev(selection)) return;
    backward(selection);
    for (let i = 0; i < LIMIT && kind(here(selection), big) === 0; i++) {
      if (onEmptyLine(selection) || !prev(selection)) return;
      backward(selection);
    }
    const k = kind(here(selection), big);
    for (let i = 0; i < LIMIT && kind(prev(selection), big) === k; i++) backward(selection);
  };
  const wordEnd = (selection, big) => {
    if (!here(selection)) return;
    forward(selection); // `e` always moves: from the end of a word it goes to the end of the next
    for (let i = 0; i < LIMIT && kind(here(selection), big) === 0; i++) forward(selection);
    const k = kind(here(selection), big);
    if (k > 0) for (let i = 0; i < LIMIT && kind(here(selection), big) === k; i++) forward(selection);
    backward(selection); // onto the last character of the word
  };
  const wordEndBackward = (selection, big) => {
    const first = kind(here(selection), big);
    if (!prev(selection)) return;
    backward(selection);
    if (first > 0)
      for (let i = 0; i < LIMIT && kind(here(selection), big) === first; i++) {
        if (!prev(selection)) return;
        backward(selection);
      }
    for (let i = 0; i < LIMIT && kind(here(selection), big) === 0; i++) {
      if (onEmptyLine(selection) || !prev(selection)) return;
      backward(selection);
    }
  };

  // The line is the text between two line breaks, however it wraps on screen.
  const lineStart = (selection) => selection.modify("move", "backward", "paragraphboundary");
  const lineEnd = (selection) => selection.modify("move", "forward", "paragraphboundary");
  const firstNonBlank = (selection) => {
    lineStart(selection);
    for (let i = 0; i < LIMIT; i++) {
      const c = here(selection);
      if (kind(c) !== 0 || isBreak(c)) return;
      forward(selection);
    }
  };
  // Line n (1 is the first; Infinity is the last), on its first non-blank character.
  const gotoLine = (selection, n) => {
    if (n === Infinity) selection.modify("move", "forward", "documentboundary");
    else {
      selection.modify("move", "backward", "documentboundary");
      for (let i = 1; i < n; i++) {
        lineEnd(selection);
        if (!here(selection)) break; // no more lines
        forward(selection);
      }
    }
    firstNonBlank(selection);
  };

  // f F t T: the character on this line only. Returns false (and does not move) if it is not there
  // as many times as asked. `again` is ; or ,: a repeated t or T that is already next to its
  // character goes on to the next one instead of staying put.
  let lastFind; // { key, ch }, for ; and ,
  const OPPOSITE = { f: "F", F: "f", t: "T", T: "t" };
  const findChar = (selection, key, ch, count, again) => {
    const backwards = key === "F" || key === "T";
    const till = key === "t" || key === "T";
    // One character along the line, staying on it.
    const hop = () => {
      if (backwards) {
        const before = prev(selection);
        if (before === "" || isBreak(before)) return false;
        backward(selection);
        return true;
      }
      const under = here(selection);
      if (under === "" || isBreak(under)) return false;
      forward(selection);
      const next = here(selection);
      if (next === "" || isBreak(next)) {
        backward(selection);
        return false;
      }
      return true;
    };
    const origin = gap(selection);
    if (again && till) {
      const at = gap(selection);
      const adjacent = hop() && here(selection) === ch;
      goto(selection, at);
      if (adjacent) hop();
    }
    for (let i = 0; i < count; i++) {
      let found = false;
      while (hop()) {
        if (here(selection) === ch) {
          found = true;
          break;
        }
      }
      if (!found) {
        goto(selection, origin);
        return false;
      }
    }
    if (till) (backwards ? forward : backward)(selection);
    return true;
  };
  const finder = (key, ch, again) => ({
    run: (selection, n) => void findChar(selection, key, ch, n, again),
    inclusive: key === "f" || key === "t",
  });

  // A motion: run(selection, n, typed, operator) moves the caret; `inclusive` says that a command
  // like d takes the character it lands on too; `lines` is a motion to a line, which d does not take.
  const MOTIONS = {
    h: { run: (s, n) => times(n, () => backward(s)) },
    l: { run: (s, n) => times(n, () => forward(s)) },
    j: { run: (s, n) => times(n, () => s.modify("move", "forward", "line")) },
    k: { run: (s, n) => times(n, () => s.modify("move", "backward", "line")) },
    w: { run: (s, n, _typed, operator) => times(n, (i) => wordForward(s, false, operator && i === n - 1)) },
    W: { run: (s, n, _typed, operator) => times(n, (i) => wordForward(s, true, operator && i === n - 1)) },
    b: { run: (s, n) => times(n, () => wordBackward(s, false)) },
    B: { run: (s, n) => times(n, () => wordBackward(s, true)) },
    e: { run: (s, n) => times(n, () => wordEnd(s, false)), inclusive: true },
    E: { run: (s, n) => times(n, () => wordEnd(s, true)), inclusive: true },
    ge: { run: (s, n) => times(n, () => wordEndBackward(s, false)), inclusive: true },
    gE: { run: (s, n) => times(n, () => wordEndBackward(s, true)), inclusive: true },
    0: { run: (s) => lineStart(s) },
    "^": { run: (s) => firstNonBlank(s) },
    $: {
      run: (s, n) => {
        times(n - 1, () => {
          lineEnd(s);
          forward(s);
        });
        lineEnd(s);
      },
      inclusive: true,
    },
    gg: { run: (s, n, typed) => gotoLine(s, typed || 1), lines: true },
    G: { run: (s, n, typed) => gotoLine(s, typed || Infinity), lines: true },
  };
  const FIND_KEYS = ["f", "F", "t", "T"];
  const PENDING = Symbol("pending");
  // Turns the key just typed into a motion. Returns undefined if it starts none, PENDING if it
  // needs another key (g, or the character after f t F T), else { run, inclusive, lines }.
  const resolveMotion = (key) => {
    const prefix = state.prefix;
    if (prefix) {
      set({ prefix: "" });
      if (prefix === "g") return { g: MOTIONS.gg, e: MOTIONS.ge, E: MOTIONS.gE }[key];
      lastFind = { key: prefix, ch: key };
      return finder(prefix, key, false);
    }
    if (key === "g" || FIND_KEYS.includes(key)) {
      set({ prefix: key });
      armPending();
      return PENDING;
    }
    if ((key === ";" || key === ",") && lastFind)
      return finder(key === ";" ? lastFind.key : OPPOSITE[lastFind.key], lastFind.ch, true);
    return MOTIONS[key];
  };

  // ---- Visual mode in the message box [DOM] -----------------------------------------------
  // A caret sits in the gap between two characters; vim's cursor sits on the character after the
  // gap. The mode keeps its two ends as collapsed Ranges (anchor, cursor): each Range stays put
  // if the editor re-renders, and a motion starts from the cursor's gap, not from the highlight.
  // The highlight is derived after every key. A characterwise highlight includes the character
  // under both ends, so when it grows rightwards it stops one character past the cursor, and when
  // it grows leftwards it starts one character past the anchor. A linewise highlight runs from the
  // start of the first line to the end of the last. A line is the text between two newlines.
  let visualAnchor;
  let visualCursor;
  let visualSpan; // what the highlight covers: { start, end } as collapsed Ranges, start first
  const gap = (selection) => {
    const range = doc.createRange();
    range.setStart(selection.focusNode, selection.focusOffset);
    return range;
  };
  const goto = (selection, range) => selection.collapse(range.startContainer, range.startOffset);
  const charUnder = (selection) => {
    const next = peek(selection, "forward");
    return isBreak(next) ? "" : next; // "" at the end of a line, and on an empty line
  };
  const stepRight = (selection) => {
    if (charUnder(selection)) selection.modify("move", "forward", "character");
  };
  // Like vim, the cursor rests on a character, never past the last one of a line.
  const clampCursor = (selection) => {
    if (charUnder(selection)) return;
    const before = peek(selection, "backward");
    if (before !== "" && !isBreak(before)) selection.modify("move", "backward", "character");
  };
  // Where the caret is in the draft, for the keys that cross into the next stop of the column.
  // On the first row: the start of the row it is on is the start of the draft (a wrapped line has
  // several rows, so the first line alone is not the test).
  const onFirstRow = (selection) => {
    const origin = gap(selection);
    selection.modify("move", "backward", "lineboundary");
    const first = peek(selection, "backward") === "";
    goto(selection, origin);
    return first;
  };
  const atDraftStart = (selection) => peek(selection, "backward") === "";
  // The cursor rests on the last character: stepping past it reaches the end of the draft.
  const atDraftEnd = (selection) => {
    const origin = gap(selection);
    const under = here(selection);
    if (under !== "" && !isBreak(under)) forward(selection);
    const end = peek(selection, "forward") === "";
    goto(selection, origin);
    return end;
  };
  // The other message pane, if it has a box on screen: the thread's from the channel's, and back.
  const otherBox = () => {
    const target = state.region === "side" ? "main" : "side";
    return composerOf(target) ? target : undefined;
  };
  const select = (selection, start, end, backward) =>
    backward
      ? selection.setBaseAndExtent(end.startContainer, end.startOffset, start.startContainer, start.startOffset)
      : selection.setBaseAndExtent(start.startContainer, start.startOffset, end.startContainer, end.startOffset);
  const paintVisual = () => {
    const selection = doc.getSelection();
    const backward = visualAnchor.compareBoundaryPoints(Range.START_TO_START, visualCursor) > 0;
    const [first, last] = backward ? [visualCursor, visualAnchor] : [visualAnchor, visualCursor];
    let start = first;
    let end = last;
    if (state.visual === "line") {
      goto(selection, first);
      selection.modify("move", "backward", "paragraphboundary");
      start = gap(selection);
      goto(selection, last);
      selection.modify("move", "forward", "paragraphboundary");
      end = gap(selection);
    } else {
      goto(selection, last);
      stepRight(selection);
      end = gap(selection);
    }
    visualSpan = { start, end };
    select(selection, start, end, backward);
  };
  const startVisual = (kind) => {
    const selection = doc.getSelection();
    selection.collapse(selection.focusNode, selection.focusOffset);
    clampCursor(selection);
    visualAnchor = gap(selection);
    visualCursor = gap(selection);
    set({ visual: kind });
    paintVisual();
  };
  // Back to text normal mode with the caret on the cursor (Esc), or on a given gap.
  const leaveVisual = (at) => {
    if (isEditable(doc.activeElement) && visualCursor) {
      const selection = doc.getSelection();
      goto(selection, at ?? visualCursor);
      clampCursor(selection);
    }
    set({ visual: "" });
  };
  const visualMove = (motion, n, typed) => {
    const selection = doc.getSelection();
    goto(selection, visualCursor);
    motion.run(selection, n, typed);
    clampCursor(selection);
    visualCursor = gap(selection);
    paintVisual();
  };
  // The editor serializes its own idea of the selection on a copy, which can lag a keystroke behind
  // the highlight, so the highlight's text goes to the clipboard through a copy listener of ours.
  // A webview that refuses execCommand("copy") gets the async clipboard instead.
  const copy = (text) => {
    if (!text) return;
    const put = (event) => {
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      event.stopPropagation();
    };
    let copied = false;
    doc.addEventListener("copy", put, true);
    try {
      copied = doc.execCommand("copy");
    } finally {
      doc.removeEventListener("copy", put, true);
    }
    if (!copied) navigator.clipboard?.writeText(text).catch(() => {});
  };
  const visualAct = (key) => {
    const selection = doc.getSelection();
    let { start, end } = visualSpan;
    if (key === "y") {
      copy(selection.toString());
      return leaveVisual(start);
    }
    if (state.visual === "line" && key !== "c") {
      // d and x take the lines whole: with the newline after them, or before them for the last lines.
      goto(selection, end);
      if (peek(selection, "forward") === "\n") {
        selection.modify("move", "forward", "character");
        end = gap(selection);
      } else {
        goto(selection, start);
        if (peek(selection, "backward") === "\n") {
          selection.modify("move", "backward", "character");
          start = gap(selection);
        }
      }
    }
    select(selection, start, end, false);
    if (!selection.isCollapsed) doc.execCommand("delete");
    if (key === "c") {
      set({ visual: "" });
      return enterInsert();
    }
    leaveVisual(gap(selection));
  };
  const visualKey = (key) => {
    const typed = state.count;
    const motion = resolveMotion(key);
    if (motion === PENDING) return;
    if (motion) return visualMove(motion, takeCount(), typed);
    clearPending();
    switch (key) {
      case "v":
        return state.visual === "char" ? leaveVisual() : (set({ visual: "char" }), paintVisual());
      case "V":
        return state.visual === "line" ? leaveVisual() : (set({ visual: "line" }), paintVisual());
      case "y":
      case "d":
      case "x":
      case "c":
        return visualAct(key);
    }
  };
  let textKey = (key) => {
    const selection = doc.getSelection();
    // A digit after f, t, F, T is the character to find, not a count.
    if (!state.prefix && /^[0-9]$/.test(key) && (key !== "0" || state.count > 0)) {
      set({ count: Math.min(state.count * 10 + Number(key), 999) });
      return armPending();
    }
    if (state.visual) return visualKey(key);
    // g then a page letter is the page key of the lists, not gg, ge or gE: the box is part of the one NORMAL mode.
    if (state.prefix === "g" && !state.operator && PAGE_KEYS.includes(key)) return goPage(key);
    const operator = state.operator; // takeCount() clears it
    const typed = state.count;
    const motion = resolveMotion(key); // may be only the first key of one (g, f, t ...)
    if (motion === PENDING) return;
    const n = takeCount();
    if (operator === "d") {
      // d{motion}: remember the caret, run the motion, select what it crossed, delete it. A motion
      // that lands on a character (e, f, $ ...) takes that character too.
      if (key === "d") {
        selection.modify("move", "backward", "paragraphboundary");
        selection.modify("extend", "forward", "paragraphboundary");
      } else if (motion && !motion.lines) {
        const origin = gap(selection);
        motion.run(selection, n, typed, true);
        const landed = gap(selection);
        const backwards = origin.compareBoundaryPoints(Range.START_TO_START, landed) > 0;
        const [start, end] = backwards ? [landed, origin] : [origin, landed];
        let stop = end;
        if (motion.inclusive) {
          goto(selection, end);
          const c = here(selection);
          if (c !== "" && !isBreak(c)) {
            forward(selection);
            stop = gap(selection);
          }
        }
        select(selection, start, stop, false);
      } else return;
      if (!selection.isCollapsed) doc.execCommand("delete");
      return;
    }
    if (motion) {
      // k on the first row goes up into the newest message; h at the very start and l at the very
      // end of the draft go on into the other pane's box (a key that could not move anyway).
      if (key === "k" && onFirstRow(selection)) return boxUp(state.region === "side" ? "side" : "main");
      if (key === "h" || key === "l") {
        const across = (key === "l" ? atDraftEnd(selection) : atDraftStart(selection)) && otherBox();
        // Moving right enters the other box at the start of its draft, moving left at the end.
        if (across) return void enterBox(across, key === "l" ? "start" : "end");
      }
      motion.run(selection, n, typed);
      clampCursor(selection); // the cursor rests on a character, as in vim
      return;
    }
    switch (key) {
      case "v":
      case "V":
        return startVisual(key === "v" ? "char" : "line");
      case "i":
        return enterInsert();
      case "a":
        stepRight(selection);
        return enterInsert();
      case "A":
        lineEnd(selection);
        return enterInsert();
      case "I":
        firstNonBlank(selection);
        return enterInsert();
      case "x":
        for (let i = 0; i < n; i++) {
          const c = here(selection);
          if (c === "" || isBreak(c)) return; // nothing under the cursor: x never eats a line break
          selection.modify("extend", "forward", "character");
          if (!selection.isCollapsed) doc.execCommand("delete");
        }
        return;
      case "d":
        set({ operator: "d" });
        return armPending();
      case "?":
        return openHelp();
      case "u": {
        // The editor owns undo history, so ask it the way a user would: with its own chord.
        doc.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "z",
            metaKey: apple,
            ctrlKey: !apple,
            bubbles: true,
            cancelable: true,
          }),
        );
        // The editor leaves the text it restored selected, so the next x or V would act on all of
        // it. vim leaves the cursor at the start of the change: do the same. The editor has
        // already put its selection on the page by the time the dispatch returns.
        if (!selection.isCollapsed) {
          selection.collapseToStart();
          clampCursor(selection);
        }
        return;
      }
    }
  };
  const onTextKey = (event) => {
    if (!state.enabled || !state.composerNormal || state.textMode !== "normal") return;
    if (!inComposer(event.target) || !isEditable(event.target)) return;
    if (event.isComposing || event.keyCode === 229) return;
    // Chords, Escape (handled by the shortcut below), Tab and arrows stay native.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape" || event.key === "Tab") return;
    if (event.key.length > 1 && !["Enter", "Backspace", "Delete"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const helpWas = helpEl;
    textKey(event.key === "Backspace" ? "h" : event.key === "Delete" ? "x" : event.key);
    // onHelpKey is the next listener on this node and gets this same event: it must not take the ?
    // that opened the dialog for the ? that closes it.
    if (helpEl && !helpWas) helpOpenedBy = event;
  };

  // ---- The leader key [DOM] ---------------------------------------------------------------
  // A prefix for the pane commands that must work from anywhere: inside the message box every plain
  // key is a text command, so `h` `l` `q` `<` `>` cannot be the pane keys there. Leader then h or l
  // moves between panes (from a message box to the next pane's box, from a list to its list), q
  // closes the thread, < > | = resize the thread pane. Our own capture-phase listener, ahead of the
  // others, so it sees the keys before the editor, the shortcut service or the host's tab handling.
  // A chord leader (Ctrl-...) cannot be typing, so it also works in INSERT; a plain one (Space,
  // comma) works only where plain keys are ours: the message list, the channel list, a NORMAL box.
  const leaderSpec = () => LEADERS[state.leader] ?? LEADERS[apple ? "ctrl-w" : "space"];
  const isLeader = (event) => {
    const spec = leaderSpec();
    if (event.metaKey || event.altKey || event.ctrlKey !== !!spec.ctrl) return false;
    return spec.ctrl ? event.key.toLowerCase() === spec.key : event.key === spec.key;
  };
  const leaderHere = (el) => {
    if (leaderSpec().ctrl) return true;
    if (!timelineOf("main")) return false; // not on the Messages page: Space keeps scrolling
    if (!el || el === doc.body) return true;
    if (isEditable(el)) return inComposer(el) && state.composerNormal && state.textMode === "normal";
    return el.matches(SCROLLER) || el.matches(SIDEBAR_ROW);
  };
  // In a message box, h and l both mean "the other pane's box"; with no other pane they fall back to
  // moving between the panes as in the lists (h from the channel's box reaches the channel list).
  const leaderPane = (direction) => {
    clearPending();
    const inBox = isEditable(doc.activeElement) && inComposer(doc.activeElement);
    const other = inBox ? otherBox() : undefined;
    if (other && enterBox(other, other === "side" ? "start" : "end")) return;
    shiftRegion(direction);
  };
  const LEADER_THEN = {
    h: () => leaderPane(-1),
    l: () => leaderPane(1),
    q: () => closeThread(),
    c: () => closeThread(),
    "<": () => void resizePane("narrower"),
    ">": () => void resizePane("wider"),
    "|": () => void resizePane("widest"),
    "=": () => void resizePane("reset"),
  };
  let leaderUp; // the key whose keyup we also swallow, so a button does not click on the release
  const onLeaderKey = (event) => {
    if (!state.enabled || helpEl || event.isComposing || event.keyCode === 229) return;
    const swallow = () => {
      event.preventDefault();
      event.stopImmediatePropagation();
      leaderUp = event.key;
      keyEpoch++;
    };
    if (state.operator === "leader") {
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return; // a modifier on its way to <, > or |
      swallow();
      const run = event.ctrlKey || event.metaKey || event.altKey ? undefined : LEADER_THEN[event.key];
      if (run) run();
      else clearPending(); // anything else, Esc included, only cancels
      return;
    }
    if (event.repeat || !isLeader(event) || !contextOk() || !leaderHere(event.target)) return;
    swallow();
    set({ operator: "leader" });
    armPending();
  };
  const onLeaderKeyUp = (event) => {
    if (leaderUp === undefined || event.key !== leaderUp) return;
    leaderUp = undefined;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  // A click moves the caret by itself, so the mode's own cursor no longer applies.
  const onPointerDown = () => {
    if (state.visual) set({ visual: "" });
  };

  // ---- Esc in a message box beside a thread pane [DOM] ------------------------------------
  // The host closes a side-pane tab on Esc from anywhere inside it, in React's handler on the
  // pane, which runs before the window-level dispatcher the shortcut service uses. So the
  // shortcut cannot win: Esc in a reply box would close the thread instead of leaving the box.
  // The channel's own box needs the same while a thread is open (found with the keys that cross
  // between the two boxes: the event never reached the window, so Esc did nothing there).
  // Intercept it first, in the capture phase, but only where the host would otherwise swallow
  // it, and leave edit-cancel and open completion menus alone. A second Esc, from the pane's
  // message list, then closes the thread as usual.
  const onEscapeCapture = (event) => {
    const el = event.target;
    if (event.key !== "Escape" || !state.enabled || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (!el.closest?.(`${SIDE}, ${MAIN}`)) return;
    if (!isEditable(el)) {
      // In a message list Esc does nothing in NORMAL. The host would close a thread's tab here; q and
      // the leader's q do that instead. Only the list itself: a menu, a button or a link keeps its Esc.
      if (!el.matches?.(SCROLLER) || el.closest(POPUP)) return;
      event.preventDefault();
      event.stopPropagation();
      return clearPending();
    }
    if (
      el.closest("form[data-editing]") ||
      el.hasAttribute("aria-activedescendant") ||
      el.getAttribute("aria-expanded") === "true"
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    escape();
  };

  // ---- Keys inside the Settings dialog [DOM] ----------------------------------------------
  // Every dialog and menu keeps the plugin's keys off (the host's dispatcher stands down for them and so
  // does the plugin), except Settings, which is a list and a detail like the app itself: j and k move
  // through its sections, l or Enter opens one and goes into it, h comes back to the list. Esc closes it,
  // which the host already does. Plugin API: nothing, there is no keyboard service for a dialog. DOM: the
  // dialog, its `nav[aria-label="Settings sections"]` and the host's own `#settings-content`.
  const SETTINGS_NAV = 'nav[aria-label="Settings sections"]';
  const SETTINGS_OWN_KEYS = 'select, [role="combobox"], [role="listbox"], [role="menu"], [role="menuitem"], [role="option"]';
  const settingsDialog = () => doc.querySelector(SETTINGS_NAV)?.closest('[role="dialog"]');
  // The sections, not the community address button the list starts with (it copies a URL).
  const settingsItems = (dialog) => [...dialog.querySelectorAll(`${SETTINGS_NAV} button:not([aria-label])`)].filter(visible);
  // The host draws a focus ring only after Tab, an arrow or Home/End (`html[data-keyboard-navigation]`, set
  // by its own listener and cleared on a pointer press): a plain j or k would move focus with no sign of
  // it. Set the same flag its `focusWithKeyboard` helper does, so the ring shows as it does for Tab.
  const focusSection = (item) => {
    if (!item) return;
    doc.documentElement.dataset.keyboardNavigation = "";
    item.focus({ preventScroll: true, focusVisible: true });
    item.scrollIntoView({ block: "nearest" });
  };
  const scrollParent = (el, stop) => {
    for (let node = el; node && node !== stop; node = node.parentElement)
      if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
    return stop;
  };
  const onSettingsKey = (event) => {
    if (!state.enabled || event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const { key } = event;
    if (key !== "j" && key !== "k" && key !== "h" && key !== "l" && key !== "Enter") return;
    const dialog = settingsDialog();
    const el = event.target;
    // Typing, a select, a menu or a popup over the dialog (its focus is outside it) keep their own keys.
    if (!dialog || !dialog.contains(el) || isEditable(el) || el.closest?.(SETTINGS_OWN_KEYS)) return;
    const items = settingsItems(dialog);
    const content = dialog.querySelector("#settings-content");
    const item = el.closest?.(`${SETTINGS_NAV} button`);
    const current = items.find((entry) => entry.hasAttribute("aria-current")) ?? items[0];
    const swallow = () => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    if (item) {
      // In the list of sections.
      if (key === "j" || key === "k") {
        swallow();
        focusSection(items[clamp(items.indexOf(item) + (key === "j" ? 1 : -1), 0, items.length - 1)]);
      } else if (key === "l" || key === "Enter") {
        swallow();
        if (!items.includes(item)) return; // the community address button: Enter copies, l does nothing
        item.click(); // opens the section ...
        afterLayout(() => content?.focus({ preventScroll: true })); // ... and goes into it
      } else swallow(); // h: already in the list
      return;
    }
    if (key === "Enter" || key === "l") return; // a button or link in the detail keeps its Enter
    swallow();
    if (key === "h") focusSection(current); // back to the list, on the open section
    else if (content?.contains(el)) scrollParent(el, content).scrollBy({ top: key === "j" ? 48 : -48 });
    else focusSection(current); // from the close button or the dialog itself, into the list
  };

  // ---- Indicator overlay [DOM] ------------------------------------------------------------
  // The label says which mode the keys are in and which pane they act on:
  //   -- NORMAL --  one normal mode, in a pane's messages and in its message box alike
  //   -- INSERT --  typing; -- VISUAL --  and  -- VISUAL LINE --  in the message box
  const bar = doc.createElement("div");
  bar.setAttribute("data-vim-status", "");
  // Visual only: the nav badge carries the mode for assistive technology.
  bar.setAttribute("aria-hidden", "true");
  // Where it goes: the window's bottom-right corner, fixed, whichever pane or thread tab has the keys.
  // It used to be placed against the composer of the pane that has the keys, and that lookup went wrong
  // (with a second thread tab open the label jumped into the channel's pane, and in a single pane it sat
  // under the box rather than in the corner). A fixed corner depends on no pane, tab or composer. Close
  // to the edge (2px, 10px) it stays clear of a composer's send button, which is further in and higher
  // (the label test measures that in every layout).
  Object.assign(bar.style, {
    position: "fixed",
    right: "10px",
    bottom: "2px",
    zIndex: "2147483000",
    padding: "0 6px",
    borderRadius: "3px",
    font: "600 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace",
    letterSpacing: "-0.01em",
    background: "var(--surface-popover, #1d1d1f)",
    color: "var(--text-standard, #f5f5f7)",
    border: `1px solid ${ACCENT}`,
    pointerEvents: "none",
    whiteSpace: "pre",
  });
  let renderBar = () => {
    bar.style.display = state.enabled && state.statusLine ? "" : "none";
    const text = state.composerNormal && isEditable(doc.activeElement) && state.textMode === "normal";
    const label =
      state.mode === "insert"
        ? "INSERT"
        : text
          ? { "": "NORMAL", char: "VISUAL", line: "VISUAL LINE" }[state.visual]
          : "NORMAL";
    bar.textContent = `-- ${label} --  ${state.region}${state.count ? `  ${state.count}` : ""}${state.operator || state.prefix ? `  ${state.operator}${state.prefix}` : ""}`;
    bar.dataset.mode = state.mode;
    const root = doc.documentElement;
    root.dataset.vimRegion = state.region;
    root.toggleAttribute("data-vim-on", state.enabled);
    root.toggleAttribute("data-vim-panes", state.enabled && workspaces("main").length > 0 && workspaces("side").length > 0);
    paintCursor(); // which pane is active decides how strongly each pane's cursor row shows
  };
  const stopRender = subscribe(() => renderBar());
  renderBar();

  // The hot functions report their time and DOM calls to the performance trace when it is on (and cost a
  // call and a comparison when it is off). The others are wrapped where they are registered.
  rowsOf = perf.timed("rowsOf", rowsOf);
  syncFocus = perf.timed("syncFocus", syncFocus);
  paintCursor = perf.timed("paintCursor", paintCursor);
  moveCursor = perf.timed("moveCursor", moveCursor);
  textKey = perf.timed("textKey", textKey);
  renderBar = perf.timed("renderBar", renderBar);

  ctx.effect(() => {
    doc.head.append(cursorStyle);
    doc.body.append(bar);
    // How many revisions of this plugin the page has applied and disposed: after an update, applied is one
    // ahead of disposed (a window global, so it survives the update; the trace and the tests read it).
    const revisions = (window.__vimRevisions ??= { applied: 0, disposed: 0 });
    revisions.applied++;
    const undo = [];
    const listen = (type, name, fn) => {
      const wrapped = perf.timed(name, fn);
      doc.addEventListener(type, wrapped, true);
      undo.push(() => doc.removeEventListener(type, wrapped, true));
    };
    listen("focusin", "onFocusIn", onFocusIn);
    listen("focusout", "onFocusOut", onFocusOut);
    listen("keydown", "onSettingsKey", onSettingsKey);
    listen("keydown", "onLeaderKey", onLeaderKey);
    listen("keyup", "onLeaderKeyUp", onLeaderKeyUp);
    listen("keydown", "onEscapeCapture", onEscapeCapture);
    listen("keydown", "onTextKey", onTextKey);
    listen("keydown", "onMenuKey", onMenuKey);
    listen("keydown", "onAnyKey", onAnyKey);
    listen("keydown", "onHelpKey", onHelpKey);
    listen("pointerdown", "onPointerDown", onPointerDown);
    // The performance trace follows its setting (the Vim mode page).
    let traced = state.perf;
    perf.start(traced);
    const stopPerf = subscribe(() => {
      if (state.perf === traced) return;
      traced = state.perf;
      perf.start(traced);
    });
    // [API] Page changes can change what is on screen; repaint the indicator then.
    const stopNavigation = ctx.navigation.subscribe(() => setTimeout(syncFocus, 50));
    syncFocus();
    return () => {
      disposed = true;
      clearTimeout(pendingTimer);
      closeHelp();
      stopRender();
      revisions.disposed++;
      stopPerf();
      perf.stop();
      stopNavigation();
      for (const remove of undo) remove();
      delete doc.documentElement.dataset.vimDriving;
      cursorStyle.remove();
      bar.remove();
      delete doc.documentElement.dataset.vimRegion;
      doc.documentElement.removeAttribute("data-vim-on");
      doc.documentElement.removeAttribute("data-vim-panes");
    };
  });

  // ---- Help dialog [DOM] ------------------------------------------------------------------
  // `?` shows the key list in a dialog over whatever is on screen, so closing it leaves you where
  // you were. The plugin draws it itself: the plugin API has no dialog or overlay service (a message
  // action can mount a dialog, but only from a message's menu, never from a key). While it is open
  // every key is ours: the shortcut service already stands down for an aria-modal element, and a
  // capture-phase listener scrolls and closes it and swallows the rest, so nothing reaches the page.
  // These are function declarations because the effect below names them before this point is reached.
  let helpEl; // the backdrop, while open
  let helpCard; // the scrolling dialog inside it
  let helpReturn; // where focus goes back to
  let helpReturnMode; // the message box's mode when it opened (refocusing a box would make it INSERT)
  let helpOpenedBy; // the keydown that opened it
  let helpPending = ""; // "g" after a first g
  let helpCount = 0;
  function closeHelp() {
    if (!helpEl) return;
    helpEl.remove();
    helpEl = helpCard = undefined;
    helpPending = "";
    helpCount = 0;
    const back = helpReturn;
    const mode = helpReturnMode;
    helpReturn = helpReturnMode = undefined;
    if (disposed) return;
    if (back?.isConnected && back !== doc.body) {
      back.focus({ preventScroll: true });
      // A box that had NORMAL gets it back, not the INSERT that any focus into a box means.
      if (mode === "normal" && isEditable(back) && inComposer(back)) set({ textMode: "normal", visual: "" });
    } else focusEl(timelineOf(state.region === "side" ? "side" : "main"));
    syncFocus();
  }
  function openHelp() {
    if (helpEl) return closeHelp();
    helpReturn = doc.activeElement;
    helpReturnMode = state.textMode;
    const backdrop = doc.createElement("div");
    backdrop.setAttribute("data-vim-help", "");
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483001",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0, 0, 0, 0.45)",
    });
    const card = doc.createElement("div");
    card.className = "ui-card"; // the host's own card look
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "Vim keys");
    card.tabIndex = -1;
    Object.assign(card.style, {
      boxSizing: "border-box",
      width: "min(780px, calc(100vw - 48px))",
      maxHeight: "min(80vh, 760px)",
      overflow: "auto",
      padding: "20px 24px",
      outline: "none",
      font: "13px/1.5 system-ui, sans-serif",
    });
    const el = (tag, style, text) => {
      const node = doc.createElement(tag);
      Object.assign(node.style, style);
      if (text !== undefined) node.textContent = text;
      return node;
    };
    card.append(
      el("h2", { margin: "0 0 4px", font: "600 16px/1.3 system-ui, sans-serif" }, "Vim keys"),
      el("p", { margin: "0 0 12px", opacity: "0.7" }, "j k scroll, Ctrl-d Ctrl-u half a page, gg G top and bottom. q, Esc or ? closes."),
    );
    for (const group of groups()) {
      card.append(
        el("h3", { margin: "14px 0 2px", font: "700 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.04em" }, `-- ${group.title} --`),
        el("p", { margin: "0 0 4px", opacity: "0.7" }, group.intro),
      );
      const rows = el("div", { display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "16px", rowGap: "2px" });
      for (const [keys, what] of group.rows)
        rows.append(el("span", { font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "nowrap" }, keys), el("span", {}, what));
      card.append(rows);
    }
    backdrop.append(card);
    // A click on the dimmed backdrop, outside the card, closes it.
    backdrop.addEventListener("pointerdown", (event) => event.target === backdrop && closeHelp());
    doc.body.append(backdrop);
    helpEl = backdrop;
    helpCard = card;
    card.focus({ preventScroll: true });
    syncFocus();
  }
  function onHelpKey(event) {
    if (!helpEl || event.isComposing || event === helpOpenedBy) return;
    if (event.metaKey || event.altKey) return; // the host's own chords stay available
    const card = helpCard;
    const half = () => Math.max(40, card.clientHeight / 2);
    if (event.ctrlKey) {
      if (event.key !== "d" && event.key !== "u") return; // Ctrl+Shift+E and the like still work
      event.preventDefault();
      event.stopPropagation();
      card.scrollBy({ top: event.key === "d" ? half() : -half() });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const { key } = event;
    const first = helpPending === "g";
    helpPending = "";
    const n = Math.max(1, helpCount);
    if (/^[0-9]$/.test(key) && (key !== "0" || helpCount > 0)) {
      helpCount = Math.min(helpCount * 10 + Number(key), 999);
      return;
    }
    helpCount = 0;
    switch (key) {
      case "Escape":
      case "q":
      case "?":
        return closeHelp();
      case "j":
      case "ArrowDown":
        return card.scrollBy({ top: 48 * n });
      case "k":
      case "ArrowUp":
        return card.scrollBy({ top: -48 * n });
      case "PageDown":
      case " ":
        return card.scrollBy({ top: card.clientHeight * 0.9 });
      case "PageUp":
        return card.scrollBy({ top: -card.clientHeight * 0.9 });
      case "g":
        if (first) card.scrollTo({ top: 0 });
        else helpPending = "g";
        return;
      case "Home":
        return card.scrollTo({ top: 0 });
      case "G":
      case "End":
        return card.scrollTo({ top: card.scrollHeight });
    }
  }

  // ---- Shortcuts [API] --------------------------------------------------------------------
  // Plain keys are legal bindings, and the dispatcher skips editable targets and open dialogs
  // on its own. `when` gates on the master switch and on a conversation being on screen.
  const eligible = () => state.enabled && contextOk();
  let order = 0;
  const key = (id, title, binding, run, extra = {}) =>
    ctx.shortcuts.register({
      id,
      title,
      binding,
      run: perf.timed(`key ${id}`, run),
      when: perf.timed("eligible", eligible),
      order: (order += 10),
      ...extra,
    });
  const ctrl = (letter) => (apple ? { key: letter, ctrl: true } : { key: letter, mod: true });

  key("down", "Next message / channel", { key: "j" }, () => step(1), { repeat: true });
  key("up", "Previous message / channel", { key: "k" }, () => step(-1), { repeat: true });
  key("top", "Go to top (press twice)", { key: "g" }, () => {
    if (state.operator === "g") {
      clearPending();
      return jumpEdge(false);
    }
    set({ operator: "g" });
    armPending();
  });
  key("bottom", "Go to latest", { key: "G", shift: true }, () => jumpEdge(true));
  key("half-down", "Scroll half a page down", ctrl("d"), () => halfPage(1), { repeat: true });
  key("half-up", "Scroll half a page up", ctrl("u"), () => halfPage(-1), { repeat: true });
  key("left", "Focus the region to the left", { key: "h" }, () => shiftRegion(-1));
  key("right", "Focus the region to the right (opens a channel)", { key: "l" }, () => shiftRegion(1));
  key("next-channel", "Next channel", { key: "]" }, () => switchChannel(1));
  key("previous-channel", "Previous channel", { key: "[" }, () => switchChannel(-1));
  key("insert", "Insert: focus the message box", { key: "i" }, afterG("i", () => startInsert()));
  key("insert-after", "Append: focus the message box, after the character under the caret", { key: "a" }, afterG("a", () => startInsert("after")));
  key("append", "Insert at the end of the draft", { key: "A", shift: true }, () => startInsert("end"));
  key("reply", "Reply in a thread to the message under the cursor", { key: "r" }, afterG("r", () => void rowControl("Reply")));
  key("message-menu", "Open the menu of the message under the cursor", { key: "m" }, afterG("m", () => void rowControl("More message actions")));
  key("page-next", "After g: next page", { key: "t" }, () => state.operator === "g" && goPage("t"));
  key("page-previous", "After g: previous page", { key: "T", shift: true }, () => state.operator === "g" && goPage("T"));
  key("page-workflows", "After g: Workflows", { key: "w" }, afterG("w", () => {}));
  key("page-vim", "After g: the Vim mode page (its switches)", { key: "v" }, afterG("v", () => {}));
  key("settings", "After g: open Settings (the host also has Cmd/Ctrl+,)", { key: "s" }, () => state.operator === "g" && goPage("s"));
  key("next-community", "Next community", { key: "}", shift: true }, () => void switchCommunity(1));
  key("previous-community", "Previous community", { key: "{", shift: true }, () => void switchCommunity(-1));
  key("communities", "Open the community switcher", { key: "C", shift: true }, () => void openCommunityPicker());
  key(
    "open-thread",
    "Open the thread of the message under the cursor (after z: show the thread pane)",
    { key: "o" },
    afterG("o", () => (state.operator === "z" ? showPane() : void openThread())),
  );
  key("open-thread-enter", "Open the thread of the message under the cursor", { key: "Enter" }, () => void openThread(), {
    when: () => eligible() && enterOpens(),
  });
  key("close-thread", "Close the active thread", { key: "q" }, afterG("q", closeThread));
  key("fold", "Fold prefix: zc hides the thread pane, zo shows it", { key: "z" }, afterG("z", () => {
    set({ operator: "z" });
    armPending();
  }));
  key("close-pane", "After z: hide the thread pane", { key: "c" }, afterG("c", () => state.operator === "z" && hidePane()));
  key("pane-wider", "Widen the thread pane", { key: ">", shift: true }, () => void resizePane("wider"), { repeat: true });
  key("pane-narrower", "Narrow the thread pane", { key: "<", shift: true }, () => void resizePane("narrower"), { repeat: true });
  key("pane-widest", "Make the thread pane as wide as it goes", { key: "|", shift: true }, () => void resizePane("widest"));
  key("pane-reset", "Reset the thread pane width", { key: "=" }, () => void resizePane("reset"));
  key("search", "Search this conversation", { key: "/" }, () => {
    // Search this conversation, falling back to Search Buzz.
    if (!pressHostChord("f")) pressHostChord("k");
  });
  key("help", "Show the Vim keys over the page", { key: "?", shift: true }, openHelp);
  // Escape must also work while the message box has focus, where nothing else may fire.
  key("normal", "Normal mode: leave the message box", { key: "Escape" }, escape, {
    allowInEditable: true,
    when: () => state.enabled && !!timelineOf("main"),
  });
  for (const digit of "1234567890")
    key(
      `count-${digit}`,
      `Count prefix ${digit}`,
      { key: digit },
      () => {
        set({ count: Math.min(state.count * 10 + Number(digit), 999) });
        armPending();
      },
      { when: () => eligible() && (digit !== "0" || state.count > 0) },
    );
  // Always eligible, so it can turn Vim keys back on.
  key(
    "toggle",
    "Turn Vim keys on or off",
    { key: "e", mod: true, shift: true },
    () => setting({ enabled: !state.enabled }),
    { when: () => true, allowInEditable: true },
  );

  // ---- Page [API] -------------------------------------------------------------------------
  const useVim = () => React.useSyncExternalStore(subscribe, () => state);
  const ModeBadge = () => {
    const s = useVim();
    return s.enabled ? h("span", { "aria-label": `Vim ${s.mode} mode` }, s.mode === "insert" ? "I" : "N") : null;
  };
  // The same rows feed the page and the help dialog. The third column, where there is one, says how
  // the key reaches the app (see NOTES.md).
  const groups = () => {
    const L = leaderSpec().show ?? leaderSpec().label;
    return [
    {
      title: "NORMAL, messages and panes",
      intro: `One normal mode. A pane is one column: its messages, then its message box at the bottom. The label says NORMAL and the pane that has the keys (main, side for a thread, sidebar for the channel list). This part is for the focus in a list: the message list, the channel list or a thread.`,
      rows: [
        ["j  k", "Next / previous message (message list) or channel (channel list). j past the newest message goes down into the pane's message box, in NORMAL", "DOM"],
        ["5j", "Counts: 0-9, then a motion", "API"],
        ["gg  G", "First / latest message or channel", "API + DOM"],
        ["Ctrl-d  Ctrl-u", "Scroll half a page (Control on a Mac too, not Command)", "DOM"],
        ["h  l", "Move focus between the channel list, the message list and the thread pane. l on a channel opens it", "DOM"],
        [`${L}  then  h  l  q  <  >  |  =`, "The leader key, for pane commands that work from anywhere, the message box too: h and l move to the pane on the left or right (from a message box, to the other pane's box), q closes the thread, < > | = resize it. Change the leader on the Vim mode page", "DOM"],
        ["[  ]", "Previous / next channel without leaving the message list", "DOM"],
        ["{  }  C", "Previous / next community (counts work); C opens the community switcher. j / k move in it, Enter picks, Esc closes", "DOM"],
        ["o  Enter", "Open the thread of the message under the cursor and move into it. Enter only while the message list has focus", "API + DOM"],
        ["q", "Close the thread: the active tab of the pane you are in, or of the thread pane from the message list", "DOM"],
        ["zc  zo", "Hide / show the thread pane. Its threads stay open", "DOM"],
        [">  <", "Widen / narrow the thread pane by 48 px a press; a count multiplies (3> is 144 px)", "DOM"],
        ["|  =", "Thread pane as wide as it goes / back to its default width", "DOM"],
        ["r", "Reply in a thread to the message under the cursor; focus lands in the reply box", "DOM"],
        ["m", "Open the menu of the message under the cursor (copy, mark unread, ...). j / k move, Enter picks", "DOM"],
        ["gt  gT", "Next / previous page, cycling through the pages the app lists", "API"],
        ["gi gm ga gr gw gv gs", "Open Inbox, Messages, Agents, Reminders, Workflows, the Vim mode page (its switches), Settings (the page whose name starts with the letter). The app has Cmd+, or Ctrl+, for Settings too", "API"],
        ["i  a  A", "Go to INSERT: focus the message box (a: after the character under the caret; A: at the end of the draft)", "API + DOM"],
        ["Esc", "Nothing. It does not close a thread: q does", "DOM"],
        ["/", "Search this conversation (presses the host's own chord)", "API-adjacent"],
        ["?", "Show this list over the page. j k, Ctrl-d Ctrl-u and gg G scroll it; q, Esc or ? closes it", "DOM"],
        ["j  k  l  Enter  h", "Only in the Settings dialog (every other dialog and menu keeps the keys off): j k move through its sections, l or Enter opens one and goes into it (j k then scroll it), h comes back to the list. Esc closes the dialog, as it always did", "DOM"],
        [apple ? "⌘⇧E" : "Ctrl+Shift+E", "Turn Vim keys on or off", "API"],
      ],
    },
    {
      title: "NORMAL, the message box",
      intro: "Inside the message box (Esc from INSERT, or down from the messages with j). The label says NORMAL; plain keys move and edit, they never type.",
      rows: [
        ["h  j  k  l", "Move the caret (counts work)"],
        ["k  (on the first row)", "Go up out of the box into the newest message of the pane"],
        ["h  (at the very start)  l  (at the very end)", "Go on into the other pane's box: the thread's from the channel's, and back"],
        [`${L}  then  h  l  q  <  >  |  =`, "The leader key works here too, from anywhere in the draft: h and l go to the other pane's box, q closes the thread, < > | = resize it"],
        ["w  b  e  ge", "Words: letters, digits and underscore are one word, any other run of characters is another"],
        ["W  B  E  gE", "WORDs: any run of non-blank characters"],
        ["0  ^  $", "Start of the line, first non-blank, end of the line. A line runs between two line breaks, however it wraps"],
        ["gg  G  3G", "First line, last line, line 3 (of the draft)"],
        ["f t F T + a character", "Find that character on this line: onto it, just before it, and the same backwards. 2fx finds the second x"],
        ["; ,", "Repeat the last f t F T, and repeat it the other way"],
        ["i  a  I  A", "Back to INSERT"],
        ["x  dd  dw  de  df,  d$ ...", "Delete: d and any motion above (dd is the whole line). The motions that land on a character take it too"],
        ["u", "Undo"],
        ["v  V", "VISUAL: highlight by character / by line"],
        ["?", "Show this list over the page"],
        ["Esc", "Cancels a half-typed command (d, g, f ...); otherwise nothing: Esc stays in NORMAL. Leave the box with k on its first row, h or l at the ends of the draft, or the leader key"],
      ],
    },
    {
      title: "INSERT",
      intro: "Typing in the message box. The label says INSERT; plain keys type, and the app's own shortcuts apply.",
      rows: [["Esc", "Back to NORMAL, in the box. In a thread's reply box it does not close the thread", "API + DOM"]],
    },
    {
      title: "VISUAL",
      intro: "A highlight in the message box (v or V from NORMAL). The label says VISUAL or VISUAL LINE.",
      rows: [
        ["every NORMAL motion", "Move the cursor end of the highlight (counts work)"],
        ["v  V", "The same key again leaves; the other one switches between characters and lines"],
        ["y", "Copy the highlight to the clipboard"],
        ["d  x", "Delete the highlight (V takes the whole lines)"],
        ["c", "Delete the highlight and go to INSERT"],
        ["Esc", "Back to NORMAL, the caret on the cursor end"],
      ],
    },
  ];
  };
  const table = (rows) => {
    const tier = rows.some((row) => row[2]);
    return h(
      "table",
      { style: { borderCollapse: "collapse", marginBottom: "1rem" } },
      h("tbody", null, rows.map((row) =>
        h(
          "tr",
          { key: row[0] },
          h("td", { style: { padding: "2px 16px 2px 0", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", verticalAlign: "top" } }, row[0]),
          h("td", { style: { padding: "2px 16px 2px 0" } }, row[1]),
          tier && h("td", { style: { padding: "2px 0", opacity: 0.6, whiteSpace: "nowrap", verticalAlign: "top" } }, row[2]),
        ),
      )),
    );
  };
  const toggle = (s, label, field, hint) =>
    h(
      "label",
      { style: { display: "block", margin: "0.5rem 0" } },
      h("input", {
        type: "checkbox",
        checked: s[field],
        onChange: (event) => setting({ [field]: event.target.checked }),
      }),
      ` ${label}`,
      hint && h("span", { style: { opacity: 0.6 } }, ` ${hint}`),
    );
  ctx.pages.register({
    id: "main",
    title: "Vim mode",
    primary: true,
    badge: ModeBadge,
    component: function VimPage() {
      const s = useVim();
      return h(
        "section",
        { className: "ui-card", style: { padding: "var(--space-panel-inset)" } },
        h("h1", null, "Vim mode"),
        h("p", { role: "status" }, `Mode: ${s.mode}. Region: ${s.region}.`),
        toggle(s, "Vim keys", "enabled"),
        toggle(s, "Status line", "statusLine", "(the -- NORMAL -- label under the message box)"),
        toggle(s, "Normal and visual mode inside the message box", "composerNormal", "(Esc in the box keeps the focus; switch this off for a plain box)"),
        h(
          "label",
          { style: { display: "block", margin: "0.5rem 0" } },
          "Leader key ",
          h(
            "select",
            {
              "aria-label": "Leader key",
              value: s.leader,
              onChange: (event) => setting({ leader: event.target.value }),
            },
            Object.entries(LEADERS)
              .filter(([id, spec]) => !spec.mac || apple || id === s.leader)
              .map(([id, spec]) => h("option", { key: id, value: id }, spec.label)),
          ),
          h(
            "span",
            { style: { opacity: 0.6 } },
            " (then h or l: next pane; q: close the thread; < > | =: resize it. Works in the message box too)",
          ),
        ),
        h(
          "label",
          { style: { display: "block", margin: "0.5rem 0" } },
          "Performance trace ",
          h(
            "select",
            {
              "aria-label": "Performance trace",
              value: s.perf,
              onChange: (event) => setting({ perf: event.target.value }),
            },
            PERF_LEVELS.map((entry) => h("option", { key: entry.id || "off", value: entry.id }, entry.label)),
          ),
          h(
            "span",
            { style: { opacity: 0.6 } },
            " (for measuring the plugin; off by default. Ctrl+Alt+Shift+P copies the numbers as JSON, Ctrl+Alt+Shift+R starts over)",
          ),
        ),
        h("p", { style: { opacity: 0.7 } }, "The same list opens over any page with ?. The last column says how each key reaches the app; see NOTES.md."),
        ...groups().flatMap((group) => [
          h("h2", { key: `${group.title}-title` }, group.title),
          h("p", { key: `${group.title}-intro`, style: { opacity: 0.7 } }, group.intro),
          h("div", { key: group.title }, table(group.rows)),
        ]),
        h("input", {
          "aria-label": "Vim typing check",
          placeholder: "Plain keys never act while you type here",
          style: { width: "100%" },
        }),
      );
    },
  });
}
